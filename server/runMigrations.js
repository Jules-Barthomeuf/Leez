// Applique les migrations en attente au demarrage, quand DATABASE_URL
// designe une VRAIE base (Render, docker-compose...). Le Postgres local
// embarque a deja son propre appel (localPostgres.js) -- ce module couvre
// le cas ou aucune commande de pre-deploiement n'est configuree cote
// hebergeur : sans lui, brancher une base vide ferait planter l'app
// (tables absentes) au lieu de la creer.
//
// node-pg-migrate est idempotent (table `pgmigrations`) et prend un verrou
// consultatif : deux instances qui demarrent en meme temps ne rejouent
// jamais la meme migration.
async function runPendingMigrations() {
  if (!process.env.DATABASE_URL) return;
  const path = require('path');
  const { runner } = require('node-pg-migrate');
  const { needsSsl } = require('./db');
  try {
    const applied = await runner({
      databaseUrl: { connectionString: process.env.DATABASE_URL, ssl: needsSsl(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false },
      dir: path.join(__dirname, 'migrations'),
      direction: 'up',
      migrationsTable: 'pgmigrations',
      log: () => {},
    });
    if (applied && applied.length) {
      console.log(`[migrations] ${applied.length} migration(s) appliquée(s) : ${applied.map(m => m.name).join(', ')}`);
    }
  } catch (err) {
    // Ne bloque pas le demarrage : /healthz doit repondre pour que
    // l'hebergeur ne boucle pas sur des redemarrages, et l'erreur reste
    // visible dans les logs.
    console.error('[migrations] Échec de l\'application des migrations :', err.message);
  }
}

module.exports = { runPendingMigrations };
