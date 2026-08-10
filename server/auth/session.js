// Sessions cote serveur stockees en base (pas en memoire) : survivent aux
// redemarrages/redeploiements du serveur Render -- un utilisateur ne doit
// pas etre deconnecte a chaque redeploiement. La table `session` existe
// deja (migration 007_create_session_table.js), createTableIfMissing reste
// a false pour ne pas dupliquer cette responsabilite.
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { pool } = require('../db');

module.exports = session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: false }),
  secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours
  },
});
