// Un "workspace" = l'espace de travail partage d'un fonds : tous les
// analystes d'un meme fonds appartiennent au meme workspace et voient les
// memes dossiers (voir 002_create_users.js et 003_create_documents.js pour
// le rattachement). gen_random_uuid() est un builtin Postgres depuis la
// version 13, aucune extension a activer.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('workspaces', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('workspaces');
};
