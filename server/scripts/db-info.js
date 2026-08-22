// Diagnostic de la base réellement utilisée par ce service.
// Usage (Shell Render ou local) : node server/scripts/db-info.js
// N'affiche JAMAIS le mot de passe de connexion.
require('dotenv').config();

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL absente -> Postgres embarqué (disque du conteneur, EFFACÉ à chaque redéploiement).");
    process.exit(0);
  }
  let host = '(illisible)';
  try { host = new URL(url).host; } catch { /* URL non standard */ }
  console.log('Hôte de la base :', host);

  const { pool } = require('../db');
  try {
    const { rows: [t] } = await pool.query('SELECT current_database() AS db');
    const { rows: [c] } = await pool.query(`
      SELECT (SELECT COUNT(*)::int FROM users) AS users,
             (SELECT COUNT(*)::int FROM workspaces) AS workspaces,
             (SELECT COUNT(*)::int FROM documents) AS documents
    `);
    const { rows: [m] } = await pool.query('SELECT COUNT(*)::int AS applied, MAX(run_on) AS last_run FROM pgmigrations');
    console.log('Base            :', t.db);
    console.log('Contenu         :', `${c.users} compte(s), ${c.workspaces} espace(s), ${c.documents} dossier(s)`);
    console.log('Migrations      :', `${m.applied} appliquées, dernière le ${m.last_run}`);
    console.log("\nSi ces compteurs retombent à zéro après chaque déploiement, la base n'est pas persistante :");
    console.log("vérifiez dans le dashboard Render que le service web a bien DATABASE_URL pointant vers");
    console.log("la base « leez-db », et que cette base existe toujours.");
  } catch (err) {
    console.error('Erreur de connexion :', err.message);
  }
  process.exit(0);
})();
