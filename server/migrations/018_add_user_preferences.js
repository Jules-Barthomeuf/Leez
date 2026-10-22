// Personnalisation de l'interface par compte (mode, accent, fond, barre,
// halo, police) : un JSONB normalise par public/js/personnalisation.js avant
// chaque ecriture. Propre a la personne, jamais au fonds.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('users', {
    preferences_json: { type: 'jsonb', notNull: true, default: '{}' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('users', 'preferences_json');
};
