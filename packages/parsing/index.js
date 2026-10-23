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

const SEUIL_CARACTERES = 50;      // spec, section 4 : OCR si une page a moins de 50 caracteres de texte natif
const SEUIL_LETTRES = 0.6;        // part de lettres et chiffres dans la couche texte : en dessous, couche parasite
const SEUIL_IMAGE_PLEINE_PAGE = 0.8;

/**
 * La regle de decision par page (benchmark du 23 octobre 2026, docs/SPEC.md 21.2 ter) :
 *   'natif'        couche texte exploitable → pdfjs ;
 *   'ocr_existant' image pleine page portant deja une couche texte (OCR fait en amont, qualite inconnue) → OCR Leez,
 *                  la couche existante est gardee en indice ;
 *   'scan'         pas de couche texte exploitable → OCR Leez.
 * @param {{ caracteres: number, ratio_alnum: number, couverture_image: number }} page
 */
function decider({ caracteres, ratio_alnum, couverture_image }) {
  const texteExploitable = caracteres >= SEUIL_CARACTERES && ratio_alnum >= SEUIL_LETTRES;
  if (!texteExploitable) return 'scan';
  if (couverture_image >= SEUIL_IMAGE_PLEINE_PAGE) return 'ocr_existant';
  return 'natif';
}

/** Analyse de la couche texte de chaque page (pdfjs) et verdict de la regle de decision. */
async function couchesTexte(buffer) {
  const doc = await parseur('pdfjs').parse({ buffer });
  return doc.pages.map((p) => {
    const sansEspaces = p.text.replace(/\s/g, '');
    const alnum = (sansEspaces.match(/[\p{L}\p{N}]/gu) || []).length;
    const info = { page_number: p.page_number, caracteres: sansEspaces.length, ratio_alnum: sansEspaces.length ? alnum / sansEspaces.length : 0, couverture_image: p.couverture_image || 0 };
    return { ...info, verdict: decider(info) };
  });
}

module.exports = { PARSEURS_PDF: Object.keys(PARSEURS_PDF), parseur, lecteurPour, couchesTexte, decider, SEUIL_CARACTERES, SEUIL_LETTRES, SEUIL_IMAGE_PLEINE_PAGE };
