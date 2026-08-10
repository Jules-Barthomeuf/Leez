// Volet source du mode Web (AI Agent) : la plupart des sites refusent d'etre
// affiches dans un iframe (X-Frame-Options / CSP frame-ancestors). Cet
// endpoint se contente de dire au client si la page cliquee est integrable --
// jamais de reconstruction/extraction de repli : quand ce n'est pas possible,
// le client renvoie vers l'ouverture de la vraie page dans un nouvel onglet.
const express = require('express');
const dns = require('dns').promises;
const net = require('net');

const router = express.Router();

const FETCH_TIMEOUT_MS = 12000;
// UA de navigateur : certains sites renvoient une reponse differente (voire
// une erreur) a un client sans UA reconnu, ce qui fausserait le test.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

// Protection SSRF : cette appli tourne en local, souvent a cote d'autres
// services sur 127.0.0.1 / le reseau prive. On ne suit que http(s) et on
// refuse toute cible qui resout vers une adresse privee, loopback, lien-local
// ou reservee -- sinon une URL piegee (venant d'un resultat de recherche)
// permettrait de faire lire un service interne par le serveur.
function isBlockedIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true;
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('fe80')) return true; // link-local
    // IPv4 mappee (::ffff:127.0.0.1) : reevalue la partie v4
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true;
}

async function assertPublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('URL invalide.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Seules les URL http(s) sont autorisées.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error('Adresse non autorisée.');
    return url;
  }
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('Adresse non autorisée.');
  const records = await dns.lookup(host, { all: true });
  if (!records.length || records.some(r => isBlockedIp(r.address))) throw new Error('Adresse non autorisée.');
  return url;
}

// Integrable seulement si le site ne l'interdit ni par X-Frame-Options ni par
// CSP frame-ancestors. On ne cherche pas a savoir si NOTRE origine est
// autorisee : tout ce qui n'est pas un "tout le monde peut m'integrer"
// evident est traite comme non integrable.
function isEmbeddable(headers) {
  const xfo = (headers.get('x-frame-options') || '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin') || xfo.includes('allow-from')) return false;
  const csp = (headers.get('content-security-policy') || '').toLowerCase();
  const match = csp.match(/frame-ancestors([^;]*)/);
  if (match) {
    const value = match[1].trim();
    if (!/\*(\s|$)/.test(value)) return false;
  }
  return true;
}

router.get('/web-page', async (req, res) => {
  const raw = typeof req.query.url === 'string' ? req.query.url : '';
  if (!raw) return res.status(400).json({ error: 'URL manquante.' });
  let url;
  try { url = await assertPublicUrl(raw); } catch (err) { return res.status(400).json({ error: err.message }); }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const upstream = await fetch(url.href, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' },
    });
    // Seuls les en-tetes de la reponse comptent (voir isEmbeddable) -- le
    // corps n'est jamais lu, donc pas besoin d'attendre son telechargement.
    upstream.body?.cancel().catch(() => {});
    res.json({ embeddable: isEmbeddable(upstream.headers), url: upstream.url });
  } catch (err) {
    const aborted = err.name === 'AbortError';
    res.status(502).json({ error: aborted ? 'La page a mis trop de temps à répondre.' : 'Impossible de charger cette page.' });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;
