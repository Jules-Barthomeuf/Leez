// Stockage des fichiers de la plateforme : une seule interface
// (put / get / signedUrl / delete) et deux pilotes choisis par STORAGE_DRIVER.
//   local : le disque, sous UPLOAD_DIR/plateforme (developpement et tests).
//           Les liens signes sont des jetons HMAC servis par GET /api/storage/:jeton.
//   s3    : un stockage objet compatible S3 (Scaleway, Cloudflare R2, OVHcloud…),
//           pour la production. Les liens signes sont des URL presignees de 5 minutes :
//           Express ne sert jamais le fichier.
// Les cles sont derivees de l'organisation et du contenu : org/<org_id>/docs/<sha256>.
// Jamais du nom de fichier d'origine (docs/SPEC.md, section 21.2 et decision A1).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
const RACINE = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'), 'plateforme');
const DUREE_LIEN_S = 300;
const SECRET = process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-in-production';

/** Nom de fichier sur pour une en-tete Content-Disposition ou un chemin : pas de chemin, pas de caractere de controle. */
function nomSur(nom) {
  // eslint-disable-next-line no-control-regex
  const base = path.basename(String(nom || '')).replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').trim();
  const court = base.length > 180 ? base.slice(-180) : base;
  return court && court !== '.' && court !== '..' ? court : 'fichier';
}

/** La cle de stockage d'un document : org/<org_id>/docs/<sha256>. */
function cleDocument(orgId, sha256) {
  if (!/^[0-9a-f-]{36}$/i.test(String(orgId)) || !/^[0-9a-f]{64}$/.test(String(sha256))) throw new Error('cleDocument : org_id ou sha256 invalide');
  return `org/${orgId}/docs/${sha256}`;
}

function sha256DeFichier(chemin) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(chemin).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}
function sha256DeBuffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

async function enBuffer(flux) {
  const morceaux = [];
  for await (const m of flux) morceaux.push(Buffer.isBuffer(m) ? m : Buffer.from(m));
  return Buffer.concat(morceaux);
}

// ---------- pilote local ----------
function cheminAbsolu(cle) {
  const abs = path.resolve(RACINE, cle);
  if (!abs.startsWith(path.resolve(RACINE) + path.sep)) throw new Error('Chemin de stockage hors de la racine.');
  return abs;
}
function signature(donnees) { return crypto.createHmac('sha256', SECRET).update(donnees).digest('base64url'); }
/** Jeton de telechargement (pilote local), valable dureeS secondes. */
function signerLien({ cle, filename, mime }, dureeS = DUREE_LIEN_S) {
  const exp = Math.floor(Date.now() / 1000) + dureeS;
  const corps = Buffer.from(JSON.stringify({ k: cle, f: filename || 'fichier', m: mime || 'application/octet-stream', e: exp })).toString('base64url');
  return { jeton: `${corps}.${signature(corps)}`, expires_at: new Date(exp * 1000).toISOString() };
}
/** { cle, filename, mime } si le jeton est valide et non expire, sinon null. */
function verifierLien(jeton) {
  const [corps, sig] = String(jeton || '').split('.');
  if (!corps || !sig) return null;
  const attendue = signature(corps);
  if (sig.length !== attendue.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(attendue))) return null;
  try {
    const { k, f, m, e } = JSON.parse(Buffer.from(corps, 'base64url').toString('utf8'));
    if (!k || !e || e < Math.floor(Date.now() / 1000)) return null;
    return { cle: k, filename: f, mime: m };
  } catch {
    return null;
  }
}

const local = {
  nom: 'local',
  async put(cle, source) {
    const abs = cheminAbsolu(cle);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    if (Buffer.isBuffer(source)) await fs.promises.writeFile(abs, source);
    else if (typeof source === 'string') await fs.promises.copyFile(source, abs);
    else await fs.promises.writeFile(abs, await enBuffer(source));
  },
  async get(cle) {
    const abs = cheminAbsolu(cle);
    await fs.promises.access(abs);
    return fs.createReadStream(abs);
  },
  async exists(cle) { try { await fs.promises.access(cheminAbsolu(cle)); return true; } catch { return false; } },
  async delete(cle) { await fs.promises.rm(cheminAbsolu(cle), { force: true }); },
  async signedUrl(cle, { filename, mime, dureeS = DUREE_LIEN_S } = {}) {
    const { jeton, expires_at } = signerLien({ cle, filename, mime }, dureeS);
    return { url: `/api/storage/${jeton}`, expires_at };
  },
};

