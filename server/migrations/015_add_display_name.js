// Nom du dossier choisi par l'analyste a l'import (ex. "Projet Altair").
// Distinct du nom de fichier (filename, souvent cryptique) et de l'adresse
// extraite (qui n'existe qu'une fois l'extraction terminee) : c'est le nom
// AFFICHE partout (cartes du Vault, en-tete du dossier, Memoire). Nullable :
// les dossiers importes avant cette migration retombent sur adresse/filename.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('documents', {
    display_name: { type: 'text', notNull: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('documents', 'display_name');
};
