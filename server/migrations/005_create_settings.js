// Traduction fidele de `settings` (schema.sql) -- cle simple pour
// l'instant (un seul workspace implicite, comme aujourd'hui). La cle
// composite (workspace_id, key) arrivera avec le Milestone Auth, quand
// chaque fonds aura reellement ses propres criteres de mandat.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('settings', {
    key: { type: 'text', primaryKey: true },
    value: { type: 'jsonb' },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('settings');
};
