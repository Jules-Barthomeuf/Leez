// Prospection cession-bail V2 : les donnees metier de chaque fonds (workspace).
// Les cibles elles-memes viennent de sources publiques et restent en fichiers
// (data/prospection/out) ; ici, ce que l'equipe en fait : mandats SCPI,
// listes, suivi dans le pipeline, verifications manuelles et journal des
// actions. Une cible est designee par le SIREN de l'entreprise occupante.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('prospection_mandats', {
    id: { type: 'uuid', primaryKey: true },
    workspace_id: { type: 'uuid', notNull: true, references: 'workspaces', onDelete: 'CASCADE' },
    nom: { type: 'text', notNull: true },
    client: { type: 'text' },
    phrase: { type: 'text' },
    criteres_json: { type: 'jsonb', notNull: true, default: '{}' },
    statut: { type: 'text', notNull: true, default: 'actif' },
    created_by: { type: 'uuid' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('prospection_mandats', 'workspace_id');

  pgm.createTable('prospection_listes', {
    id: { type: 'uuid', primaryKey: true },
    workspace_id: { type: 'uuid', notNull: true, references: 'workspaces', onDelete: 'CASCADE' },
    mandat_id: { type: 'uuid', references: 'prospection_mandats', onDelete: 'SET NULL' },
    nom: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('prospection_listes', 'workspace_id');

  pgm.createTable('prospection_liste_cibles', {
    liste_id: { type: 'uuid', notNull: true, references: 'prospection_listes', onDelete: 'CASCADE' },
    cible_id: { type: 'text', notNull: true },
    added_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('prospection_liste_cibles', 'prospection_liste_cibles_pk', { primaryKey: ['liste_id', 'cible_id'] });

  // Suivi d'une cible dans le pipeline, par mandat (mandat_id nul : hors mandat).
  pgm.createTable('prospection_suivis', {
    id: { type: 'uuid', primaryKey: true },
    workspace_id: { type: 'uuid', notNull: true, references: 'workspaces', onDelete: 'CASCADE' },
    mandat_id: { type: 'uuid', references: 'prospection_mandats', onDelete: 'CASCADE' },
    cible_id: { type: 'text', notNull: true },
    etape: { type: 'text', notNull: true, default: 'a_qualifier' },
    motif_ecart: { type: 'text' },
    commentaire: { type: 'text' },
    premier_contact_le: { type: 'timestamptz' },
    relance_le: { type: 'date' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('prospection_suivis', ['workspace_id', 'mandat_id', 'cible_id'], { unique: true, name: 'prospection_suivis_unique' });

  // Lot 1 : verification a la main qu'une cible occupe bien ses murs.
  pgm.createTable('prospection_verifications', {
    workspace_id: { type: 'uuid', notNull: true, references: 'workspaces', onDelete: 'CASCADE' },
    cible_id: { type: 'text', notNull: true },
    verdict: { type: 'text', notNull: true },
    note: { type: 'text' },
    user_email: { type: 'text' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('prospection_verifications', 'prospection_verifications_pk', { primaryKey: ['workspace_id', 'cible_id'] });

  // Qui a vu, exporte, suivi ou contacte quelle cible (exigence de securite de la spec).
  pgm.createTable('prospection_journal', {
    id: { type: 'bigserial', primaryKey: true },
    workspace_id: { type: 'uuid', notNull: true, references: 'workspaces', onDelete: 'CASCADE' },
    user_email: { type: 'text' },
    action: { type: 'text', notNull: true },
    cible_id: { type: 'text' },
    detail: { type: 'jsonb' },
    at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('prospection_journal', ['workspace_id', 'cible_id']);
};

exports.down = (pgm) => {
  pgm.dropTable('prospection_journal');
  pgm.dropTable('prospection_verifications');
  pgm.dropTable('prospection_suivis');
  pgm.dropTable('prospection_liste_cibles');
  pgm.dropTable('prospection_listes');
  pgm.dropTable('prospection_mandats');
};
