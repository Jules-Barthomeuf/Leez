// Stockage (decision A1) : depot → lecture → lien signe → suppression sur le
// pilote local, et le meme parcours sur S3 quand les variables sont la
// (sinon le test est saute, proprement).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'leez-stockage-'));
process.env.UPLOAD_DIR = dossier;
process.env.SESSION_SECRET = 'secret-de-test';
const St = require('./stockage');

const ORG = '11111111-2222-4333-8444-555555555555';
const contenu = Buffer.from('%PDF-1.4 contenu de test');
const sha = St.sha256DeBuffer(contenu);

test('cles derivees de l\'organisation et du sha256, jamais du nom', () => {
  assert.equal(St.cleDocument(ORG, sha), `org/${ORG}/docs/${sha}`);
  assert.throws(() => St.cleDocument('pas-un-uuid', sha));
  assert.throws(() => St.cleDocument(ORG, 'abc'));
  assert.equal(St.nomSur('../../etc/passwd'), 'passwd');
  assert.equal(St.nomSur('Teaser (copie).pdf'), 'Teaser (copie).pdf');
});

test('pilote local : depot, lecture, lien signe, suppression', async () => {
  const p = St.PILOTES.local;
  const cle = St.cleDocument(ORG, sha);
  await p.put(cle, contenu);
  assert.ok(await p.exists(cle));
  const lu = [];
  for await (const m of await p.get(cle)) lu.push(m);
  assert.equal(Buffer.concat(lu).toString(), contenu.toString());
  // Depuis un fichier temporaire (cas du multipart).
  const tmp = path.join(dossier, 'tmp.bin');
  fs.writeFileSync(tmp, 'autre');
  const sha2 = St.sha256DeBuffer(Buffer.from('autre'));
  assert.equal(await St.sha256DeFichier(tmp), sha2);
  await p.put(St.cleDocument(ORG, sha2), tmp);
  assert.ok(await p.exists(St.cleDocument(ORG, sha2)));

  const { url, expires_at } = await p.signedUrl(cle, { filename: 'Bail.pdf', mime: 'application/pdf' });
  assert.match(url, /^\/api\/storage\//);
  assert.ok(new Date(expires_at) - Date.now() <= 300 * 1000 + 1000);
  const lien = St.verifierLien(url.replace('/api/storage/', ''));
  assert.deepEqual(lien, { cle, filename: 'Bail.pdf', mime: 'application/pdf' });
  assert.equal(St.verifierLien(url.replace('/api/storage/', '').replace(/.$/, 'x')), null, 'jeton altéré refusé');
  const expire = St.signerLien({ cle }, -1);
  assert.equal(St.verifierLien(expire.jeton), null, 'jeton expiré refusé');

  await p.delete(cle);
  assert.equal(await p.exists(cle), false);
  await p.delete(cle); // idempotent
  assert.throws(() => St.cheminAbsolu('../hors-racine'));
});

const varsS3 = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
const s3Pret = varsS3.every((v) => process.env[v]);
test('pilote s3 : depot, lecture, lien signe, suppression', { skip: s3Pret ? false : `variables absentes : ${varsS3.filter((v) => !process.env[v]).join(', ')}` }, async () => {
  const p = St.PILOTES.s3;
  const cle = `org/${ORG}/tests/${sha}`;
  await p.put(cle, contenu);
  assert.ok(await p.exists(cle));
  const lu = [];
  for await (const m of await p.get(cle)) lu.push(m);
  assert.equal(Buffer.concat(lu).toString(), contenu.toString());
  const { url } = await p.signedUrl(cle, { filename: 'test.pdf', mime: 'application/pdf', dureeS: 120 });
  assert.match(url, /^https?:\/\//);
  const r = await fetch(url);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), contenu.toString());
  await p.delete(cle);
  assert.equal(await p.exists(cle), false);
});
