// Routes /api de la plateforme (spec, section 16.1), phase 0 : deals,
// documents (depot, liste, relance, fichier signe), organisation, etat des
// files. Chaque entree est validee par Zod, chaque requete passe par avecOrg()
// (RLS), chaque action utilisateur est journalisee dans audit_events.
//
// Deux routeurs : `publique` (lien signe de telechargement, monte avant
// requireAuth) et `router` (tout le reste, monte apres requireWorkspace et
// AVANT l'ancien routeur documents, qui expose aussi GET /documents/:id/file :
// quand l'id n'est pas un document de la plateforme, on passe la main).
const express = require('express');
const multer = require('multer');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { avecOrg, uuidValide, pool } = require('./db');
const St = require('./stockage');
const { envoyer, etatFiles } = require('./file');
const { journaliser } = require('./audit');
const Core = require('../../packages/core');
const { z, valider } = Core;
const { ErreurApi, introuvable, interdit, gererErreurs } = require('./erreurs');

const router = express.Router();
const publique = express.Router();

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ctx = (req) => ({ orgId: req.workspaceId, userId: req.userId, role: req.userRole || 'analyst' });
const dansOrg = (req, fn) => { const c = ctx(req); return avecOrg(c.orgId, c.role, (client) => fn(client, c)); };
const exigerRole = (...roles) => (req, res, next) => (roles.includes(ctx(req).role) ? next() : next(interdit()));
function idParam(req, nom = 'id') { const v = req.params[nom]; if (!uuidValide(v)) throw introuvable(); return v; }
const estLectureSeule = (req) => ctx(req).role === 'viewer';

// ---------- Deals ----------
const SELECT_DEAL = `
  SELECT d.*, u.email AS assigned_email,
    (SELECT count(*)::int FROM plateforme.documents x WHERE x.deal_id = d.id) AS documents_total,
    (SELECT count(*)::int FROM plateforme.documents x WHERE x.deal_id = d.id AND (x.sha256 IS NOT NULL OR x.status IN ('failed', 'duplicate'))) AS documents_traites,
    (SELECT count(*)::int FROM plateforme.documents x WHERE x.deal_id = d.id AND x.status = 'failed') AS documents_en_echec,
    (SELECT count(*)::int FROM plateforme.documents x WHERE x.deal_id = d.id AND x.doc_type = 'a_classer') AS documents_a_classer,
    (SELECT f.value FROM plateforme.facts f WHERE f.deal_id = d.id AND f.document_id IS NULL AND f.lot_key = 'main' AND f.field_key = 'prix_fai' AND f.is_current AND f.status IN ('verified', 'human') LIMIT 1) AS prix_fai,
    (SELECT m.value FROM plateforme.deal_metrics m WHERE m.deal_id = d.id AND m.lot_key = 'main' AND m.metric_key = 'rendement_aem') AS rendement_aem
  FROM plateforme.deals d LEFT JOIN users u ON u.id = d.assigned_to`;

function formatDeal(d) {
  return {
    id: d.id, name: d.name, stage: d.stage, conformity: d.conformity, source: d.source,
    assigned_to: d.assigned_to, assigned_email: d.assigned_email || null, created_by: d.created_by,
    created_at: d.created_at, updated_at: d.updated_at, archived_at: d.archived_at, links_to_fetch: d.links_to_fetch || [],
    prix_fai: d.prix_fai || null, rendement_aem: d.rendement_aem || null,
    documents: { total: d.documents_total, traites: d.documents_traites, en_echec: d.documents_en_echec, a_classer: d.documents_a_classer },
  };
}

