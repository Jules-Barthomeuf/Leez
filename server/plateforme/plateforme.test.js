// Phase 0 (docs/SPEC.md, section 20) : migrations rejouables sur une base
// vide, isolation entre deux organisations (routes et requetes), un fichier
// depose cree un document et un job document.ingest visible dans le worker.
// Le serveur tourne dans un processus enfant sur une base jetable.
const test = require('node:test');
const assert = require('node:assert');
const AdmZip = require('adm-zip');
const { creerBaseJetable, lancerServeur, clientHttp, creerCompte } = require('./test-utils');
const St = require('./stockage');

let base; let serveur; let A; let B; let cA; let cB;

test.before(async () => {
  base = await creerBaseJetable();
  serveur = await lancerServeur(base.url);
  A = await creerCompte(base, { nomOrg: 'Fonds Alpha', email: 'alpha@test.leez', role: 'owner' });
  B = await creerCompte(base, { nomOrg: 'Fonds Beta', email: 'beta@test.leez', role: 'owner' });
  cA = clientHttp(serveur.url);
  cB = clientHttp(serveur.url);
  await cA.connecter(A.email, A.password);
  await cB.connecter(B.email, B.password);
});

test.after(async () => {
  if (serveur) await serveur.arreter();
  if (base) await base.supprimer();
});

test('migrations rejouables sur une base vide, puis retour arriere et retour avant', async () => {
  assert.ok(base.appliquees.some((m) => m.name.startsWith('020')), 'la migration 020 fait partie des migrations appliquées sur la base vide');
  const { rows } = await base.requete("SELECT table_name FROM information_schema.tables WHERE table_schema = 'plateforme' ORDER BY table_name");
  const tables = rows.map((r) => r.table_name);
  for (const t of ['deals', 'documents', 'document_pages', 'chunks', 'facts', 'evidence', 'deal_metrics', 'anomalies', 'deliverables', 'decisions', 'memory_entries', 'audit_events', 'llm_calls', 'public_data_cache', 'index_values', 'extraction_templates', 'criteria_sets']) {
    assert.ok(tables.includes(t), `table plateforme.${t}`);
  }
  const { rows: rls } = await base.requete("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'plateforme' AND c.relkind = 'r' AND NOT c.relrowsecurity");
  assert.deepEqual(rls.map((r) => r.relname).sort(), ['index_values', 'public_data_cache'], 'seules les tables sans org_id sont sans RLS');
  const deuxieme = await base.migrer('up');
  assert.equal(deuxieme.length, 0, 'rien a rejouer : les migrations sont idempotentes');
  await base.migrer('down', 1);
  const { rows: apres } = await base.requete("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'plateforme'");
  assert.equal(apres.length, 0, 'le retour arriere supprime le schema');
  const retour = await base.migrer('up');
  assert.equal(retour.length, 1);
});

