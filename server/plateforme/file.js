// La file de jobs de la plateforme (spec, section 4) : pg-boss dans le
// Postgres existant, schema `pgboss`. Une file par type de job, avec les
// reprises de la spec (3 tentatives, delai exponentiel a partir de 30 s). Les
// jobs portent org_id dans leurs donnees ; c'est aussi leur groupe pg-boss,
// ce qui borne la concurrence par organisation cote worker.
const { PgBoss } = require('pg-boss');
const { needsSsl } = require('../db');

const REPRISES = { retryLimit: 3, retryDelay: 30, retryBackoff: true, retryDelayMax: 600 };
const FILES = {
  'document.ingest': { ...REPRISES, expireInSeconds: 600 },
  'document.parse': { ...REPRISES, expireInSeconds: 1800 },
  'document.classify': { ...REPRISES, expireInSeconds: 600 },
  'document.index': { ...REPRISES, expireInSeconds: 1800 },
  'document.extract': { ...REPRISES, expireInSeconds: 3600 },
  'deal.resolve': { ...REPRISES, expireInSeconds: 600 },
  'deal.metrics': { ...REPRISES, expireInSeconds: 300 },
  'deal.reconcile': { ...REPRISES, expireInSeconds: 300 },
  'deal.evaluate': { ...REPRISES, expireInSeconds: 300 },
  'deliverable.generate': { ...REPRISES, expireInSeconds: 1800 },
  'memory.record': { ...REPRISES, expireInSeconds: 300 },
  'deal.purge': { ...REPRISES, expireInSeconds: 1800 },
};

let boss = null;
let demarrage = null;

async function demarrerFile() {
  if (boss) return boss;
  if (demarrage) return demarrage;
  demarrage = (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL absente : la file de jobs a besoin de la base.');
    const b = new PgBoss({
      connectionString: url,
      ssl: needsSsl(url) ? { rejectUnauthorized: false } : false,
      schema: 'pgboss',
      application_name: 'leez-plateforme',
      max: 4,
    });
    b.on('error', (e) => console.error('[file] ', e && e.message ? e.message : e));
    await b.start();
    const existantes = new Set((await b.getQueues()).map((q) => q.name));
    for (const [nom, options] of Object.entries(FILES)) {
      if (!existantes.has(nom)) await b.createQueue(nom, options);
    }
    boss = b;
    return b;
  })();
  try { return await demarrage; } finally { demarrage = null; }
}

/** Met un job en file. org_id des donnees devient le groupe du job. Rend l'id du job (null si refuse par une cle singleton). */
async function envoyer(nom, donnees, options = {}) {
  if (!FILES[nom]) throw new Error(`File inconnue : ${nom}`);
  const b = await demarrerFile();
  const groupe = donnees && donnees.org_id ? { group: { id: String(donnees.org_id) } } : {};
  return b.send(nom, donnees, { ...groupe, ...options });
}

/** Etat des files pour l'interface : en attente, actifs, en echec. Compte directement dans la table des jobs
 * (les compteurs de pg-boss datent de son dernier passage de surveillance). */
async function etatFiles() {
  await demarrerFile();
  const { pool } = require('../db');
  const noms = Object.keys(FILES);
  const { rows } = await pool.query('SELECT name, state, count(*)::int AS n FROM pgboss.job WHERE name = ANY($1) GROUP BY name, state', [noms]);
  const par = Object.fromEntries(noms.map((n) => [n, { name: n, en_attente: 0, actifs: 0, echoues: 0, termines: 0, total: 0 }]));
  for (const r of rows) {
    const q = par[r.name];
    q.total += r.n;
    if (r.state === 'created' || r.state === 'retry') q.en_attente += r.n;
    else if (r.state === 'active') q.actifs += r.n;
    else if (r.state === 'failed') q.echoues += r.n;
    else if (r.state === 'completed') q.termines += r.n;
  }
  return noms.map((n) => par[n]);
}

/** Les jobs d'une file (tests et diagnostic). */
async function trouverJobs(nom, options = {}) {
  const b = await demarrerFile();
  return b.findJobs(nom, options);
}

async function arreterFile() {
  if (!boss) return;
  const b = boss;
  boss = null;
  await b.stop({ graceful: true, timeout: 5000 }).catch(() => {});
}

module.exports = { FILES, demarrerFile, envoyer, etatFiles, trouverJobs, arreterFile };
