// Comptes nominatifs (auth branchee au Milestone 1) -- la table existe des
// maintenant pour ne pas avoir a re-migrer le schema plus tard. Un email est
// unique de facon insensible a la casse (index sur lower(email)) sans
// necessiter l'extension citext.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    workspace_id: { type: 'uuid', notNull: true, references: 'workspaces(id)', onDelete: 'CASCADE' },
    email: { type: 'text', notNull: true },
    password_hash: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_login_at: { type: 'timestamptz' },
  });
  pgm.createIndex('users', pgm.func('lower(email)'), { unique: true, name: 'idx_users_email_lower' });
  pgm.createIndex('users', 'workspace_id');
};

exports.down = (pgm) => {
  pgm.dropTable('users');
};
