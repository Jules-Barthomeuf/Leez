// Demarre automatiquement un Postgres local embarque (aucune installation
// systeme requise -- ni Docker, ni Homebrew, ni Postgres natif) quand
// DATABASE_URL n'est pas definie dans l'environnement. En production
// (Render), DATABASE_URL est toujours definie via le Postgres manage --
// ce module n'est alors jamais charge. Sert UNIQUEMENT le developpement
// local, pour retrouver la simplicite "zero configuration" qu'avait
// l'ancienne base SQLite : `npm start` doit marcher directement apres un
// `npm install`, sans etape manuelle.
//
// Donnees persistees dans data/pgdata/ (memes conventions que l'ancien
// data/leez.sqlite) -- un redemarrage du serveur retrouve les memes
// dossiers, ce n'est PAS une base ephemere comme celle utilisee pour les
// scripts de verification ponctuels de cette session (persistent:false).
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data', 'pgdata');
const PORT = 54329; // port dedie peu courant, pour eviter un conflit avec un Postgres deja installe sur 5432
const LOCAL_DATABASE_URL = `postgres://leez:leez@localhost:${PORT}/leez`;

let instance = null;

// Un Postgres embarque tourne deja (ex: `node server/index.js` deja lance
// dans un autre terminal) et un script utilitaire (create-user.js,
// seed-demo.js) veut juste s'y connecter ? Demarrer un 2e Postgres sur le
// MEME repertoire de donnees echouerait (verrou pris par le premier) --
// on sonde donc une connexion reelle avant de tenter quoi que ce soit.
async function isAlreadyRunning() {
  const { Client } = require('pg');
  const client = new Client({ connectionString: LOCAL_DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

async function runMigrations() {
  const { runner } = require('node-pg-migrate');
  await runner({
    databaseUrl: LOCAL_DATABASE_URL,
    dir: path.join(__dirname, 'migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => {},
  });
}

async function ensureLocalPostgres() {
  if (instance) return instance;

  if (await isAlreadyRunning()) {
    process.env.DATABASE_URL = LOCAL_DATABASE_URL;
    return null; // rien a demarrer/arreter ici -- une autre instance de processus en a la charge
  }

  // Le package expose un default export ESM -- require() en CommonJS donne
  // { default: EmbeddedPostgres }, pas le constructeur directement.
  const EmbeddedPostgres = require('embedded-postgres').default;
  fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: PORT,
    user: 'leez',
    password: 'leez',
    persistent: true,
    onLog: () => {},
    onError: (e) => console.error('[postgres local]', e),
  });

  const alreadyInitialised = fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'));
  if (!alreadyInitialised) {
    console.log('Premier démarrage : initialisation du Postgres local embarqué (data/pgdata/)…');
    await pg.initialise();
  }
  await pg.start();
  try { await pg.createDatabase('leez'); } catch { /* existe deja */ }

  process.env.DATABASE_URL = LOCAL_DATABASE_URL;
  instance = pg;

  // Applique les migrations automatiquement (equivalent local du
  // `releaseCommand: node-pg-migrate up` de render.yaml en production) --
  // sans ca, un Postgres embarque tout juste initialise n'a aucune table.
  await runMigrations();

  // Arret propre a la fermeture du process (Ctrl+C, redemarrage nodemon,
  // etc.) -- sans ca le processus postgres embarque resterait orphelin.
  const shutdown = () => { try { pg.stop(); } catch { /* deja arrete */ } };
  process.on('exit', shutdown);
  process.on('SIGINT', () => { shutdown(); process.exit(0); });
  process.on('SIGTERM', () => { shutdown(); process.exit(0); });

  return pg;
}

module.exports = { ensureLocalPostgres, LOCAL_DATABASE_URL };
