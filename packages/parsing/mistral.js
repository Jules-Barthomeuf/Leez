// Parseur Mistral OCR (API, modele mistral-ocr-latest). Sortie : markdown par
// page, boites de blocs quand l'API les renvoie (OCR 4), tableaux en markdown.
// Cle : MISTRAL_API_KEY. Cout : pages facturees par l'API × prix unitaire
// configure (MISTRAL_OCR_PRIX_USD_1000_PAGES), converti en euros (USD_EUR).
const { prixEnEuros } = require('./couts');

const CLE = process.env.MISTRAL_API_KEY;
const MODELE = process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest';
const URL_OCR = process.env.MISTRAL_OCR_URL || 'https://api.mistral.ai/v1/ocr';

async function disponible() {
  if (!CLE) return { ok: false, raison: 'clé manquante : MISTRAL_API_KEY' };
  return { ok: true };
}

/** Les cellules d'un tableau markdown GitHub (| a | b |) → lignes de cellules. */
function lignesDeTableauMarkdown(md) {
  return md.split('\n').filter((l) => /^\s*\|/.test(l)).filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
}

function normaliserPage(p, numero) {
  const texte = (p.markdown || '').trim();
  const dim = p.dimensions || {};
  const blocks = [];
  if (Array.isArray(p.blocks) && p.blocks.length && dim.width && dim.height) {
    let position = 0;
    for (const b of p.blocks) {
      const t = (b.text || b.markdown || '').trim();
      if (!t) continue;
      const idx = texte.indexOf(t, position);
      const char_start = idx >= 0 ? idx : position;
      if (idx >= 0) position = idx + t.length;
      const bbox = b.bbox ? [b.bbox.x0, b.bbox.y0, b.bbox.x1, b.bbox.y1] : [b.top_left_x, b.top_left_y, b.bottom_right_x, b.bottom_right_y];
      const ok = bbox.every((v) => typeof v === 'number');
      blocks.push({ id: `p${numero}-b${blocks.length + 1}`, type: /table/i.test(b.type || '') ? 'table' : /title|header/i.test(b.type || '') ? 'title' : 'text', bbox: ok ? [bbox[0] / dim.width, bbox[1] / dim.height, bbox[2] / dim.width, bbox[3] / dim.height] : null, char_start, char_end: char_start + t.length, text: t });
    }
  }
  // Tableaux : ceux de l'API s'ils sont la, sinon ceux du markdown.
  const tables = Array.isArray(p.tables) && p.tables.length ? p.tables.map((t) => lignesDeTableauMarkdown(t.markdown || t.content || '')) : [lignesDeTableauMarkdown(texte)];
  for (const rows of tables) {
    if (!rows.length) continue;
    const t = rows.map((r) => r.join(' | ')).join('\n');
    blocks.push({ id: `p${numero}-t${blocks.length + 1}`, type: 'table', bbox: null, char_start: 0, char_end: 0, text: t, table: { rows } });
  }
  if (!blocks.length && texte) blocks.push({ id: `p${numero}-b1`, type: 'text', bbox: null, char_start: 0, char_end: texte.length, text: texte });
  return { page_number: numero, width: dim.width || null, height: dim.height || null, text: texte, blocks, ocr: true };
}

/**
 * @param {{ buffer: Buffer }} entree
 */
async function parse({ buffer }) {
  if (!CLE) throw new Error('MISTRAL_API_KEY absente');
  const debut = Date.now();
  const corps = {
    model: MODELE,
    document: { type: 'document_url', document_url: `data:application/pdf;base64,${buffer.toString('base64')}` },
    include_image_base64: false,
    table_format: 'markdown',
  };
  const r = await fetch(URL_OCR, { method: 'POST', headers: { authorization: `Bearer ${CLE}`, 'content-type': 'application/json' }, body: JSON.stringify(corps) });
  if (!r.ok) throw new Error(`Mistral OCR ${r.status} : ${(await r.text()).slice(0, 500)}`);
  const j = await r.json();
  const pages = (j.pages || []).map((p, i) => normaliserPage(p, (p.index ?? i) + 1));
  const facturees = (j.usage_info && j.usage_info.pages_processed) || pages.length;
  return {
    parser: 'mistral',
    pages,
    mesure: { ms: Date.now() - debut, cout_eur: prixEnEuros('MISTRAL_OCR_PRIX_USD_1000_PAGES', facturees / 1000), pages: pages.length, pages_facturees: facturees, modele: j.model || MODELE },
  };
}

module.exports = { nom: 'mistral', description: `Mistral OCR (${MODELE}), API hébergée dans l'UE par défaut, markdown + boîtes de blocs`, parse, disponible, lignesDeTableauMarkdown };
