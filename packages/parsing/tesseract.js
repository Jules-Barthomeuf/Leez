// Parseur Tesseract (tesseract.js, en francais, en local) : la reference OCR
// gratuite. Chaque page est rasterisee (TESSERACT_DPI, 250 par defaut) et
// reconnue ; si la confiance moyenne est basse, la page est rendue a nouveau
// tournee de 90, 180 et 270 degres (page scannee de travers) et la meilleure
// lecture est gardee. Blocs = paragraphes de Tesseract, avec leur boite.
const path = require('path');
const { rasteriser } = require('./rasteriser');

const DPI = Number(process.env.TESSERACT_DPI) || 250;
const CACHE = process.env.TESSDATA_CACHE || path.join(__dirname, '..', '..', 'eval', '.cache', 'tessdata');
const CONFIANCE_MIN_SANS_ROTATION = 60;

let workerPromise = null;
async function worker() {
  if (!workerPromise) {
    const { createWorker } = require('tesseract.js');
    workerPromise = createWorker('fra', 1, { cachePath: CACHE, logger: () => {} });
  }
  return workerPromise;
}

async function reconnaitre(png) {
  const w = await worker();
  const { data } = await w.recognize(png, {}, { text: true, blocks: true });
  return data;
}

/** Reconnait une page ; si la premiere lecture est peu confiante, essaie les trois autres orientations. */
async function reconnaitreAvecRotation(buffer, numero, image) {
  let meilleur = { data: await reconnaitre(image.png), rotation: 0, width: image.width, height: image.height };
  if ((meilleur.data.confidence || 0) >= CONFIANCE_MIN_SANS_ROTATION) return meilleur;
  for (const degres of [90, 270, 180]) {
    const [tournee] = await rasteriser(buffer, { dpi: DPI, pages: [numero], rotation: degres });
    const data = await reconnaitre(tournee.png);
    if ((data.confidence || 0) > (meilleur.data.confidence || 0)) meilleur = { data, rotation: degres, width: tournee.width, height: tournee.height };
    if ((meilleur.data.confidence || 0) >= CONFIANCE_MIN_SANS_ROTATION + 15) break;
  }
  return meilleur;
}

function construirePage(resultat, numero) {
  const { data, width, height, rotation } = resultat;
  const norme = (v, total) => Math.min(1, Math.max(0, v / total));
  const paragraphes = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) paragraphes.push(p);
  // Un bloc par ligne (boite precise pour le visualiseur de source) ; les lignes d'un meme paragraphe sont
  // separees par un retour simple, les paragraphes par une ligne vide.
  let texte = '';
  const blocks = [];
  for (const p of paragraphes) {
    const lignes = (p.lines || []).map((l) => ({ ...l, t: (l.text || '').replace(/\s+$/, '').trim() })).filter((l) => l.t);
    if (!lignes.length) continue;
    if (texte) texte += '\n\n';
    lignes.forEach((l, i) => {
      if (i) texte += '\n';
      const char_start = texte.length;
      texte += l.t;
      blocks.push({
        id: `p${numero}-b${blocks.length + 1}`,
        type: 'text',
        bbox: l.bbox ? [norme(l.bbox.x0, width), norme(l.bbox.y0, height), norme(l.bbox.x1, width), norme(l.bbox.y1, height)] : null,
        char_start,
        char_end: texte.length,
        text: l.t,
      });
    });
  }
  if (!blocks.length && data.text && data.text.trim()) {
    texte = data.text.trim();
    blocks.push({ id: `p${numero}-b1`, type: 'text', bbox: null, char_start: 0, char_end: texte.length, text: texte });
  }
  return { page_number: numero, width, height, text: texte, blocks, ocr: true, rotation, confiance: data.confidence };
}

/**
 * @param {{ buffer: Buffer }} entree
 * @returns {Promise<import('../core/types').ParsedDocument>}
 */
async function parse({ buffer }) {
  const debut = Date.now();
  const images = await rasteriser(buffer, { dpi: DPI });
  const pages = [];
  for (const image of images) {
    const resultat = await reconnaitreAvecRotation(buffer, image.page_number, image);
    pages.push(construirePage(resultat, image.page_number));
  }
  return { parser: 'tesseract', pages, mesure: { ms: Date.now() - debut, cout_eur: 0, pages: pages.length } };
}

async function disponible() {
  try { require('tesseract.js'); return { ok: true }; } catch (e) { return { ok: false, raison: `tesseract.js absent : ${e.message}` }; }
}

async function fermer() {
  if (workerPromise) { const w = await workerPromise; await w.terminate(); workerPromise = null; }
}

module.exports = { nom: 'tesseract', description: `OCR Tesseract 5 (tesseract.js, langue fra, ${DPI} dpi, rendu MuPDF), rotation automatique, boîtes par ligne`, parse, disponible, fermer };
