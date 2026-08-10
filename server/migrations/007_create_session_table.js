// Table attendue par connect-pg-simple (Milestone Auth) pour stocker les
// sessions cote serveur -- creee des maintenant comme migration versionnee
// et revue au meme titre que le reste du schema, plutot que generee
// implicitement au demarrage de l'app (createTableIfMissing) en production.
// Non utilisee tant que le Milestone Auth n'est pas branche.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    'session',
    {
      sid: { type: 'varchar', notNull: true, primaryKey: true },
      sess: { type: 'json', notNull: true },
      expire: { type: 'timestamp(6)', notNull: true },
    },
    { ifNotExists: true }
  );
  pgm.createIndex('session', 'expire', { name: 'idx_session_expire' });
};

exports.down = (pgm) => {
  pgm.dropTable('session');
};
