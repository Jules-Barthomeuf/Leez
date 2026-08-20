// Notes de l'analyste par FICHIER du dossier (table "Documents du dossier") :
// un JSONB sur documents, cle 'om' pour le memorandum lui-meme et l'id de
// l'annexe pour les pieces jointes. Texte libre de l'analyste -- jamais
// genere, affiche sous le nom du fichier.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('documents', {
    file_notes_json: { type: 'jsonb', notNull: true, default: '{}' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('documents', 'file_notes_json');
};
