// Le worker de la plateforme lance seul (`npm run worker`), pour un
// deploiement ou le service web tourne avec WORKER_INLINE=false. Meme base,
// memes migrations, memes jobs que dans le processus web.
require('dotenv').config();
require('./plateforme/observabilite').initialiser('worker');

async function main() {
  if (!process.env.DATABASE_URL) {
    const { ensureLocalPostgres } = require('./localPostgres');
    await ensureLocalPostgres();
  }
  await require('./runMigrations').runPendingMigrations();
  const { demarrerWorker, arreterWorker } = require('./plateforme/worker');
  await demarrerWorker();
  const arret = async () => { await arreterWorker(); process.exit(0); };
  process.on('SIGTERM', arret);
  process.on('SIGINT', arret);
}

main().catch((err) => {
  console.error('Échec du démarrage du worker :', err);
  process.exit(1);
});
