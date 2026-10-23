// Decision A4 : le web demarre sans worker (WORKER_INLINE=false), le worker
// demarre seul (`npm run worker`) sur la meme base et le meme stockage, et un
// document depose est ingere par ce worker separe. Verifie aussi la limite
// MAX_UPLOAD_MB cote API.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { creerBaseJetable, lancerServeur, lancerWorker, clientHttp, creerCompte } = require('./test-utils');

let base; let web; let worker; let client; let deal;
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'leez-test-worker-'));

test.before(async () => {
  base = await creerBaseJetable();
  web = await lancerServeur(base.url, { dossier, env: { WORKER_INLINE: 'false', MAX_UPLOAD_MB: '1' } });
  const compte = await creerCompte(base, { nomOrg: 'Fonds Worker', email: 'worker@test.leez' });
  client = clientHttp(web.url);
  await client.connecter(compte.email, compte.password);
  deal = (await client.post('/api/deals', { name: 'Dossier worker séparé' })).json.deal;
});

test.after(async () => {
  if (worker) await worker.arreter();
  if (web) await web.arreter();
  if (base) await base.supprimer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('WORKER_INLINE=false : le web accepte le depot mais personne n\'ingere', async () => {
  assert.ok(!web.journal().includes('[worker] prêt'), 'le web ne démarre pas de worker');
  const depot = await client.envoyerFichiers(`/api/deals/${deal.id}/uploads`, [{ nom: 'teaser.pdf', contenu: '%PDF-1.4 worker' }]);
  assert.equal(depot.status, 201, JSON.stringify(depot.json));
  assert.equal(depot.json.documents[0].status, 'uploaded');
  assert.ok(depot.json.documents[0].sha256, 'le sha256 est calculé au dépôt (clé de stockage par contenu)');
  await new Promise((r) => setTimeout(r, 2500));
  const jobs = (await client.get('/api/jobs')).json.queues.find((q) => q.name === 'document.ingest');
  assert.equal(jobs.en_attente, 1, `le job attend un worker : ${JSON.stringify(jobs)}`);
});

test('MAX_UPLOAD_MB : un fichier trop gros est refuse avec un message clair', async () => {
  const gros = Buffer.alloc(1.5 * 1048576, 'x');
  const r = await client.envoyerFichiers(`/api/deals/${deal.id}/uploads`, [{ nom: 'gros.pdf', contenu: gros }]);
  assert.equal(r.status, 413);
  assert.equal(r.json.error.code, 'taille_fichier');
  assert.match(r.json.error.message, /1 Mo au plus/);
  const limites = (await client.get('/api/org/settings')).json.organization.limites;
  assert.equal(limites.max_upload_mb, 1);
});

test('npm run worker : le worker seul ingere le document depose', async () => {
  worker = await lancerWorker(base.url, { dossier });
  let documents = [];
  const limite = Date.now() + 60000;
  while (Date.now() < limite) {
    documents = (await client.get(`/api/deals/${deal.id}/documents`)).json.documents;
    const jobs = (await client.get('/api/jobs')).json.queues.find((q) => q.name === 'document.ingest');
    if (jobs.termines >= 1 && documents.every((d) => d.sha256)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const jobs = (await client.get('/api/jobs')).json.queues;
  assert.ok(jobs.find((q) => q.name === 'document.ingest').termines >= 1, `ingest terminé par le worker séparé\n${worker.journal()}`);
  assert.ok(jobs.find((q) => q.name === 'document.parse').en_attente >= 1, 'parse mis en file par le worker');
  assert.ok(worker.journal().includes('document.ingest'), 'le job est passé par le processus worker');
  // Le fichier est lisible via le lien signe, servi par le web depuis le stockage partage.
  const lien = await client.get(`/api/documents/${documents[0].id}/file`);
  assert.equal(lien.status, 200);
  const contenu = await fetch(web.url + lien.json.url);
  assert.equal(await contenu.text(), '%PDF-1.4 worker');
});
