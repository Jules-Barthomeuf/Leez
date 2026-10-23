// Le worker de la plateforme : consomme les files pg-boss avec les jobs du
// registre (./jobs). Tourne dans le processus web par defaut (WORKER_INLINE
// absent ou 'true'), ou seul via `node server/worker.js`. La concurrence est
// bornee par file et par organisation (groupe pg-boss = org_id).
const { demarrerFile, arreterFile } = require('./file');
const JOBS = require('./jobs');

let actif = false;

async function demarrerWorker() {
  if (actif) return;
  const boss = await demarrerFile();
  for (const [nom, def] of Object.entries(JOBS)) {
    await boss.work(nom, {
      batchSize: 1,
      localConcurrency: def.concurrence || 1,
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
  console.log(`[worker] prêt : ${Object.keys(JOBS).join(', ')}`);
}

async function arreterWorker() {
  actif = false;
  await arreterFile();
}

module.exports = { demarrerWorker, arreterWorker };
