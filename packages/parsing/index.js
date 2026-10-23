// packages/parsing : l'interface DocumentParser (spec, section 1) et ses
// implementations. Chaque parseur expose :
//   nom, description,
//   disponible() → { ok, raison? }          (cle manquante, outil absent…)
//   parse({ buffer, chemin, nom }) → ParsedDocument (packages/core/types.js) :
//     pages[] { page_number, width, height, text, blocks[], ocr }, mesure { ms, cout_eur, pages }
// Le texte d'une page est dans l'ordre de lecture ; chaque bloc donne sa
// position dans ce texte (char_start, char_end) et, quand le parseur le sait,
// sa boite en fractions de page et ses cellules de tableau.
// Le code metier n'appelle jamais un fournisseur directement : toujours via ce registre.

const PARSEURS_PDF = {
  pdfjs: () => require('./pdfjs'),
  tesseract: () => require('./tesseract'),
  docling: () => require('./docling'),
  mistral: () => require('./mistral'),
  azure: () => require('./azure'),
  claude: () => require('./claude'),
};
const LECTEURS = {
  excel: () => require('./excel'),
  email: () => require('./email'),
};

/** Le parseur PDF du nom donne (charge a la demande). */
function parseur(nom) {
  const f = PARSEURS_PDF[nom];
  if (!f) throw new Error(`Parseur inconnu : ${nom} (${Object.keys(PARSEURS_PDF).join(', ')})`);
  return f();
}
/** Le lecteur d'un fichier qui n'est pas un PDF : xlsx/xls/csv → excel, eml → email. */
function lecteurPour(nomFichier) {
  const ext = (nomFichier.match(/\.([a-z0-9]+)$/i) || [])[1];
  if (!ext) return null;
  if (/^(xlsx|xlsm|xls|csv)$/i.test(ext)) return LECTEURS.excel();
  if (/^eml$/i.test(ext)) return LECTEURS.email();
  return null;
}

/** Nombre de caracteres de couche texte native par page (pdfjs) : decide si une page est un scan. */
async function couchesTexte(buffer) {
  const doc = await parseur('pdfjs').parse({ buffer });
  return doc.pages.map((p) => ({ page_number: p.page_number, caracteres: p.text.replace(/\s/g, '').length }));
}

module.exports = { PARSEURS_PDF: Object.keys(PARSEURS_PDF), parseur, lecteurPour, couchesTexte };