const FiltresDeals = z.object({
  stage: z.enum(Core.ETAPES).optional(),
  conformity: z.enum(Core.CONFORMITES).optional(),
  assigned: z.string().max(64).optional(),
  q: z.string().max(200).optional(),
  archived: z.enum(['true', 'false']).optional(),
});
router.get('/deals', h(async (req, res) => {
  const f = valider(FiltresDeals, req.query);
  // Filtre explicite par organisation en plus de la RLS : un superutilisateur Postgres (base locale) l'ignore.
  const params = [ctx(req).orgId];
  const conds = ['d.org_id = $1'];
  if (f.archived !== 'true') conds.push('d.archived_at IS NULL');
  if (f.stage) { params.push(f.stage); conds.push(`d.stage = $${params.length}`); }
  if (f.conformity) { params.push(f.conformity); conds.push(`d.conformity = $${params.length}`); }
  if (f.assigned === 'me') { params.push(req.userId); conds.push(`d.assigned_to = $${params.length}`); }
  else if (f.assigned === 'none') conds.push('d.assigned_to IS NULL');
  else if (f.assigned && uuidValide(f.assigned)) { params.push(f.assigned); conds.push(`d.assigned_to = $${params.length}`); }
  if (f.q) { params.push(`%${f.q.trim()}%`); conds.push(`d.name ILIKE $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await dansOrg(req, (c) => c.query(`${SELECT_DEAL} ${where} ORDER BY d.updated_at DESC LIMIT 500`, params));
  res.json({ deals: rows.map(formatDeal) });
}));

const NouveauDeal = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  source: z.enum(Core.SOURCES_DEAL).default('upload'),
});
router.post('/deals', h(async (req, res) => {
  if (estLectureSeule(req)) throw interdit();
  const b = valider(NouveauDeal, req.body || {});
  const nom = b.name || `Nouveau dossier du ${new Date().toLocaleDateString('fr-FR')}`;
  const deal = await dansOrg(req, async (c, { orgId, userId }) => {
    const { rows: [d] } = await c.query(
      'INSERT INTO plateforme.deals (org_id, name, source, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [orgId, nom, b.source, userId],
    );
    await c.query("INSERT INTO plateforme.lots (org_id, deal_id, lot_key, label) VALUES ($1, $2, 'main', 'Lot principal')", [orgId, d.id]);
    await c.query('INSERT INTO plateforme.deal_stage_events (org_id, deal_id, from_stage, to_stage, by_user) VALUES ($1, $2, NULL, $3, $4)', [orgId, d.id, d.stage, userId]);
    await journaliser(c, { orgId, acteur: userId, action: 'deal.create', type: 'deal', id: d.id, payload: { name: nom, source: b.source } });
    return chargerDeal(c, d.id, orgId);
  });
  res.status(201).json({ deal: formatDeal(deal) });
}));

async function chargerDeal(c, id, orgId) {
  const { rows: [d] } = await c.query(`${SELECT_DEAL} WHERE d.id = $1 AND d.org_id = $2`, [id, orgId]);
  if (!d) throw introuvable('Dossier');
  return d;
}

router.get('/deals/:id', h(async (req, res) => {
  const id = idParam(req);
  const r = await dansOrg(req, async (c, { orgId }) => {
    const d = await chargerDeal(c, id, orgId);
    const { rows: lots } = await c.query('SELECT id, lot_key, label FROM plateforme.lots WHERE deal_id = $1 AND org_id = $2 ORDER BY created_at', [id, orgId]);
    const { rows: etapes } = await c.query('SELECT from_stage, to_stage, by_user, note, created_at FROM plateforme.deal_stage_events WHERE deal_id = $1 AND org_id = $2 ORDER BY created_at', [id, orgId]);
    return { ...formatDeal(d), lots, stage_events: etapes };
  });
  res.json({ deal: r });
}));

const ModifDeal = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
});
router.patch('/deals/:id', h(async (req, res) => {
  if (estLectureSeule(req)) throw interdit();
  const id = idParam(req);
  const b = valider(ModifDeal, req.body || {});
  const deal = await dansOrg(req, async (c, { orgId, userId }) => {
    await chargerDeal(c, id, orgId);
    if (b.assigned_to) {
      const { rows } = await c.query('SELECT id FROM users WHERE id = $1 AND workspace_id = $2', [b.assigned_to, orgId]);
      if (!rows.length) throw new ErreurApi(400, 'membre', "Cette personne n'est pas membre de l'organisation.");
    }
    await c.query(
      'UPDATE plateforme.deals SET name = COALESCE($2, name), assigned_to = CASE WHEN $3::boolean THEN $4::uuid ELSE assigned_to END, updated_at = now() WHERE id = $1 AND org_id = $5',
      [id, b.name ?? null, b.assigned_to !== undefined, b.assigned_to ?? null, orgId],
    );
    await journaliser(c, { orgId, acteur: userId, action: 'deal.update', type: 'deal', id, payload: b });
    return chargerDeal(c, id, orgId);
  });
  res.json({ deal: formatDeal(deal) });
}));

// ---------- Documents ----------
const TMP = path.join(os.tmpdir(), 'leez-plateforme-uploads');
fs.mkdirSync(TMP, { recursive: true });
// Taille maximale par fichier : MAX_UPLOAD_MB (defaut 100). Lue ici et dans le worker (packages/core, LIMITES).
const upload = multer({ storage: multer.diskStorage({ destination: TMP }), limits: { fileSize: Core.LIMITES.taille_fichier, files: 50 } });
// Les navigateurs envoient le nom de fichier en latin1 dans le multipart : on le remet en UTF-8.
const nomOriginal = (f) => { try { return Buffer.from(f.originalname, 'latin1').toString('utf8'); } catch { return f.originalname; } };

function formatDocument(d) {
  return {
    id: d.id, deal_id: d.deal_id, parent_document_id: d.parent_document_id, page_range: d.page_range,
    filename: d.filename, mime: d.mime, sha256: d.sha256, size_bytes: d.size_bytes == null ? null : Number(d.size_bytes), page_count: d.page_count,
    doc_type: d.doc_type, doc_type_confidence: d.doc_type_confidence, doc_type_source: d.doc_type_source,
    status: d.status, error: d.error, document_date: d.document_date, duplicate_of: d.duplicate_of, created_at: d.created_at,
  };
}

/**
 * Insere un document ; si le dossier a deja ce contenu (meme sha256, pas un segment), la ligne est creee
 * en `duplicate` avec `duplicate_of`. Un depot simultane du meme contenu est rattrape par l'index unique.
 */
async function insererDocument(c, { orgId, dealId, filename, mime, size, sha, cle, parentId = null }) {
  const existant = () => c.query(
    'SELECT id FROM plateforme.documents WHERE deal_id = $1 AND sha256 = $2 AND org_id = $3 AND page_range IS NULL AND duplicate_of IS NULL ORDER BY created_at LIMIT 1',
    [dealId, sha, orgId],
  );
  const inserer = (dup) => c.query(
    `INSERT INTO plateforme.documents (org_id, deal_id, parent_document_id, filename, mime, size_bytes, sha256, storage_path, status, duplicate_of)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [orgId, dealId, parentId, filename, mime, size, sha, cle, dup ? 'duplicate' : 'uploaded', dup],
  );
  const { rows: [deja] } = await existant();
  await c.query('SAVEPOINT depot');
  try {
    return (await inserer(deja ? deja.id : null)).rows[0];
  } catch (e) {
    if (e.code !== '23505') throw e;
    await c.query('ROLLBACK TO SAVEPOINT depot');
    const { rows: [autre] } = await existant();
    return (await inserer(autre ? autre.id : null)).rows[0];
  }
}

router.post('/deals/:id/uploads', upload.array('files', 50), h(async (req, res) => {
  const id = idParam(req);
  const fichiers = req.files || [];
  const nettoyer = () => Promise.all(fichiers.map((f) => fs.promises.unlink(f.path).catch(() => {})));
  if (estLectureSeule(req)) { await nettoyer(); throw interdit(); }
  if (!fichiers.length) throw new ErreurApi(400, 'aucun_fichier', 'Aucun fichier reçu (champ multipart « files »).');
  const refuses = [];
  const acceptes = [];
  for (const f of fichiers) {
    const nom = nomOriginal(f);
    const type = Core.typeDeFichier(nom);
    if (type) acceptes.push({ f, nom, type });
    else { refuses.push({ filename: nom, raison: 'Type de fichier non pris en charge.' }); await fs.promises.unlink(f.path).catch(() => {}); }
  }
  let documents;
  try {
    documents = await dansOrg(req, async (c, { orgId, userId }) => {
      const deal = await chargerDeal(c, id, orgId);
      if (deal.archived_at) throw new ErreurApi(409, 'archive', 'Ce dossier est archivé.');
      if (deal.documents_total + acceptes.length > Core.LIMITES.documents_par_deal) throw new ErreurApi(409, 'limite_documents', `Limite de ${Core.LIMITES.documents_par_deal} documents par dossier.`);
      const crees = [];
      for (const { f, nom, type } of acceptes) {
        // La cle de stockage depend du contenu (sha256), jamais du nom : deux depots identiques partagent le meme objet.
        const sha = await St.sha256DeFichier(f.path);
        const cle = St.cleDocument(orgId, sha);
        await St.put(cle, f.path);
        // Un meme contenu deja present dans le dossier : le document est cree marque doublon (duplicate_of),
        // sans job d'ingestion. L'index unique (deal, sha256) arbitre les depots simultanes.
        const doc = await insererDocument(c, { orgId, dealId: id, filename: St.nomSur(nom), mime: type.mime, size: f.size, sha, cle });
        await journaliser(c, { orgId, acteur: userId, action: 'document.upload', type: 'document', id: doc.id, payload: { deal_id: id, filename: doc.filename, size: f.size, sha256: sha, duplicate_of: doc.duplicate_of } });
        crees.push(doc);
      }
      await c.query('UPDATE plateforme.deals SET updated_at = now() WHERE id = $1 AND org_id = $2', [id, orgId]);
      return crees;
    });
  } finally {
    await nettoyer();
  }
  // Les jobs partent apres le COMMIT : le worker doit voir les lignes. Un doublon n'a pas de chaine.
  for (const d of documents.filter((x) => !x.duplicate_of)) await envoyer('document.ingest', { org_id: ctx(req).orgId, document_id: d.id });
  if (!documents.length) return res.status(400).json({ error: { code: 'type_fichier', message: 'Aucun des fichiers n\'est d\'un type accepté (pdf, docx, xlsx, xls, csv, eml, msg, zip, jpg, png).' }, refuses });
  res.status(201).json({ documents: documents.map(formatDocument), refuses });
}));

router.get('/deals/:id/documents', h(async (req, res) => {
  const id = idParam(req);
  const rows = await dansOrg(req, async (c, { orgId }) => {
    await chargerDeal(c, id, orgId);
    const { rows } = await c.query("SELECT * FROM plateforme.documents WHERE deal_id = $1 AND org_id = $2 ORDER BY (doc_type = 'a_classer') DESC, created_at, filename", [id, orgId]);
    return rows;
  });
  res.json({ documents: rows.map(formatDocument) });
}));

const Relance = z.strictObject({ from: z.enum(['ingest', 'parse', 'classify', 'extract']).default('ingest') });
router.post('/documents/:id/reprocess', h(async (req, res) => {
  if (estLectureSeule(req)) throw interdit();
  const id = idParam(req);
  const b = valider(Relance, req.body || {});
  if (b.from !== 'ingest') throw new ErreurApi(501, 'phase', `La relance depuis « ${b.from} » arrive avec la phase 1.`);
  await dansOrg(req, async (c, { orgId, userId }) => {
    const { rows: [doc] } = await c.query('SELECT id FROM plateforme.documents WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (!doc) throw introuvable('Document');
    await c.query("UPDATE plateforme.documents SET status = 'uploaded', error = NULL, duplicate_of = NULL WHERE id = $1 AND org_id = $2", [id, orgId]);
    await journaliser(c, { orgId, acteur: userId, action: 'document.reprocess', type: 'document', id, payload: { from: b.from } });
  });
  const job_id = await envoyer('document.ingest', { org_id: ctx(req).orgId, document_id: id });
  res.json({ ok: true, job_id });
}));

router.get('/documents/:id/file', h(async (req, res, next) => {
  const id = req.params.id;
  if (!uuidValide(id)) return next();
  const doc = await dansOrg(req, async (c, { orgId }) => (await c.query('SELECT id, filename, mime, storage_path FROM plateforme.documents WHERE id = $1 AND org_id = $2', [id, orgId])).rows[0]);
  if (!doc) return next(); // pas un document de la plateforme : l'ancien routeur (Simulateur) prend le relais
  if (!doc.storage_path) throw new ErreurApi(409, 'sans_fichier', 'Ce document n\'a pas de fichier.');
  // Lien signe de 5 minutes par le pilote de stockage : URL presignee S3 en production, jeton local en developpement.
  const { url, expires_at } = await St.signedUrl(doc.storage_path, { filename: doc.filename, mime: doc.mime });
  res.json({ url, expires_at });
}));

// Telechargement par jeton signe (pilote local seulement) : l'authentification est le jeton lui-meme (5 minutes).
// Avec le pilote s3, les liens pointent directement sur le stockage objet et cette route ne sert jamais un fichier.
publique.get('/storage/:jeton', h(async (req, res) => {
  if (St.DRIVER !== 'local') throw new ErreurApi(404, 'stockage', 'Les fichiers sont servis par le stockage objet, pas par Leez.');
  const lien = St.verifierLien(req.params.jeton);
  if (!lien) throw new ErreurApi(401, 'lien', 'Lien invalide ou expiré.');
  if (!(await St.exists(lien.cle))) throw introuvable('Fichier');
  res.setHeader('Content-Type', lien.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(St.nomSur(lien.filename))}`);
  res.setHeader('Cache-Control', 'private, max-age=0');
  (await St.get(lien.cle)).on('error', () => res.status(500).end()).pipe(res);
}));
publique.use(gererErreurs);

// ---------- Organisation ----------
function formatOrg(w) {
  return {
    id: w.id, name: w.name, slug: w.slug, settings: { ...Core.REGLAGES_DEFAUT, ...(w.settings_json || {}) },
    // Limites en vigueur sur ce serveur, pour que l'interface refuse un fichier trop gros avant de l'envoyer.
    limites: { max_upload_mb: Math.round(Core.LIMITES.taille_fichier / 1048576), documents_par_deal: Core.LIMITES.documents_par_deal, stockage: St.DRIVER },
  };
}
router.get('/org/settings', h(async (req, res) => {
  const { rows: [w] } = await pool.query('SELECT id, name, slug, settings_json FROM workspaces WHERE id = $1', [ctx(req).orgId]);
  if (!w) throw introuvable('Organisation');
  res.json({ organization: formatOrg(w) });
}));
const ModifOrg = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug en minuscules, chiffres et tirets').min(2).max(60).optional(),
  settings: Core.ReglagesOrganisation.optional(),
});
router.patch('/org/settings', exigerRole('owner', 'admin'), h(async (req, res) => {
  const b = valider(ModifOrg, req.body || {});
  const { orgId, userId } = ctx(req);
  const { rows: [actuel] } = await pool.query('SELECT id, name, slug, settings_json FROM workspaces WHERE id = $1', [orgId]);
  if (!actuel) throw introuvable('Organisation');
  const settings = { ...(actuel.settings_json || {}), ...(b.settings || {}) };
  try {
    await pool.query('UPDATE workspaces SET name = COALESCE($2, name), slug = COALESCE($3, slug), settings_json = $4 WHERE id = $1', [orgId, b.name ?? null, b.slug ?? null, JSON.stringify(settings)]);
  } catch (e) {
    if (e.code === '23505') throw new ErreurApi(409, 'slug', 'Ce slug est déjà utilisé par une autre organisation.');
    throw e;
  }
  await dansOrg(req, (c) => journaliser(c, { orgId, acteur: userId, action: 'org.settings', type: 'organization', id: orgId, payload: b }));
  const { rows: [w] } = await pool.query('SELECT id, name, slug, settings_json FROM workspaces WHERE id = $1', [orgId]);
  res.json({ organization: formatOrg(w) });
}));
router.get('/org/members', h(async (req, res) => {
  const { rows } = await pool.query('SELECT id, email, name, role, created_at, last_login_at FROM users WHERE workspace_id = $1 ORDER BY created_at', [ctx(req).orgId]);
  res.json({ members: rows.map((u) => ({ ...u, is_you: u.id === req.userId })) });
}));
const ModifMembre = z.strictObject({ role: z.enum(Core.ROLES) });
router.patch('/org/members/:id', exigerRole('owner', 'admin'), h(async (req, res) => {
  const id = idParam(req);
  const b = valider(ModifMembre, req.body || {});
  const { orgId, userId, role } = ctx(req);
  if (b.role === 'owner' && role !== 'owner') throw interdit('Seul un owner peut nommer un owner.');
  const { rows: [cible] } = await pool.query('SELECT id, role FROM users WHERE id = $1 AND workspace_id = $2', [id, orgId]);
  if (!cible) throw introuvable('Membre');
  if (cible.role === 'owner' && role !== 'owner') throw interdit('Seul un owner peut changer le rôle d\'un owner.');
  if (cible.role === 'owner' && b.role !== 'owner') {
    const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM users WHERE workspace_id = $1 AND role = 'owner'", [orgId]);
    if (n <= 1) throw new ErreurApi(409, 'dernier_owner', 'Une organisation garde au moins un owner.');
  }
  await pool.query('UPDATE users SET role = $2 WHERE id = $1', [id, b.role]);
  await dansOrg(req, (c) => journaliser(c, { orgId, acteur: userId, action: 'org.member_role', type: 'user', id, payload: b }));
  res.json({ ok: true });
}));

// ---------- Files de jobs ----------
router.get('/jobs', h(async (req, res) => {
  res.json({ queues: await etatFiles() });
}));

router.use(gererErreurs);

module.exports = { router, publique, insererDocument };
