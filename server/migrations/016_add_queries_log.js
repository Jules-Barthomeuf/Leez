// Journal des requetes du dossier (section "Requetes recentes" de l'ecran
// dossier, comme les "Recent queries" Harvey) : chaque entree = {label,
// kind, by, at}, ecrite quand l'analyste lance un mode du chat ou pose une
// question libre. Donnees REELLES d'usage -- jamais pre-rempli.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('documents', {
    queries_json: { type: 'jsonb', notNull: true, default: '[]' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('documents', 'queries_json');
};
