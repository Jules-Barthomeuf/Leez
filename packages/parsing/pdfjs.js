// Parseur pdfjs : la couche texte native d'un PDF, avec coordonnees, sans OCR.
// Reference pour les PDF natifs. Les items de pdfjs sont regroupes en lignes
// (meme ordonnee) puis en blocs (lignes proches), dans l'ordre de lecture
// haut → bas, gauche → droite. Pas de detection de tableaux.
const { ouvrirPdf } = require('./rasteriser');

/** @typedef {import('../core/types').ParsedDocument} ParsedDocument */
/** @typedef {import('../core/types').ParsedPage} ParsedPage */

/** Les items texte d'une page pdfjs → lignes → blocs, en coordonnees normalisees (origine en haut a gauche). */
function construirePage(items, largeur, hauteur, numero) {
  const mots = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => {
      const [a, b, , d, x, y] = it.transform;
      const h = Math.max(Math.hypot(b, d), it.height || 0, 1);
      const w = it.width || Math.abs(a) * it.str.length * 0.5;
      return { texte: it.str, x, y, w, h, eol: !!it.hasEOL };
    });
  // Lignes : items dont les ordonnees se recouvrent, tries de haut en bas puis de gauche a droite.
  mots.sort((p, q) => (q.y - p.y) || (p.x - q.x));
  const lignes = [];
  for (const m of mots) {
    const derniere = lignes[lignes.length - 1];
    if (derniere && Math.abs(derniere.y - m.y) < 0.5 * Math.max(derniere.h, m.h)) derniere.mots.push(m);
    else lignes.push({ y: m.y, h: m.h, mots: [m] });
  }
  for (const l of lignes) {
    l.mots.sort((p, q) => p.x - q.x);
    // Espace entre deux items s'ils sont separes d'au moins un tiers de hauteur de ligne.
    let texte = '';
    let finX = null;
    for (const m of l.mots) {
      if (finX != null && m.x - finX > 0.33 * l.h && !/\s$/.test(texte) && !/^\s/.test(m.texte)) texte += ' ';
      texte += m.texte;
      finX = m.x + m.w;
    }
    l.texte = texte.replace(/\s+/g, ' ').trim();
    l.x0 = Math.min(...l.mots.map((m) => m.x));
    l.x1 = Math.max(...l.mots.map((m) => m.x + m.w));
    l.y0 = Math.max(...l.mots.map((m) => m.y + m.h)); // haut (origine en bas chez pdfjs)
    l.y1 = Math.min(...l.mots.map((m) => m.y));        // bas
  }
  // Blocs : lignes consecutives dont l'ecart vertical (bas de l'une, haut de la suivante) reste inferieur a
  // 0,45 hauteur de ligne : un interligne normal vaut ~0,15 h, un saut de paragraphe au moins 0,5 h.
  const hauteurs = lignes.map((l) => l.h).sort((p, q) => p - q);
  const hMediane = hauteurs.length ? hauteurs[Math.floor(hauteurs.length / 2)] : 10;
  const blocs = [];
  for (const l of lignes) {
    const b = blocs[blocs.length - 1];
    if (b && b.derniere.y1 - l.y0 < 0.45 * Math.max(b.derniere.h, l.h) && b.derniere.y1 - l.y0 > -0.3 * l.h) { b.lignes.push(l); b.derniere = l; }
    else blocs.push({ lignes: [l], derniere: l });
  }
  const norme = (v, total) => Math.min(1, Math.max(0, v / total));
  let texte = '';
  const blocks = blocs.map((b, i) => {
    const t = b.lignes.map((l) => l.texte).join('\n');
    const char_start = texte.length;
    texte += t + (i < blocs.length - 1 ? '\n\n' : '');
    const grande = b.lignes.every((l) => l.h > 1.25 * hMediane) && t.length < 120;
    return {
      id: `p${numero}-b${i + 1}`,
      type: grande ? 'title' : 'text',
      bbox: [norme(Math.min(...b.lignes.map((l) => l.x0)), largeur), norme(hauteur - Math.max(...b.lignes.map((l) => l.y0)), hauteur), norme(Math.max(...b.lignes.map((l) => l.x1)), largeur), norme(hauteur - Math.min(...b.lignes.map((l) => l.y1)), hauteur)],
      char_start,
      char_end: char_start + t.length,
      text: t,
    };
  });
  return { page_number: numero, width: largeur, height: hauteur, text: texte, blocks, ocr: false };
}

/**
 * Part de la page couverte par la plus grande image dessinee (0 a 1). Une page scannee est une image qui
 * couvre toute la page ; si elle porte aussi une couche texte, c'est un OCR fait en amont, de qualite inconnue.
 * On suit la matrice de transformation courante dans la liste d'operateurs pour connaitre la taille dessinee.
 */
async function couvertureImage(page, OPS) {
  const vp = page.getViewport({ scale: 1 });
  const aire = vp.width * vp.height;
  if (!aire) return 0;
  const ops = await page.getOperatorList();
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  let ctm = [1, 0, 0, 1, 0, 0];
  const pile = [];
  let max = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.save) pile.push(ctm);
    else if (fn === OPS.restore) ctm = pile.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, ops.argsArray[i]);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat || fn === OPS.paintJpegXObject) {
      // L'image est dessinee dans le carre unite transforme par la matrice courante.
      const a = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
      if (a > max) max = a;
    }
  }
  return Math.min(1, max / aire);
}

/**
 * @param {{ buffer: Buffer }} entree
 * @returns {Promise<ParsedDocument>}
 */
async function parse({ buffer }) {
  const debut = Date.now();
  const doc = await ouvrirPdf(buffer);
  /** @type {ParsedPage[]} */
  const pages = [];
  try {
    const { OPS } = await require('./rasteriser').pdfjs();
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const contenu = await page.getTextContent();
      const p = construirePage(contenu.items, vp.width, vp.height, n);
      p.couverture_image = Math.round((await couvertureImage(page, OPS)) * 1000) / 1000;
      // Image pleine page + texte : une couche OCR faite en amont, signalee comme telle (ocr = true).
      if (p.couverture_image >= 0.8 && p.text.replace(/\s/g, '').length >= 50) p.ocr = true;
      pages.push(p);
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return { parser: 'pdfjs', pages, mesure: { ms: Date.now() - debut, cout_eur: 0, pages: pages.length } };
}

async function disponible() { return { ok: true }; }

module.exports = { nom: 'pdfjs', description: 'Couche texte native (pdfjs-dist), coordonnées par bloc, sans OCR ni tableaux', parse, disponible, construirePage, couvertureImage };
