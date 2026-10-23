// Rasterisation d'un PDF en images PNG, page par page, avec MuPDF compile en
// WebAssembly (paquet `mupdf`) : aucune dependance native ni systeme, donc le
// meme code sur un poste de developpement et sur le worker Render. C'est
// l'entree des OCR locaux (Tesseract) et des images envoyees aux API.
// pdfjs-dist reste utilise pour la couche texte (voir pdfjs.js) ; son rendu
// d'images en Node (canvas natifs) s'est revele instable, d'ou MuPDF ici.

let mupdfPromise = null;
/** `mupdf` est un module ESM a chargement asynchrone : charge une fois, a la demande. */
function mupdf() {
  if (!mupdfPromise) mupdfPromise = import('mupdf');
  return mupdfPromise;
}

let pdfjsPromise = null;
/** pdfjs-dist (ESM) pour la couche texte, charge une fois. */
function pdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/** Ouvre un PDF avec pdfjs (texte). L'appelant appelle doc.destroy() a la fin. */
async function ouvrirPdf(buffer) {
  const lib = await pdfjs();
  return lib.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, verbosity: 0 }).promise;
}

/**
 * Rend les pages demandees en PNG.
 * @param {Buffer} buffer
 * @param {{ dpi?: number, pages?: number[], rotation?: number }} [options]  rotation en degres (0, 90, 180, 270), sens horaire
 * @returns {Promise<Array<{ page_number: number, width: number, height: number, png: Buffer, rotation: number }>>}
 */
async function rasteriser(buffer, { dpi = 250, pages, rotation = 0 } = {}) {
  const lib = await mupdf();
  const doc = lib.Document.openDocument(buffer, 'application/pdf');
  const resultat = [];
  try {
    const total = doc.countPages();
    const numeros = pages || Array.from({ length: total }, (_, i) => i + 1);
    for (const n of numeros) {
      if (n < 1 || n > total) continue;
      const page = doc.loadPage(n - 1);
      try {
        const matrice = lib.Matrix.concat(lib.Matrix.scale(dpi / 72, dpi / 72), lib.Matrix.rotate(rotation));
        const pixmap = page.toPixmap(matrice, lib.ColorSpace.DeviceRGB, false, true);
        try {
          resultat.push({ page_number: n, width: pixmap.getWidth(), height: pixmap.getHeight(), png: Buffer.from(pixmap.asPNG()), rotation });
        } finally {
          pixmap.destroy();
        }
      } finally {
        page.destroy();
      }
    }
  } finally {
    doc.destroy();
  }
  return resultat;
}

/** Nombre de pages d'un PDF. */
async function nombreDePages(buffer) {
  const lib = await mupdf();
  const doc = lib.Document.openDocument(buffer, 'application/pdf');
  try { return doc.countPages(); } finally { doc.destroy(); }
}

module.exports = { mupdf, pdfjs, ouvrirPdf, rasteriser, nombreDePages };