test('isolation : aucune route ni requete ne renvoie les donnees d\'une autre organisation', async () => {
  const creation = await cA.post('/api/deals', { name: 'Rue de la Paix' });
  assert.equal(creation.status, 201, JSON.stringify(creation.json));
  const dealA = creation.json.deal;
  assert.equal(dealA.stage, 'reception');
  assert.equal(dealA.conformity, 'pending');

  const listeB = await cB.get('/api/deals');
  assert.equal(listeB.status, 200);
  assert.deepEqual(listeB.json.deals, [], 'B ne voit pas le deal de A');
  const listeA = await cA.get('/api/deals');
  assert.equal(listeA.json.deals.length, 1);

  for (const [methode, chemin, body] of [
    ['GET', `/api/deals/${dealA.id}`], ['PATCH', `/api/deals/${dealA.id}`, { name: 'Pirate' }],
    ['GET', `/api/deals/${dealA.id}/documents`],
  ]) {
    const r = await cB.appel(methode, chemin, body ? { body } : {});
    assert.equal(r.status, 404, `${methode} ${chemin} par B`);
    assert.equal(r.json.error.code, 'introuvable');
  }
  const depotB = await cB.envoyerFichiers(`/api/deals/${dealA.id}/uploads`, [{ nom: 'x.pdf', contenu: '%PDF-1.4 intrus' }]);
  assert.equal(depotB.status, 404);
  const relanceB = await cB.post(`/api/documents/${dealA.id}/reprocess`, { from: 'ingest' });
  assert.equal(relanceB.status, 404);

  // Sans session : rien.
  const anonyme = clientHttp(serveur.url);
  assert.equal((await anonyme.get('/api/deals')).status, 401);

  // Requete directe sous un role NON superutilisateur (le superutilisateur du Postgres embarque ignore la RLS) :
  // la RLS cache les lignes de A quand la session porte l'organisation B, un viewer ne peut pas ecrire,
  // et sans reglage de session rien n'est visible ni inserable.
  const role = `leez_rls_${Date.now().toString(36)}`;
  await base.requete(`CREATE ROLE ${role} LOGIN PASSWORD 'rls'`);
  await base.requete(`GRANT USAGE ON SCHEMA plateforme TO ${role}; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plateforme TO ${role}; GRANT SELECT ON users, workspaces TO ${role}`);
  const u = new URL(base.url);
  u.username = role;
  u.password = 'rls';
  const { Client } = require('pg');
  const c = new Client({ connectionString: u.toString() });
  await c.connect();
  try {
    const contexte = (org, r) => c.query("SELECT set_config('app.org_id', $1, true), set_config('app.role', $2, true)", [org, r]);
    await c.query('BEGIN');
    await contexte(B.orgId, 'analyst');
    assert.equal((await c.query('SELECT id FROM plateforme.deals')).rows.length, 0, 'RLS : B ne voit aucun deal de A');
    assert.equal((await c.query('SELECT count(*)::int AS n FROM plateforme.audit_events')).rows[0].n, 0, 'RLS : ni son journal');
    await c.query('ROLLBACK');
    await c.query('BEGIN');
    await contexte(A.orgId, 'analyst');
    assert.equal((await c.query('SELECT id FROM plateforme.deals')).rows.length, 1, 'RLS : A voit son deal');
    await c.query('ROLLBACK');
    await c.query('BEGIN');
    await contexte(A.orgId, 'viewer');
    await assert.rejects(c.query("INSERT INTO plateforme.deals (org_id, name) VALUES ($1, 'par un viewer')", [A.orgId]), /row-level security/, 'RLS : un viewer n\'ecrit pas');
    await c.query('ROLLBACK');
    await c.query('BEGIN');
    assert.equal((await c.query('SELECT id FROM plateforme.deals')).rows.length, 0, 'RLS : sans contexte, rien');
    await assert.rejects(c.query("INSERT INTO plateforme.deals (org_id, name) VALUES ($1, 'sans contexte')", [A.orgId]), /row-level security/);
    await c.query('ROLLBACK');
  } finally {
    await c.end();
    await base.requete(`DROP OWNED BY ${role}`);
    await base.requete(`DROP ROLE ${role}`);
  }

  // Le journal d'audit a la creation.
  const { rows: audit } = await base.requete("SELECT action, entity_id, org_id FROM plateforme.audit_events WHERE entity_id = $1 AND action = 'deal.create'", [dealA.id]);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].org_id, A.orgId);
});

