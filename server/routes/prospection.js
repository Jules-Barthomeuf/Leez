const express = require('express');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');
const jobs = require('../prospection/jobs');
const { lireResultat, enCsv } = require('../prospection/pipeline');
const { contactsDirection, apolloBranche } = require('../prospection/contact');
const Scores = require('../../public/js/prospection-scores');
const Mandat = require('../../public/js/prospection-mandat');

// Prospection cession-bail (V2) : analyses par departement (donnees publiques,
// communes a tous), et ce que chaque fonds en fait (mandats, listes, suivi,
// verifications, journal), toujours filtre par req.workspaceId.

const router = express.Router();

// Ordre administratif : 01 a 19, 2A, 2B, 21 a 95, puis l'outre-mer.
const rangDept = (d) => (d === '2A' ? 20.1 : d === '2B' ? 20.2 : Number(d));
const DEPARTEMENTS = Object.keys(Mandat.DEPARTEMENTS).map((d) => String(d).padStart(2, '0')).sort((a, b) => rangDept(a) - rangDept(b));
const deptValide = (d) => { const x = String(d || '').toUpperCase(); return DEPARTEMENTS.includes(x) ? x : null; };
const ETAPES = ['a_qualifier', 'qualifiee', 'contactee', 'en_discussion', 'presentee', 'offre', 'signee', 'ecartee'];
const VERDICTS = ['ok', 'faux', 'doute'];

// Les resultats d'un departement, gardes en memoire tant que le fichier ne change pas.
const memo = new Map();
function resultat(dept) {
  const chemin = require('path').join(require('../prospection/pipeline').SORTIE, `${dept}.json`);
  let mtime = 0;
  try { mtime = fs.statSync(chemin).mtimeMs; } catch { return null; }
  const m = memo.get(dept);
  if (m && m.mtime === mtime) return m.r;
  const r = lireResultat(dept);
  memo.set(dept, { mtime, r });
  return r;
}

async function journaliser(req, action, cibleId = null, detail = null) {
  await pool.query('INSERT INTO prospection_journal (workspace_id, user_email, action, cible_id, detail) VALUES ($1,$2,$3,$4,$5)', [req.workspaceId, req.userEmail || null, action, cibleId, detail ? JSON.stringify(detail) : null]);
}

// --- Analyses ------------------------------------------------------------------

router.get('/prospection/etat', (req, res) => {
  res.json({
    departements: DEPARTEMENTS.map((d) => {
      const r = resultat(d);
      return { code: d, nom: Mandat.DEPARTEMENTS[d] || Mandat.DEPARTEMENTS[Number(d)], analyse: r ? { cibles: r.cibles.length, fini_le: r.stats.fini_le, duree_s: r.stats.duree_s } : null, job: jobs.etat(d) ? { etat: jobs.etat(d).etat, message: jobs.etat(d).message || null, fait: jobs.etat(d).fait || null, total: jobs.etat(d).total || null } : null };
    }),
    file: jobs.vueFile(),
    apollo: apolloBranche(),
    // Cle navigateur (restreinte par domaine chez Google) : elle finit de toute facon dans la page.
    google_maps_key: (process.env.GOOGLE_MAPS_API_KEY || '').trim() || null,
  });
});

router.post('/prospection/analyses', (req, res) => {
  const depts = (Array.isArray(req.body?.departements) ? req.body.departements : []).map(deptValide).filter(Boolean);
  if (!depts.length) return res.status(400).json({ error: 'Aucun département valide.' });
  res.json(jobs.ajouter(depts));
});

router.get('/prospection/departements/:dept/cibles', (req, res) => {
  const dept = deptValide(req.params.dept);
  if (!dept) return res.status(400).json({ error: 'Département inconnu.' });
  const r = resultat(dept);
  if (!r) return res.status(404).json({ error: 'Département pas encore analysé.' });
  res.json(r);
});

