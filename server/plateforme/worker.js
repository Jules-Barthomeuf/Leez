// Le worker de la plateforme : consomme les files pg-boss avec les jobs du
// registre (./jobs). Tourne dans le processus web par defaut (WORKER_INLINE
// absent ou 'true'), ou seul via `node server/worker.js`. La concurrence est
// bornee par file et par organisation (groupe pg-boss = org_id).
const { demarrerFile, arreterFile } = require('./file');
const JOBS = require('./jobs');

let actif = false;
// WORKER_CONCURRENCY (defaut 2) : jobs simultanes par file dans ce processus. Par organisation, 4 au plus (spec, section 4).
const CONCURRENCE = Number(process.env.WORKER_CONCURRENCY) > 0 ? Number(process.env.WORKER_CONCURRENCY) : 2;

async function demarrerWorker() {
  if (actif) return;
  const boss = await demarrerFile();
  for (const [nom, def] of Object.entries(JOBS)) {
    await boss.work(nom, {
      batchSize: 1,
      localConcurrency: Math.min(CONCURRENCE, def.concurrence || CONCURRENCE),
      groupConcurrency: def.parOrganisation || 4,
      pollingIntervalSeconds: 2,
    }, async ([job]) => {
      const debut = Date.now();
      const journal = (m) => console.log(`[worker ${nom} ${job.id.slice(0, 8)}] ${m}`);
      try {
        await def.executer(job.data || {}, { job, journal });
        journal(`terminé en ${Date.now() - debut} ms`);
      } catch (e) {
        journal(`échec : ${e.message}`);
        throw e; // pg-boss reprend selon la politique de la file
      }
    });
  }
  actif = true;
  console.log(`[worker] prêt : ${Object.keys(JOBS).join(', ')} (concurrence ${CONCURRENCE})`);
}

async function arreterWorker() {
  actif = false;
  await arreterFile();
}

module.exports = { demarrerWorker, arreterWorker };
