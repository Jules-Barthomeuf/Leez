// Traduction fidele de `supporting_documents` (schema.sql). Inchange par
// rapport a SQLite -- pas de colonne workspace_id propre : le scoping par
// espace de travail (Milestone Auth) tiendra de facon transitive via
// document_id -> documents.workspace_id, jamais dupliquee ici.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('supporting_documents', {
    id: { type: 'uuid', primaryKey: true },
    document_id: { type: 'uuid', notNull: true, references: 'documents(id)', onDelete: 'CASCADE' },
    category: { type: 'text', notNull: true },
    type: { type: 'text', notNull: true },
    filename: { type: 'text', notNull: true },
    uploaded_at: { type: 'text', notNull: true },
    mime_type: { type: 'text', notNull: true, default: 'application/pdf' },
  });
  pgm.createIndex('supporting_documents', 'document_id');
};

exports.down = (pgm) => {
  pgm.dropTable('supporting_documents');
};
