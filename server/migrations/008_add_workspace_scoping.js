// Rattache les dossiers et les criteres de mandat a un espace de travail
// (Milestone Auth : c'est maintenant que le code sait quoi y mettre a
// chaque insertion -- voir la note dans 003_create_documents.js). Aucun
// vrai client n'a encore de donnees en base a ce stade (pre-lancement),
// donc le backfill ci-dessous est trivial : un unique espace par defaut
// recoit tout ce qui existe deja (dossier demo, PDF importes en local).
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO workspaces (name)
    SELECT 'Espace par défaut'
    WHERE NOT EXISTS (SELECT 1 FROM workspaces)
  `);

  pgm.addColumn('documents', { workspace_id: { type: 'uuid', references: 'workspaces(id)' } });
  pgm.sql(`UPDATE documents SET workspace_id = (SELECT id FROM workspaces ORDER BY created_at LIMIT 1) WHERE workspace_id IS NULL`);
  pgm.alterColumn('documents', 'workspace_id', { notNull: true });
  pgm.createIndex('documents', 'workspace_id');

  // settings passe d'une cle simple (key) a une cle composite
  // (workspace_id, key) : chaque fonds a desormais ses propres criteres de
  // mandat plutot qu'un unique reglage global.
  pgm.addColumn('settings', { workspace_id: { type: 'uuid', references: 'workspaces(id)' } });
  pgm.sql(`UPDATE settings SET workspace_id = (SELECT id FROM workspaces ORDER BY created_at LIMIT 1) WHERE workspace_id IS NULL`);
  pgm.alterColumn('settings', 'workspace_id', { notNull: true });
  pgm.dropConstraint('settings', 'settings_pkey');
  pgm.addConstraint('settings', 'settings_pkey', { primaryKey: ['workspace_id', 'key'] });
};

exports.down = (pgm) => {
  pgm.dropConstraint('settings', 'settings_pkey');
  pgm.addConstraint('settings', 'settings_pkey', { primaryKey: ['key'] });
  pgm.dropColumn('settings', 'workspace_id');
  pgm.dropColumn('documents', 'workspace_id');
};