/** Export CSV (une ligne par mur), scores du mandat demande, cibles choisies ou toutes. */
router.get('/prospection/export.csv', asyncHandler(async (req, res) => {
  const depts = String(req.query.departements || '').split(',').map(deptValide).filter(Boolean);
  let criteres = null;
  if (req.query.mandat) {
    const { rows } = await pool.query('SELECT criteres_json FROM prospection_mandats WHERE id = $1 AND workspace_id = $2', [req.query.mandat, req.workspaceId]);
    criteres = rows[0] ? rows[0].criteres_json : null;
  }
  let cibles = Scores.fusionner(depts.map((d) => (resultat(d) || { cibles: [] }).cibles));
  const ids = String(req.query.ids || '').split(',').filter(Boolean);
  if (ids.length) cibles = cibles.filter((c) => ids.includes(c.id));
  await journaliser(req, 'exporter', null, { departements: depts, cibles: cibles.length, mandat: req.query.mandat || null });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="prospection-${depts.join('-') || 'vide'}.csv"`);
  res.send(enCsv(cibles, criteres));
}));

// --- Mandats -------------------------------------------------------------------

router.post('/prospection/mandats/lire', (req, res) => {
  const phrase = String(req.body?.phrase || '').slice(0, 1000);
  const { criteres, reconnu } = Mandat.lirePhrase(phrase);
  res.json({ criteres: Mandat.normaliser(criteres), brut: criteres, reconnu });
});

router.get('/prospection/mandats', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT m.*, COALESCE(s.total, 0)::int AS suivies, COALESCE(s.approche, 0)::int AS en_approche, COALESCE(s.discussion, 0)::int AS en_discussion
    FROM prospection_mandats m
    LEFT JOIN (
      SELECT mandat_id, COUNT(*) AS total,
        COUNT(*) FILTER (WHERE etape IN ('contactee')) AS approche,
        COUNT(*) FILTER (WHERE etape IN ('en_discussion','presentee','offre')) AS discussion
      FROM prospection_suivis WHERE workspace_id = $1 GROUP BY mandat_id
    ) s ON s.mandat_id = m.id
    WHERE m.workspace_id = $1 AND m.statut <> 'archive' ORDER BY m.updated_at DESC`, [req.workspaceId]);
  res.json(rows.map((m) => ({ id: m.id, nom: m.nom, client: m.client, phrase: m.phrase, criteres: m.criteres_json, statut: m.statut, created_at: m.created_at, updated_at: m.updated_at, compteurs: { suivies: m.suivies, en_approche: m.en_approche, en_discussion: m.en_discussion } })));
}));

