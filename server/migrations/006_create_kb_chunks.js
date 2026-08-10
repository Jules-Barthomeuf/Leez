// Traduction fidele de `kb_chunks` (schema.sql) -- base de connaissances
// RAG partagee (bail 3/6/9, ILAT/ILC/IRL, article 606, etc.), identique
// pour tous les fonds/workspaces, peuplee une seule fois via `npm run
// kb:ingest`. Deliberement PAS scopee par workspace, y compris apres le
// Milestone Auth -- ce n'est pas une donnee utilisateur.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('kb_chunks', {
    id: { type: 'uuid', primaryKey: true },
    source_file: { type: 'text', notNull: true },
    theme: { type: 'text', notNull: true },
    section_title: { type: 'text', notNull: true },
    article_ref: { type: 'text', notNull: true, default: '' },
    page_start: { type: 'integer', notNull: true },
    page_end: { type: 'integer', notNull: true },
    content: { type: 'text', notNull: true },
    embedding: { type: 'jsonb', notNull: true },
    created_at: { type: 'text', notNull: true },
  });
  pgm.createIndex('kb_chunks', 'theme');
};

exports.down = (pgm) => {
  pgm.dropTable('kb_chunks');
};