// ---------- pilote S3 ----------
let clientS3 = null;
function configS3() {
  const manque = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((v) => !process.env[v]);
  if (manque.length) throw new Error(`STORAGE_DRIVER=s3 : variables manquantes ${manque.join(', ')}`);
  return {
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
    // Scaleway, OVHcloud et R2 acceptent le style "chemin" (bucket dans le chemin) ; c'est le plus sur hors AWS.
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  };
}
function s3() {
  if (clientS3) return clientS3;
  const { S3Client } = require('@aws-sdk/client-s3');
  const c = configS3();
  clientS3 = { client: new S3Client({ region: c.region, endpoint: c.endpoint, credentials: c.credentials, forcePathStyle: c.forcePathStyle }), bucket: c.bucket };
  return clientS3;
}
const objet = {
  nom: 's3',
  async put(cle, source) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const { client, bucket } = s3();
    let body = source;
    let taille;
    if (typeof source === 'string') { taille = (await fs.promises.stat(source)).size; body = fs.createReadStream(source); }
    else if (Buffer.isBuffer(source)) taille = source.length;
    else body = await enBuffer(source);
    if (Buffer.isBuffer(body)) taille = body.length;
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: cle, Body: body, ContentLength: taille }));
  },
  async get(cle) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { client, bucket } = s3();
    const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: cle }));
    return r.Body instanceof Readable ? r.Body : Readable.fromWeb(r.Body);
  },
  async exists(cle) {
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    const { client, bucket } = s3();
    try { await client.send(new HeadObjectCommand({ Bucket: bucket, Key: cle })); return true; } catch (e) { if (e.$metadata && e.$metadata.httpStatusCode === 404) return false; if (e.name === 'NotFound') return false; throw e; }
  },
  async delete(cle) {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const { client, bucket } = s3();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: cle }));
  },
  async signedUrl(cle, { filename, mime, dureeS = DUREE_LIEN_S } = {}) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const { client, bucket } = s3();
    const commande = new GetObjectCommand({
      Bucket: bucket, Key: cle,
      ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(nomSur(filename))}`,
      ResponseContentType: mime || 'application/octet-stream',
    });
    const url = await getSignedUrl(client, commande, { expiresIn: dureeS });
    return { url, expires_at: new Date(Date.now() + dureeS * 1000).toISOString() };
  },
};

const PILOTES = { local, s3: objet };
function pilote() {
  const p = PILOTES[DRIVER];
  if (!p) throw new Error(`STORAGE_DRIVER inconnu : ${DRIVER} (local ou s3)`);
  return p;
}

/** Verifie la configuration au demarrage : leve une erreur lisible si le pilote s3 est choisi sans ses variables. */
function verifierConfiguration() {
  if (DRIVER === 's3') configS3();
  return { driver: DRIVER, racine: DRIVER === 'local' ? RACINE : null, bucket: DRIVER === 's3' ? process.env.S3_BUCKET : null };
}

const put = (cle, source) => pilote().put(cle, source);
const get = (cle) => pilote().get(cle);
const getBuffer = async (cle) => enBuffer(await pilote().get(cle));
const exists = (cle) => pilote().exists(cle);
const supprimer = (cle) => pilote().delete(cle);
const signedUrl = (cle, options) => pilote().signedUrl(cle, options);

module.exports = {
  DRIVER, RACINE, DUREE_LIEN_S, PILOTES, pilote, verifierConfiguration,
  nomSur, cleDocument, sha256DeFichier, sha256DeBuffer,
  put, get, getBuffer, exists, delete: supprimer, supprimer, signedUrl,
  signerLien, verifierLien, cheminAbsolu,
};