test('un fichier depose cree un document et un job document.ingest visible dans le worker', async () => {
  const { json: { deal } } = await cA.post('/api/deals', { name: 'Avenue Victor Hugo' });
  const zip = new AdmZip();
  zip.addFile('data room/bail.pdf', Buffer.from('%PDF-1.4 bail'));
  zip.addFile('data room/etat locatif.xlsx', Buffer.from('xlsx'));
  zip.addFile('__MACOSX/._bail.pdf', Buffer.from('bruit'));
  zip.addFile('data room/notes.txt', Buffer.from('texte libre'));
  const teaser = '%PDF-1.4 teaser Avenue Victor Hugo';
  const depot = await cA.envoyerFichiers(`/api/deals/${deal.id}/uploads`, [
    { nom: 'Teaser Victor Hugo.pdf', contenu: teaser },
    { nom: 'Teaser (copie).pdf', contenu: teaser },
    { nom: 'data-room.zip', contenu: zip.toBuffer() },
    { nom: 'virus.exe', contenu: 'MZ' },
  ]);
  assert.equal(depot.status, 201, JSON.stringify(depot.json));
  assert.equal(depot.json.documents.length, 3);
  assert.deepEqual(depot.json.refuses.map((r) => r.filename), ['virus.exe']);
  assert.ok(depot.json.documents.every((d) => d.status === 'uploaded' && d.sha256 === null));

  // Le worker (dans le serveur) ingere : sha256, doublon, enfants du zip.
  let documents = [];
  const limite = Date.now() + 60000;
  while (Date.now() < limite) {
    documents = (await cA.get(`/api/deals/${deal.id}/documents`)).json.documents;
    const termines = documents.filter((d) => d.sha256 || ['failed', 'duplicate'].includes(d.status));
    if (documents.length >= 6 && termines.length === documents.length) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const parNom = Object.fromEntries(documents.map((d) => [d.filename, d]));
  assert.ok(parNom['Teaser Victor Hugo.pdf'].sha256, `teaser ingéré\n${serveur.journal()}`);
  assert.equal(parNom['Teaser Victor Hugo.pdf'].status, 'uploaded');
  assert.equal(parNom['Teaser (copie).pdf'].status, 'duplicate');
  assert.equal(parNom['Teaser (copie).pdf'].duplicate_of, parNom['Teaser Victor Hugo.pdf'].id);
  const zipDoc = parNom['data-room.zip'];
  assert.ok(zipDoc.sha256);
  const enfants = documents.filter((d) => d.parent_document_id === zipDoc.id);
  assert.deepEqual(enfants.map((d) => d.filename).sort(), ['bail.pdf', 'etat locatif.xlsx', 'notes.txt'], 'les entrees du zip deviennent des documents enfants, sans __MACOSX');
  assert.ok(enfants.find((d) => d.filename === 'bail.pdf').sha256, 'les enfants sont ingeres a leur tour');
  assert.equal(enfants.find((d) => d.filename === 'notes.txt').status, 'failed', 'un type non accepte dans le zip est mis en echec, pas cache');
  assert.match(enfants.find((d) => d.filename === 'notes.txt').error, /non pris en charge/);

  // Les jobs sont visibles : ingest a tourne, parse attend la phase 1.
  const jobs = (await cA.get('/api/jobs')).json.queues;
  const ingest = jobs.find((q) => q.name === 'document.ingest');
  const parse = jobs.find((q) => q.name === 'document.parse');
  assert.ok(ingest && ingest.total >= 5, `jobs document.ingest : ${JSON.stringify(ingest)}`);
  assert.ok(parse && parse.en_attente >= 3, `jobs document.parse en attente : ${JSON.stringify(parse)}`);
  const { rows: jobsEnBase } = await base.requete("SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'document.ingest' AND state = 'completed'");
  assert.ok(jobsEnBase[0].n >= 5);

  // Avancement sur la boite d'entree.
  const { json: { deals } } = await cA.get('/api/deals?q=hugo');
  assert.equal(deals.length, 1);
  assert.equal(deals[0].documents.total, 6);
  assert.equal(deals[0].documents.traites, 6);

  // Fichier par lien signe, 5 minutes, sans session ; un jeton forge est refuse.
  const lien = await cA.get(`/api/documents/${parNom['Teaser Victor Hugo.pdf'].id}/file`);
  assert.equal(lien.status, 200);
  assert.match(lien.json.url, /^\/api\/storage\//);
  const contenu = await fetch(serveur.url + lien.json.url);
  assert.equal(contenu.status, 200);
  assert.equal(await contenu.text(), teaser);
  assert.equal((await fetch(`${serveur.url}/api/storage/abc.def`)).status, 401);
  assert.equal(St.verifierLien(lien.json.url.replace('/api/storage/', '').replace(/.$/, 'x')), null);

  // Relance d'un document : idempotent, pas de doublon.
  const relance = await cA.post(`/api/documents/${zipDoc.id}/reprocess`, { from: 'ingest' });
  assert.equal(relance.status, 200);
  const limite2 = Date.now() + 30000;
  let apres = [];
  while (Date.now() < limite2) {
    apres = (await cA.get(`/api/deals/${deal.id}/documents`)).json.documents;
    const z = apres.find((d) => d.id === zipDoc.id);
    if (z && z.sha256 && apres.filter((d) => d.parent_document_id === zipDoc.id).every((d) => d.sha256 || d.status === 'failed')) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(apres.length, 6, 'relancer ingest ne recree pas les enfants');
  assert.equal((await cA.post(`/api/documents/${zipDoc.id}/reprocess`, { from: 'parse' })).status, 501);

  // Un viewer lit mais n'ecrit pas.
  const V = await creerCompte(base, { nomOrg: 'ignoré', email: 'viewer@test.leez', role: 'viewer' });
  await base.requete('UPDATE users SET workspace_id = $1 WHERE id = $2', [A.orgId, V.userId]);
  const cV = clientHttp(serveur.url);
  await cV.connecter(V.email, V.password);
  assert.equal((await cV.get(`/api/deals/${deal.id}`)).status, 200);
  assert.equal((await cV.post('/api/deals', { name: 'Interdit' })).status, 403);
  assert.equal((await cV.patch('/api/org/settings', { name: 'X' })).status, 403);

  // Reglages de l'organisation.
  const org = await cA.get('/api/org/settings');
  assert.equal(org.json.organization.settings.acquisition_fee_rate, '0.075');
  const modif = await cA.patch('/api/org/settings', { settings: { acquisition_fee_rate: '0.08' }, slug: 'fonds-alpha' });
  assert.equal(modif.status, 200, JSON.stringify(modif.json));
  assert.equal(modif.json.organization.settings.acquisition_fee_rate, '0.08');
  assert.equal(modif.json.organization.slug, 'fonds-alpha');
  assert.equal((await cA.patch('/api/org/settings', { settings: { acquisition_fee_rate: 0.08 } })).status, 400);
});