router.post('/prospection/mandats', asyncHandler(async (req, res) => {
  const criteres = Mandat.normaliser(req.body?.criteres);
  const nom = String(req.body?.nom || '').trim().slice(0, 200) || Mandat.nomDe(criteres, Scores.TYPES_ACTIF);
  const id = uuidv4();
  await pool.query('INSERT INTO prospection_mandats (id, workspace_id, nom, client, phrase, criteres_json, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, req.workspaceId, nom, String(req.body?.client || '').trim().slice(0, 200) || null, String(req.body?.phrase || '').slice(0, 1000) || null, JSON.stringify(criteres), req.userId || null]);
  // Les departements du mandat pas encore analyses partent en file d'attente (jamais pour un visiteur de la demo).
  const manquants = req.session && req.session.invite ? [] : criteres.departements.filter((d) => !resultat(d));
  const file = manquants.length ? jobs.ajouter(manquants) : jobs.vueFile();
  await journaliser(req, 'creer_mandat', null, { mandat: id, nom });
  res.json({ id, nom, criteres, analyses_lancees: manquants, file });
}));

router.put('/prospection/mandats/:id', asyncHandler(async (req, res) => {
  const criteres = Mandat.normaliser(req.body?.criteres);
  const nom = String(req.body?.nom || '').trim().slice(0, 200) || Mandat.nomDe(criteres, Scores.TYPES_ACTIF);
  const { rowCount } = await pool.query('UPDATE prospection_mandats SET nom = $1, client = $2, criteres_json = $3, updated_at = now() WHERE id = $4 AND workspace_id = $5',
    [nom, String(req.body?.client || '').trim().slice(0, 200) || null, JSON.stringify(criteres), req.params.id, req.workspaceId]);
  if (!rowCount) return res.status(404).json({ error: 'Mandat introuvable.' });
  const manquants = req.session && req.session.invite ? [] : criteres.departements.filter((d) => !resultat(d));
  if (manquants.length) jobs.ajouter(manquants);
  res.json({ id: req.params.id, nom, criteres, analyses_lancees: manquants });
}));

router.delete('/prospection/mandats/:id', asyncHandler(async (req, res) => {
  await pool.query("UPDATE prospection_mandats SET statut = 'archive', updated_at = now() WHERE id = $1 AND workspace_id = $2", [req.params.id, req.workspaceId]);
  res.json({ ok: true });
}));

// --- Listes --------------------------------------------------------------------

router.get('/prospection/listes', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT l.id, l.nom, l.mandat_id, l.created_at, COALESCE(array_agg(c.cible_id) FILTER (WHERE c.cible_id IS NOT NULL), '{}') AS cibles
    FROM prospection_listes l LEFT JOIN prospection_liste_cibles c ON c.liste_id = l.id
    WHERE l.workspace_id = $1 GROUP BY l.id ORDER BY l.created_at DESC`, [req.workspaceId]);
  res.json(rows);
}));

router.post('/prospection/listes', asyncHandler(async (req, res) => {
  const nom = String(req.body?.nom || '').trim().slice(0, 200);
  if (!nom) return res.status(400).json({ error: 'Nom de liste manquant.' });
  const id = uuidv4();
  await pool.query('INSERT INTO prospection_listes (id, workspace_id, mandat_id, nom) VALUES ($1,$2,$3,$4)', [id, req.workspaceId, req.body?.mandat_id || null, nom]);
  const cibles = (Array.isArray(req.body?.cibles) ? req.body.cibles : []).map(String).filter((c) => /^\d{9}$/.test(c));
  for (const c of cibles) await pool.query('INSERT INTO prospection_liste_cibles (liste_id, cible_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, c]);
  res.json({ id, nom, cibles });
}));

router.delete('/prospection/listes/:id', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM prospection_listes WHERE id = $1 AND workspace_id = $2', [req.params.id, req.workspaceId]);
  res.json({ ok: true });
}));

async function listeDuFonds(req, id) {
  const { rows } = await pool.query('SELECT id FROM prospection_listes WHERE id = $1 AND workspace_id = $2', [id, req.workspaceId]);
  return rows[0] || null;
}
router.post('/prospection/listes/:id/cibles', asyncHandler(async (req, res) => {
  if (!(await listeDuFonds(req, req.params.id))) return res.status(404).json({ error: 'Liste introuvable.' });
  const cibles = (Array.isArray(req.body?.cibles) ? req.body.cibles : [req.body?.cible_id]).map(String).filter((c) => /^\d{9}$/.test(c));
  for (const c of cibles) await pool.query('INSERT INTO prospection_liste_cibles (liste_id, cible_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, c]);
  for (const c of cibles) await journaliser(req, 'ajouter_liste', c, { liste: req.params.id });
  res.json({ ok: true, ajoutees: cibles.length });
}));
router.delete('/prospection/listes/:id/cibles/:cible', asyncHandler(async (req, res) => {
  if (!(await listeDuFonds(req, req.params.id))) return res.status(404).json({ error: 'Liste introuvable.' });
  await pool.query('DELETE FROM prospection_liste_cibles WHERE liste_id = $1 AND cible_id = $2', [req.params.id, req.params.cible]);
  res.json({ ok: true });
}));

// --- Suivi (pipeline) ------------------------------------------------------------

router.get('/prospection/suivis', asyncHandler(async (req, res) => {
  const mandat = req.query.mandat || null;
  const { rows } = await pool.query('SELECT cible_id, mandat_id, etape, motif_ecart, commentaire, premier_contact_le, relance_le, updated_at FROM prospection_suivis WHERE workspace_id = $1 AND mandat_id IS NOT DISTINCT FROM $2', [req.workspaceId, mandat]);
  res.json(rows);
}));

router.put('/prospection/suivis', asyncHandler(async (req, res) => {
  const cible = String(req.body?.cible_id || '');
  const etape = String(req.body?.etape || '');
  const mandat = req.body?.mandat_id || null;
  if (!/^\d{9}$/.test(cible)) return res.status(400).json({ error: 'Cible invalide.' });
  if (!ETAPES.includes(etape)) return res.status(400).json({ error: 'Étape inconnue.' });
  const motif = String(req.body?.motif_ecart || '').trim().slice(0, 500) || null;
  if (etape === 'ecartee' && !motif) return res.status(400).json({ error: 'Le motif est obligatoire pour écarter une cible.' });
  // Premier contact : relances a J+7 puis J+21 (la seconde se pose quand la premiere est passee).
  const { rows: avant } = await pool.query('SELECT premier_contact_le FROM prospection_suivis WHERE workspace_id = $1 AND mandat_id IS NOT DISTINCT FROM $2 AND cible_id = $3', [req.workspaceId, mandat, cible]);
  const premier = (avant[0] && avant[0].premier_contact_le) || (etape === 'contactee' ? new Date() : null);
  const relance = etape === 'contactee' && premier ? new Date(new Date(premier).getTime() + 7 * 86400000).toISOString().slice(0, 10) : null;
  await pool.query(`
    INSERT INTO prospection_suivis (id, workspace_id, mandat_id, cible_id, etape, motif_ecart, commentaire, premier_contact_le, relance_le)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (workspace_id, mandat_id, cible_id) DO UPDATE SET etape = EXCLUDED.etape, motif_ecart = EXCLUDED.motif_ecart,
      commentaire = COALESCE(EXCLUDED.commentaire, prospection_suivis.commentaire), premier_contact_le = COALESCE(prospection_suivis.premier_contact_le, EXCLUDED.premier_contact_le),
      relance_le = COALESCE(EXCLUDED.relance_le, prospection_suivis.relance_le), updated_at = now()`,
  [uuidv4(), req.workspaceId, mandat, cible, etape, etape === 'ecartee' ? motif : null, String(req.body?.commentaire || '').trim().slice(0, 2000) || null, premier, relance]);
  await journaliser(req, 'etape', cible, { etape, mandat, motif });
  res.json({ ok: true, etape, relance_le: relance });
}));

// --- Verifications (lot 1) et journal ------------------------------------------

router.get('/prospection/verifications', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT cible_id, verdict, note, user_email, updated_at FROM prospection_verifications WHERE workspace_id = $1', [req.workspaceId]);
  res.json(rows);
}));

router.put('/prospection/verifications', asyncHandler(async (req, res) => {
  const cible = String(req.body?.cible_id || '');
  const verdict = String(req.body?.verdict || '');
  if (!/^\d{9}$/.test(cible) || !VERDICTS.includes(verdict)) return res.status(400).json({ error: 'Vérification invalide.' });
  await pool.query(`INSERT INTO prospection_verifications (workspace_id, cible_id, verdict, note, user_email) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (workspace_id, cible_id) DO UPDATE SET verdict = EXCLUDED.verdict, note = EXCLUDED.note, user_email = EXCLUDED.user_email, updated_at = now()`,
  [req.workspaceId, cible, verdict, String(req.body?.note || '').trim().slice(0, 1000) || null, req.userEmail || null]);
  await journaliser(req, 'verifier', cible, { verdict });
  res.json({ ok: true });
}));

router.post('/prospection/journal', asyncHandler(async (req, res) => {
  const action = String(req.body?.action || '');
  if (!['voir'].includes(action)) return res.status(400).json({ error: 'Action inconnue.' });
  await journaliser(req, action, String(req.body?.cible_id || '') || null);
  res.json({ ok: true });
}));

router.get('/prospection/journal/:cible', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT user_email, action, detail, at FROM prospection_journal WHERE workspace_id = $1 AND cible_id = $2 ORDER BY at DESC LIMIT 50', [req.workspaceId, req.params.cible]);
  res.json(rows);
}));

// --- Contact (Apollo, au clic) ---------------------------------------------------

router.post('/prospection/contact', asyncHandler(async (req, res) => {
  const nom = String(req.body?.nom || '').trim();
  if (!nom) return res.status(400).json({ error: 'Nom de société manquant.' });
  try {
    const r = await contactsDirection({ nom });
    await journaliser(req, 'rechercher_contact', String(req.body?.cible_id || '') || null);
    res.json(r);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
}));

module.exports = router;
