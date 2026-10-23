// Stockage des fichiers de la plateforme (spec, section 17 et 21.2) : sur le
// disque, sous UPLOAD_DIR/plateforme/<org_id>/<deal_id>/<document_id>/<fichier>,
// et liens de telechargement signes (HMAC) valables 5 minutes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RACINE = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'), 'plateforme');
const DUREE_LIEN_S = 300;
const SECRET = process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-in-production';

/** Nom de fichier sur pour le disque : pas de chemin, pas de caractere de controle, 180 caracteres au plus. */
function nomSur(nom) {
  // eslint-disable-next-line no-control-regex
  const base = path.basename(String(nom || '')).replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').trim();
  const court = base.length > 180 ? base.slice(-180) : base;
  return court && court !== '.' && court !== '..' ? court : 'fichier';
}

function cheminRelatif(orgId, dealId, documentId, nom) {
  return path.posix.join(orgId, dealId, documentId, nomSur(nom));
}

function cheminAbsolu(relatif) {
  const abs = path.resolve(RACINE, relatif);
  if (!abs.startsWith(path.resolve(RACINE) + path.sep)) throw new Error('Chemin de stockage hors de la racine.');
  return abs;
}

async function ecrire(relatif, contenu) {
  const abs = cheminAbsolu(relatif);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, contenu);
  return abs;
}

/** Copie un fichier temporaire (multer) vers le stockage ; rename si possible, sinon copie puis suppression. */
async function deposer(relatif, cheminTemporaire) {
  const abs = cheminAbsolu(relatif);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  try {
    await fs.promises.rename(cheminTemporaire, abs);
  } catch {
    await fs.promises.copyFile(cheminTemporaire, abs);
    await fs.promises.unlink(cheminTemporaire).catch(() => {});
  }
  return abs;
}

function flux(relatif) { return fs.createReadStream(cheminAbsolu(relatif)); }
async function existe(relatif) { try { await fs.promises.access(cheminAbsolu(relatif)); return true; } catch { return false; } }
async function taille(relatif) { return (await fs.promises.stat(cheminAbsolu(relatif))).size; }

function sha256DuFichier(relatif) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(cheminAbsolu(relatif)).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function supprimerDocument(orgId, dealId, documentId) {
  await fs.promises.rm(cheminAbsolu(path.posix.join(orgId, dealId, documentId)), { recursive: true, force: true });
}

// ---------- liens signes ----------
function signature(donnees) { return crypto.createHmac('sha256', SECRET).update(donnees).digest('base64url'); }

/** Jeton de telechargement d'un document, valable DUREE_LIEN_S secondes. */
function signerLien({ document_id, org_id }, dureeS = DUREE_LIEN_S) {
  const exp = Math.floor(Date.now() / 1000) + dureeS;
  const corps = Buffer.from(JSON.stringify({ d: document_id, o: org_id, e: exp })).toString('base64url');
  return { jeton: `${corps}.${signature(corps)}`, expires_at: new Date(exp * 1000).toISOString() };
}

/** { document_id, org_id } si le jeton est valide et non expire, sinon null. */
function verifierLien(jeton) {
  const [corps, sig] = String(jeton || '').split('.');
  if (!corps || !sig) return null;
  const attendue = signature(corps);
  if (sig.length !== attendue.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(attendue))) return null;
  try {
    const { d, o, e } = JSON.parse(Buffer.from(corps, 'base64url').toString('utf8'));
    if (!d || !o || !e || e < Math.floor(Date.now() / 1000)) return null;
    return { document_id: d, org_id: o };
  } catch {
    return null;
  }
}

module.exports = { RACINE, DUREE_LIEN_S, nomSur, cheminRelatif, cheminAbsolu, ecrire, deposer, flux, existe, taille, sha256DuFichier, supprimerDocument, signerLien, verifierLien };
