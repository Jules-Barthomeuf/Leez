// Outils des tests de la plateforme : une base Postgres jetable (creee sur le
// serveur local, migrations appliquees), un serveur Leez lance dans un
// processus enfant sur cette base, un client HTTP qui garde ses cookies, et
// la creation directe de comptes.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { Client } = require('pg');
const { hashPassword } = require('../auth/passwords');

async function urlAdmin() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { ensureLocalPostgres, LOCAL_DATABASE_URL } = require('../localPostgres');
  await ensureLocalPostgres();
  return LOCAL_DATABASE_URL;
}

async function requeteAdmin(admin, sql) {
  const c = new Client({ connectionString: admin });
  await c.connect();
  try { return await c.query(sql); } finally { await c.end(); }
}

/** Cree une base vide et y rejoue toutes les migrations. */
async function creerBaseJetable() {
  const admin = await urlAdmin();
  const nom = `leez_test_${crypto.randomBytes(4).toString('hex')}`;
  await requeteAdmin(admin, `CREATE DATABASE ${nom}`);
  const u = new URL(admin);
  u.pathname = `/${nom}`;
  const url = u.toString();
  const { runner } = require('node-pg-migrate');
  const appliquees = await runner({ databaseUrl: url, dir: path.join(__dirname, '..', 'migrations'), direction: 'up', migrationsTable: 'pgmigrations', log: () => {} });
  return {
    url, nom, admin, appliquees,
    async migrer(direction, count) {
      return runner({ databaseUrl: url, dir: path.join(__dirname, '..', 'migrations'), direction, count, migrationsTable: 'pgmigrations', log: () => {} });
    },
    async requete(sql, params) {
      const c = new Client({ connectionString: url });
      await c.connect();
      try { return await c.query(sql, params); } finally { await c.end(); }
    },
    async supprimer() {
      await requeteAdmin(admin, `DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
    },
  };
}

/** Lance `node server/index.js` sur la base donnee et attend qu'il reponde. */
async function lancerServeur(urlBase, { env: supplement = {}, dossier: dossierImpose } = {}) {
  const port = 3200 + Math.floor(Math.random() * 600);
  const dossier = dossierImpose || fs.mkdtempSync(path.join(os.tmpdir(), 'leez-test-'));
  const env = {
    ...process.env,
    DATABASE_URL: urlBase, PORT: String(port), SESSION_SECRET: 'secret-de-test', NODE_ENV: 'test',
    NODE_TEST_CONTEXT: '1', // la Prospection ne reprend pas sa file d'analyses dans un serveur de test
    UPLOAD_DIR: path.join(dossier, 'uploads'), PROSPECTION_DIR: path.join(dossier, 'prospection'),
    LEEZ_ACCES_LIBRE: '', WORKER_INLINE: 'true', POSTHOG_API_KEY: '', SENTRY_DSN: '', BOOTSTRAP_ADMIN_PASSWORD: '',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'cle-de-test',
    ...supplement,
  };
  const enfant = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const journal = [];
  enfant.stdout.on('data', (d) => journal.push(String(d)));
  enfant.stderr.on('data', (d) => journal.push(String(d)));
  const url = `http://127.0.0.1:${port}`;
  const limite = Date.now() + 90000;
  let pret = false;
  while (Date.now() < limite && !pret) {
    if (enfant.exitCode !== null) throw new Error(`Le serveur de test s'est arrêté :\n${journal.join('')}`);
    try { pret = (await fetch(`${url}/healthz`)).ok; } catch { /* pas encore la */ }
    if (!pret) await new Promise((r) => setTimeout(r, 300));
  }
  if (!pret) { enfant.kill('SIGKILL'); throw new Error(`Le serveur de test ne répond pas :\n${journal.join('')}`); }
  return {
    url, dossier, journal: () => journal.join(''),
    async arreter() {
      if (enfant.exitCode !== null) return;
      enfant.kill('SIGTERM');
      await new Promise((r) => { enfant.on('exit', r); setTimeout(() => { enfant.kill('SIGKILL'); }, 5000); });
      fs.rmSync(dossier, { recursive: true, force: true });
    },
  };
}

/** Lance `node server/worker.js` seul sur la base donnee (meme dossier de stockage que le web) et attend qu'il soit pret. */
async function lancerWorker(urlBase, { dossier, env: supplement = {} } = {}) {
  const env = {
    ...process.env,
    DATABASE_URL: urlBase, NODE_ENV: 'test', NODE_TEST_CONTEXT: '1', SESSION_SECRET: 'secret-de-test',
    UPLOAD_DIR: path.join(dossier, 'uploads'), PROSPECTION_DIR: path.join(dossier, 'prospection'), SENTRY_DSN: '',
    ...supplement,
  };
  const enfant = spawn(process.execPath, [path.join(__dirname, '..', 'worker.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const journal = [];
  enfant.stdout.on('data', (d) => journal.push(String(d)));
  enfant.stderr.on('data', (d) => journal.push(String(d)));
  const limite = Date.now() + 90000;
  while (Date.now() < limite && !journal.join('').includes('[worker] prêt')) {
    if (enfant.exitCode !== null) throw new Error(`Le worker de test s'est arrêté :\n${journal.join('')}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!journal.join('').includes('[worker] prêt')) { enfant.kill('SIGKILL'); throw new Error(`Le worker de test ne démarre pas :\n${journal.join('')}`); }
  return {
    journal: () => journal.join(''),
    async arreter() {
      if (enfant.exitCode !== null) return;
      enfant.kill('SIGTERM');
      await new Promise((r) => { enfant.on('exit', r); setTimeout(() => { enfant.kill('SIGKILL'); }, 5000); });
    },
  };
}

/** Client HTTP minimal avec cookies de session. */
function clientHttp(base) {
  let cookie = '';
  async function appel(methode, chemin, { body, formData } = {}) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    let payload;
    if (formData) payload = formData;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(base + chemin, { method: methode, headers, body: payload });
    const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    if (sc.length) cookie = sc.map((s) => s.split(';')[0]).join('; ');
    const type = r.headers.get('content-type') || '';
    const json = type.includes('json') ? await r.json().catch(() => null) : null;
    const buffer = json ? null : Buffer.from(await r.arrayBuffer());
    return { status: r.status, json, buffer, headers: r.headers };
  }
  return {
    appel,
    get: (p) => appel('GET', p),
    post: (p, body) => appel('POST', p, { body }),
    patch: (p, body) => appel('PATCH', p, { body }),
    envoyerFichiers: (p, fichiers) => {
      const fd = new FormData();
      for (const f of fichiers) fd.append('files', new Blob([f.contenu]), f.nom);
      return appel('POST', p, { formData: fd });
    },
    async connecter(email, password) {
      const r = await appel('POST', '/api/auth/login', { body: { email, password } });
      if (r.status !== 200) throw new Error(`Connexion refusée pour ${email} : ${JSON.stringify(r.json)}`);
      return r.json;
    },
  };
}

/** Cree une organisation (workspace) et un compte membre directement en base. */
async function creerCompte(base, { nomOrg, email, password = 'motdepasse-test', role = 'owner', name = null }) {
  const { rows: [w] } = await base.requete('INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING id', [nomOrg, `${nomOrg.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(2).toString('hex')}`]);
  const { rows: [u] } = await base.requete(
    'INSERT INTO users (workspace_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [w.id, email, await hashPassword(password), name, role],
  );
  return { orgId: w.id, userId: u.id, email, password };
}

module.exports = { creerBaseJetable, lancerServeur, lancerWorker, clientHttp, creerCompte };
