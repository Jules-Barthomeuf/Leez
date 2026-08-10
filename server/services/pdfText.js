// pdfjs-dist 4.x n'est distribué qu'en ESM ; ce module reste CommonJS, donc
// on charge la bibliothèque via un import() dynamique, mis en cache après le
// premier appel.
let pdfjsLibPromise = null;
function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsLibPromise;
}

// Extrait le texte reel page par page, avec la position de chaque fragment de
// texte (span). C'est la seule verite terrain : rien ici ne vient du modele.
async function extractPages(buffer) {
  const pdfjsLib = await loadPdfjs();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    let text = '';
    const spans = [];
    for (const item of textContent.items) {
      if (typeof item.str !== 'string' || item.str.length === 0) continue;
      const h = item.height || Math.abs(item.transform[3]) || 10;
      const x = item.transform[4];
      const yTop = viewport.height - item.transform[5] - h; // origine haut-gauche
      if (text.length > 0) text += ' ';
      const start = text.length;
      text += item.str;
      spans.push({ start, end: text.length, x, y: yTop, w: item.width || 0, h });
    }

    pages.push({
      pageNumber: i,
      text,
      spans,
      pageWidth: viewport.width,
      pageHeight: viewport.height,
    });
    page.cleanup();
  }

  await pdf.destroy();
  return pages;
}

// Heuristique simple : si la majorite des pages n'ont presque pas de texte,
// le PDF est probablement scanne (image seule) -> hors perimetre v1.
function isLikelyScanned(pages) {
  if (pages.length === 0) return true;
  const thin = pages.filter(p => p.text.length < 20).length;
  return thin / pages.length > 0.5;
}

module.exports = { extractPages, isLikelyScanned };
