const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const {
  createDocument, getDocument, updateDocument, deleteDocument, listDocuments, getSetting,
  createSupportingDocument, listSupportingDocuments, getSupportingDocument, deleteSupportingDocument,
} = require('../db');
const { runPipeline, resumePipeline } = require('../services/pipeline');
const { computeMandateFit, computeAuditCards, computePointsACreuser, computeAuditSummary } = require('../services/interpretation');
const { computeIndicateurs, computeMix, parseFrenchNumber } = require('../services/indicators');
const { runConsistencyChecks } = require('../services/consistency');
const { computeReconciliation } = require('../services/reconciliation');
const { buildFeederWorkbook } = require('../services/exportExcel');
const { isValidCategoryType } = require('../services/supportingCatalog');
const { extractContexteNarratif } = require('../services/extraction');
const { verifyContexteNarratif, locateQuote, deriveBox } = require('../services/verification');
const { runVendorClaimsPipeline } = require('../services/vendorClaimsVerifier');
const { generateDealRecap, buildDealRecapDataBlock } = require('../services/dealRecap');
const { asyncHandler } = require('../utils/asyncHandler');
const analytics = require('../services/analytics');

// Meme mise en forme (snake_case DB -> camelCase API) que la reponse de
// GET /documents/:id -- extrait ici pour etre reutilisee par toute route
// qui a besoin du document "shape" complet (ex: /deal-recap) sans risquer
// d'oublier un champ que les calculs d'Audit lisent (computeAuditCards
// touche t12/mix/consistencyChecks en plus de ficheIdentite/indicateurs).
function shapeDocument(doc) {
  return {
    id: doc.id,
    filename: doc.filename,
    uploadedAt: doc.uploaded_at,
    status: doc.status,
    errorMessage: doc.error_message,
    failedStage: doc.failed_stage ?? null,
    pageCount: doc.page_count,
    ficheIdentite: doc.fiche_identite_json ?? null,
    etatLocatif: doc.etat_locatif_json ?? null,
    t12: doc.t12_json ?? null,
    mix: doc.mix_json ?? null,
    expiry: doc.expiry_json ?? null,
    indicateurs: doc.indicateurs_json ?? null,
    consistencyChecks: doc.consistency_json ?? null,
    redFlags: doc.red_flags_json ?? null,
    contexteNarratif: doc.contexte_narratif_json ?? null,
    notes: doc.notes ?? '',
    isDemo: !!doc.is_demo,
    simulation: doc.simulation_json ?? null,
    vendorClaims: doc.vendor_claims_json ?? null,
    presentationHiddenCards: doc.presentation_hidden_cards_json ?? [],
    dealRecap: doc.deal_recap_json ?? null,
  };
}

const NUMBER_FIELDS = ['surfaceSf', 'loyerFacialPsf', 'loyerEconomiquePsf', 'loyerAnnuel', 'chargesRecuperablesPct', 'tvaPct'];
const PLAIN_ETAT_LOCATIF_FIELDS = ['suite', 'locataire', 'activite', 'statut'];
const STATUT_VALUES = ['actif', 'echeance_proche', 'maintien_en_place'];

// Recalcule indicateurs/mix/controles de coherence a partir des donnees
// (potentiellement editees manuellement) deja en base -- jamais un nouvel
// appel au modele : c'est la meme arithmetique pure que le pipeline initial.
async function recomputeDerived(id, workspaceId) {
  const doc = await getDocument(id, workspaceId);
  if (!doc || doc.status !== 'complete') return;
  const ficheIdentite = doc.fiche_identite_json || {};
  const etatLocatif = doc.etat_locatif_json || [];
  const t12 = doc.t12_json || [];
  await updateDocument(id, {
    indicateurs_json: computeIndicateurs({ ficheIdentite, etatLocatif, t12 }),
    mix_json: computeMix(etatLocatif),
    consistency_json: runConsistencyChecks({ ficheIdentite, etatLocatif, t12 }),
  }, workspaceId);
}

// Configurable via UPLOAD_DIR (Render monte son Disk persistant a un chemin
// absolu hors du checkout, ex: /var/data/uploads -- voir render.yaml) ;
// par defaut, chemin relatif au repo pour le developpement local.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
const SUPPORTING_DIR = path.join(UPLOAD_DIR, 'supporting');
if (!fs.existsSync(SUPPORTING_DIR)) fs.mkdirSync(SUPPORTING_DIR, { recursive: true });

// Extensions reelles sur disque selon le type MIME -- l'OM reste toujours un
// PDF (seul format que le pipeline d'extraction sait lire), mais les
// documents annexes acceptent aussi des images (categorie "Photos & visuels").
const EXT_BY_MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const ALLOWED_SUPPORTING_MIMES = Object.keys(EXT_BY_MIME);

// Meme stockage pour l'OM (champ "file") et les documents annexes (champ
// "supportingFiles") -- seul le sous-dossier de destination differe, choisi
// selon le nom du champ du formulaire.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, file.fieldname === 'file' ? UPLOAD_DIR : SUPPORTING_DIR),
  filename: (req, file, cb) => cb(null, `${uuidv4()}.${EXT_BY_MIME[file.mimetype] || 'pdf'}`),
});
// Le champ "file" (l'OM) doit rester strictement un PDF : c'est le seul
// document que le pipeline d'extraction sait lire. Les documents annexes
// ("supportingFiles") acceptent en plus des images -- la coherence
// categorie/type (ex: une image seulement pour "Photos & visuels") est
// verifiee apres coup dans attachSupportingFiles, comme le reste des
// metadonnees de ces fichiers.
const uploadFilter = (req, file, cb) => {
  if (file.fieldname === 'file') {
    if (file.mimetype !== 'application/pdf') return cb(new Error("Seuls les fichiers PDF sont acceptés pour l'Offering Memorandum."));
    return cb(null, true);
  }
  if (!ALLOWED_SUPPORTING_MIMES.includes(file.mimetype)) return cb(new Error('Type de fichier non accepté (PDF, JPG, PNG ou WEBP).'));
  cb(null, true);
};
const limits = { fileSize: 32 * 1024 * 1024 }; // aligne sur la limite de l'API Claude pour un document PDF
// OM seul (dashboard) OU OM + annexes en une requete (page Importer).
const uploadCombined = multer({ storage, limits, fileFilter: uploadFilter })
  .fields([{ name: 'file', maxCount: 1 }, { name: 'supportingFiles', maxCount: 40 }]);
// Annexes seules, rattachees a un dossier deja existant.
const uploadSupportingOnly = multer({ storage, limits, fileFilter: uploadFilter }).array('supportingFiles', 40);

function shapeSupporting(s) {
  return { id: s.id, category: s.category, type: s.type, filename: s.filename, uploadedAt: s.uploaded_at, mimeType: s.mime_type, isImage: (s.mime_type || '').startsWith('image/') };
}

// Rattache des fichiers deja ecrits sur disque par multer (dans SUPPORTING_DIR,
// sous un nom temporaire) a un dossier : les renomme par leur id definitif et
// cree la ligne DB correspondante. `metaJson` est un tableau JSON
// [{category, type}, ...] dans le MEME ORDRE que `files` (aucune extraction :
// stockage seul). Un fichier dont la categorie/type ne correspond pas au
// catalogue est rejete individuellement (fichier supprime) plutot que de faire
// echouer tout l'import.
// `for...of` + await (pas `.forEach(async ...)`, qui ne serait jamais
// attendu par l'appelant : les insertions partiraient en arriere-plan sans
// garantie d'etre terminees avant la reponse HTTP, et une erreur serait
// silencieusement avalee).
async function attachSupportingFiles(dossierId, files, metaJson) {
  if (!files || files.length === 0) return;
  let meta = [];
  try { meta = JSON.parse(metaJson || '[]'); } catch { meta = []; }
  for (const [i, f] of files.entries()) {
    const m = meta[i];
    if (!m || !isValidCategoryType(m.category, m.type)) { fs.unlinkSync(f.path); continue; }
    const sid = uuidv4();
    const ext = EXT_BY_MIME[f.mimetype] || 'pdf';
    fs.renameSync(f.path, path.join(SUPPORTING_DIR, `${sid}.${ext}`));
    await createSupportingDocument({ id: sid, documentId: dossierId, category: m.category, type: m.type, filename: f.originalname, mimeType: f.mimetype });
  }
}

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY });
});

router.post('/documents', uploadCombined, asyncHandler(async (req, res) => {
  const file = req.files?.file?.[0];
  if (!file) return res.status(400).json({ error: 'Aucun fichier reçu (champ attendu : "file").' });

  const id = uuidv4();
  await createDocument({ id, filename: file.originalname, workspaceId: req.workspaceId });

  const finalPath = path.join(UPLOAD_DIR, `${id}.pdf`);
  fs.renameSync(file.path, finalPath);
  const pdfBuffer = fs.readFileSync(finalPath);

  // Lance le pipeline en tâche de fond ; le client suit la progression par polling.
  runPipeline(id, pdfBuffer, req.workspaceId);

  await attachSupportingFiles(id, req.files?.supportingFiles, req.body.supportingMeta);

  // Metadonnee d'usage uniquement (taille du fichier, jamais son contenu
  // ni son nom, qui pourrait reveler l'adresse d'un bien sous NDA).
  analytics.track('document_uploaded', req.userId, { workspaceId: req.workspaceId, fileSizeBytes: file.size });

  res.status(201).json({ id, filename: file.originalname, status: 'uploaded' });
}));

router.get('/documents', asyncHandler(async (req, res) => {
  const docs = await listDocuments(req.workspaceId);
  res.json(docs.map(doc => ({
    id: doc.id,
    filename: doc.filename,
    uploadedAt: doc.uploaded_at,
    status: doc.status,
    errorMessage: doc.error_message,
    pageCount: doc.page_count,
    ficheIdentite: doc.fiche_identite_json ?? null,
    indicateurs: doc.indicateurs_json ?? null,
    isDemo: !!doc.is_demo,
    supportingCount: doc.supporting_count ?? 0,
  })));
}));

router.get('/documents/:id', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });

  const shaped = shapeDocument(doc);

  if (doc.status === 'complete') {
    const criteria = await getSetting('fund_criteria', req.workspaceId);
    const cards = computeAuditCards(shaped, criteria);
    shaped.audit = {
      summary: computeAuditSummary(cards),
      cards,
      pointsACreuser: computePointsACreuser(shaped),
      mandateFit: computeMandateFit(shaped, criteria),
    };
    shaped.reconciliation = computeReconciliation(shaped);
  }

  res.json(shaped);
}));

// Relance le pipeline a partir de l'etape en echec (doc.failedStage),
// jamais depuis le debut -- les etapes deja reussies restent en base
// (pages_json, fiche_identite_json, etc. selon jusqu'ou le run precedent
// est alle) et ne sont pas refaites. Uniquement pour status==='error' :
// un document 'unsupported_scanned' echouerait de la meme facon a chaque
// tentative (pas d'OCR), le bouton est masque cote client pour ce statut
// (voir STATUS_LABELS/statusChip dans app.js).
router.post('/documents/:id/retry', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  if (doc.status !== 'error') return res.status(400).json({ error: "Seul un dossier en erreur peut être relancé." });
  const filePath = path.join(UPLOAD_DIR, `${doc.id}.pdf`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier source introuvable.' });

  const pdfBuffer = fs.readFileSync(filePath);
  // Tache de fond, comme le premier passage du pipeline -- le client suit
  // la progression par polling (meme mecanique que POST /documents).
  resumePipeline(doc.id, pdfBuffer, req.workspaceId, doc.failed_stage);

  res.json({ ok: true, resumingFrom: doc.failed_stage || 'extracting_pages' });
}));

// Verrouillage du Simulateur pour la Presentation comite : le moteur de
// calcul (computeModel/computeScenarios/etc.) vit entierement cote client
// (public/js/simulator.js, "zero appel au modele") -- cette route ne fait
// que persister tel quel l'instantane deja calcule par le navigateur, sur
// action manuelle explicite de l'analyste ("Verrouiller pour la
// presentation"), jamais automatiquement. Aucun recalcul, aucune validation
// arithmetique cote serveur : la seule source de verite reste le moteur
// client, ce endpoint est un simple stockage horodate.
router.post('/documents/:id/simulation-snapshot', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  const snapshot = req.body && typeof req.body === 'object' ? req.body : null;
  if (!snapshot) return res.status(400).json({ error: 'Instantane du simulateur manquant ou invalide.' });
  const withTimestamp = { ...snapshot, lockedAt: new Date().toISOString() };
  await updateDocument(doc.id, { simulation_json: withTimestamp }, req.workspaceId);
  res.json({ ok: true, simulation: withTimestamp });
}));

// Edition manuelle d'un champ par l'analyste. Une valeur editee n'est plus
// une affirmation du modele : elle est marquee `edited: true` (au lieu d'etre
// re-presentee comme "verifiee par citation") et remplace la valeur, sans
// toucher a la citation d'origine conservee pour tracabilite.
router.patch('/documents/:id/edit', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  const { section, field, index, value } = req.body || {};

  if (section === 'ficheIdentite') {
    const fi = doc.fiche_identite_json;
    if (!fi || !fi[field]) return res.status(400).json({ error: 'Champ invalide.' });
    fi[field] = { ...fi[field], value: value === '' ? null : value, edited: true };
    await updateDocument(doc.id, { fiche_identite_json: fi }, req.workspaceId);
    await recomputeDerived(doc.id, req.workspaceId);
    return res.json({ ok: true });
  }

  if (section === 'etatLocatif') {
    const rows = doc.etat_locatif_json;
    const row = rows && rows[index];
    if (!row) return res.status(400).json({ error: 'Ligne introuvable.' });
    if (field === 'statut') {
      if (!STATUT_VALUES.includes(value)) return res.status(400).json({ error: 'Statut invalide.' });
      row.statut = value;
    } else if (PLAIN_ETAT_LOCATIF_FIELDS.includes(field)) {
      row[field] = value;
    } else if (row[field] && typeof row[field] === 'object') {
      const parsed = NUMBER_FIELDS.includes(field) ? parseFrenchNumber(value) : value;
      row[field] = { ...row[field], value: value === '' ? null : parsed, edited: true };
    } else {
      return res.status(400).json({ error: 'Champ invalide.' });
    }
    await updateDocument(doc.id, { etat_locatif_json: rows }, req.workspaceId);
    await recomputeDerived(doc.id, req.workspaceId);
    return res.json({ ok: true });
  }

  if (section === 't12') {
    const rows = doc.t12_json;
    const row = rows && rows[index];
    if (!row || !row.montant) return res.status(400).json({ error: 'Ligne introuvable.' });
    row.montant = { ...row.montant, value: value === '' ? null : parseFrenchNumber(value), edited: true };
    await updateDocument(doc.id, { t12_json: rows }, req.workspaceId);
    await recomputeDerived(doc.id, req.workspaceId);
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'Section invalide.' });
}));

// Notes libres de l'analyste -- texte non structure, jamais genere ni
// interprete par le modele, simplement enregistre tel quel (autosave cote
// client). Distinct des champs extraits : pas de citation, pas de verification.
router.patch('/documents/:id/notes', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  const { value } = req.body || {};
  await updateDocument(doc.id, { notes: typeof value === 'string' ? value : '' }, req.workspaceId);
  res.json({ ok: true });
}));

// Masquage d'un element de la Presentation (carte d'Audit sur la
// diapositive Points de vigilance, ou n'importe quel autre bloc/KPI/ligne
// des 8 autres diapositives -- voir buildDeckHTML cote client) -- jamais
// une suppression de la donnee reelle, seulement un ecart d'affichage pour
// CETTE presentation. `cardId`/`cardIds` sont soit un id de carte d'Audit
// deja calcule par computeAuditCards (interpretation.js), soit un id
// d'element STABLE propre a Leez (ex: "hero.prix") -- jamais invente
// dynamiquement, uniquement verifie/stocke tel quel cote serveur (le client
// est seul responsable de savoir quels ids existent reellement sur la
// diapositive courante).
router.patch('/documents/:id/presentation-hidden-cards', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  const current = doc.presentation_hidden_cards_json || [];
  if (req.body?.reset === true) {
    await updateDocument(doc.id, { presentation_hidden_cards_json: [] }, req.workspaceId);
    return res.json({ hiddenCardIds: [] });
  }
  let ids;
  if (Array.isArray(req.body?.cardIds)) {
    ids = req.body.cardIds.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim());
  } else if (typeof req.body?.cardId === 'string' && req.body.cardId.trim()) {
    ids = [req.body.cardId.trim()];
  } else {
    ids = [];
  }
  if (!ids.length) return res.status(400).json({ error: 'cardId(s) manquant(s).' });
  const hidden = req.body?.hidden !== false;
  const next = hidden
    ? Array.from(new Set([...current, ...ids]))
    : current.filter(id => !ids.includes(id));
  await updateDocument(doc.id, { presentation_hidden_cards_json: next }, req.workspaceId);
  res.json({ hiddenCardIds: next });
}));

// Genere la synthese narrative du contexte de vente ("onglet Contexte") --
// declenchee manuellement par l'analyste (comme la Presentation), jamais
// automatiquement au pipeline d'import, car c'est un appel au modele
// supplementaire et donc un cout d'API optionnel. Remplace toute synthese
// precedemment generee pour ce dossier.
router.post('/documents/:id/contexte-narratif', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  if (doc.status !== 'complete') return res.status(400).json({ error: "L'extraction du dossier doit être terminée avant de générer cette synthèse." });
  const filePath = path.join(UPLOAD_DIR, `${doc.id}.pdf`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier source introuvable.' });

  try {
    const pdfBase64 = fs.readFileSync(filePath).toString('base64');
    const raw = await extractContexteNarratif(pdfBase64);
    const verified = verifyContexteNarratif(raw, doc.pages_json || []);
    await updateDocument(doc.id, { contexte_narratif_json: verified }, req.workspaceId);
    res.json(verified);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
}));

// Récapitulatif exécutif du dossier ("onglet Sommaire") -- PAS une
// extraction (aucune nouvelle lecture du PDF) : seulement une mise en
// prose des données déjà extraites/vérifiées et déjà calculées (voir
// dealRecap.js#buildDealRecapDataBlock). Déclenché manuellement, comme
// /contexte-narratif -- appel API supplémentaire et donc optionnel.
router.post('/documents/:id/deal-recap', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  if (doc.status !== 'complete') return res.status(400).json({ error: "L'extraction du dossier doit être terminée avant de générer le récapitulatif." });
  try {
    const shaped = shapeDocument(doc);
    const criteria = await getSetting('fund_criteria', req.workspaceId);
    shaped.audit = { summary: computeAuditSummary(computeAuditCards(shaped, criteria)) };
    const dataBlock = buildDealRecapDataBlock(shaped);
    const result = await generateDealRecap({ dataBlock });
    await updateDocument(doc.id, { deal_recap_json: result.paragraphs }, req.workspaceId);
    res.json({ paragraphs: result.paragraphs });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
}));

// Onglet "Verification" : repere les affirmations marketing du vendeur,
// verifie leur citation contre le document reel, puis confronte chacune a
// une vraie recherche web contextuelle au dossier (vendorClaimsVerifier.js).
// Declenche manuellement (comme /contexte-narratif) -- appels API
// supplementaires et couteux en temps (plusieurs vraies recherches web).
// SSE plutot qu'une reponse bloquante : chaque affirmation peut prendre
// 10-25s, l'analyste doit voir les resultats arriver au fur et a mesure
// plutot qu'un ecran vide pendant plusieurs minutes.
router.post('/documents/:id/vendor-claims', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  if (doc.status !== 'complete') return res.status(400).json({ error: "L'extraction du dossier doit être terminée avant de lancer cette analyse." });
  const filePath = path.join(UPLOAD_DIR, `${doc.id}.pdf`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier source introuvable.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  // Remplace toute analyse precedente pour ce dossier, comme /contexte-narratif.
  await updateDocument(doc.id, { vendor_claims_json: [] }, req.workspaceId);
  // Accumulateur EN MEMOIRE, local a cette requete (plus de relecture de
  // vendor_claims_json en base a chaque resultat) + une queue d'ECRITURE
  // serialisee. Sous SQLite (synchrone), lire-modifier-ecrire sans await
  // entre les deux ne pouvait jamais s'entrelacer (Node mono-thread). Sous
  // Postgres (async) avec plusieurs affirmations resolues en parallele
  // (pool de concurrence, vendorClaimsVerifier.js), deux appels
  // updateDocument concurrents pourraient en theorie arriver au serveur
  // dans le desordre et laisser un instantane plus ANCIEN (donc plus court)
  // ecraser en base un instantane plus recent deja ecrit. Chainer chaque
  // ecriture sur la precedente via writeQueue garantit qu'elles atteignent
  // Postgres dans l'ordre exact ou les affirmations ont ete ajoutees a
  // claimsAcc, quel que soit l'ordre de resolution des recherches web
  // elles-memes. Le .catch() interne evite qu'un echec ponctuel d'ecriture
  // ne "empoisonne" la chaine et ne fasse silencieusement sauter toutes
  // les ecritures suivantes.
  const claimsAcc = [];
  let writeQueue = Promise.resolve();
  try {
    const pdfBase64 = fs.readFileSync(filePath).toString('base64');
    await runVendorClaimsPipeline({
      pdfBase64,
      pages: doc.pages_json || [],
      ficheIdentite: doc.fiche_identite_json || {},
      onClaimsFound: (claims) => send({ type: 'claims_found', claims }),
      onClaimResult: (claim) => {
        claimsAcc.push(claim);
        send({ type: 'claim_result', claim });
        writeQueue = writeQueue
          .then(() => updateDocument(doc.id, { vendor_claims_json: claimsAcc }, req.workspaceId))
          .catch(err => console.error('Echec ecriture vendor_claims_json :', err.message || err));
      },
      onClaimError: (err) => send({ type: 'claim_error', ...err }),
    });
    await writeQueue; // attend que la derniere ecriture en attente soit bien retombee avant de signaler la fin
    send({ type: 'done' });
  } catch (err) {
    send({ type: 'error', error: err.message || String(err) });
  } finally {
    res.end();
  }
}));

// L'Assistant Q/R (texte reel du dossier + base de connaissances) est
// desormais un ecran global -- voir server/routes/assistant.js
// (POST /api/assistant/ask, dossierId optionnel) qui reutilise
// askAboutDossier de dealChat.js tel quel.

// Sert le vrai fichier PDF importe (pas une reconstruction) pour affichage
// direct dans un visualiseur PDF cote client, ancre sur la bonne page via
// le fragment d'URL #page=N.
router.get('/documents/:id/file', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  const filePath = path.join(UPLOAD_DIR, `${doc.id}.pdf`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier source introuvable.' });
  res.setHeader('Content-Type', 'application/pdf');
  fs.createReadStream(filePath).pipe(res);
}));

// Export Excel "feeder" (Écran 7) -- classeur .xlsx pret pour le modele de
// souscription du fonds, formules natives (voir exportExcel.js). Dossier
// incomplet = pas de donnees exploitables, jamais un classeur a moitie
// rempli.
router.get('/documents/:id/export/xlsx', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  if (doc.status !== 'complete') return res.status(400).json({ error: "L'extraction du dossier doit être terminée avant l'export." });
  const shaped = shapeDocument(doc);
  const buffer = await buildFeederWorkbook(shaped);
  const safeName = (shaped.filename || 'leez-export').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.pdf$/i, '');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}_feeder.xlsx"`);
  res.send(buffer);
}));

router.delete('/documents/:id', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  const filePath = path.join(UPLOAD_DIR, `${doc.id}.pdf`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  const supporting = await listSupportingDocuments(doc.id);
  supporting.forEach(s => {
    const p = path.join(SUPPORTING_DIR, `${s.id}.pdf`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
  await deleteDocument(doc.id, req.workspaceId); // supprime aussi les lignes supporting_documents (ON DELETE CASCADE)
  res.json({ ok: true });
}));

// ---------- documents annexes (baux, DPE, titre de propriete, etc.) ----------
// Stockage seul, aucune extraction : consultables tels quels dans l'onglet
// "Documents" du dossier.
router.get('/documents/:id/supporting', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  res.json((await listSupportingDocuments(doc.id)).map(shapeSupporting));
}));

router.post('/documents/:id/supporting', uploadSupportingOnly, asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  await attachSupportingFiles(doc.id, req.files, req.body.supportingMeta);
  res.status(201).json((await listSupportingDocuments(doc.id)).map(shapeSupporting));
}));

// Verifie d'abord que le dossier PARENT appartient au workspace courant --
// sans ce getDocument, seule la coherence document_id === :id etait
// verifiee, ce qui n'empechait pas un utilisateur d'un AUTRE workspace
// d'acceder a un fichier annexe en devinant/connaissant un couple
// (id de dossier, id de document annexe) qui ne lui appartient pas.
router.get('/documents/:id/supporting/:sid/file', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  const s = await getSupportingDocument(req.params.sid);
  if (!s || s.document_id !== req.params.id) return res.status(404).json({ error: 'Document annexe introuvable.' });
  const filePath = path.join(SUPPORTING_DIR, `${s.id}.${EXT_BY_MIME[s.mime_type] || 'pdf'}`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable.' });
  res.setHeader('Content-Type', s.mime_type || 'application/pdf');
  fs.createReadStream(filePath).pipe(res);
}));

router.delete('/documents/:id/supporting/:sid', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
  const s = await getSupportingDocument(req.params.sid);
  if (!s || s.document_id !== req.params.id) return res.status(404).json({ error: 'Document annexe introuvable.' });
  const filePath = path.join(SUPPORTING_DIR, `${s.id}.${EXT_BY_MIME[s.mime_type] || 'pdf'}`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await deleteSupportingDocument(s.id);
  res.json({ ok: true });
}));

// `quote` (optionnel) : localise cette citation dans le texte reel de la
// page (meme algorithme/seuils que la verification initiale) puis en deduit
// un fragment "zoom=echelle,left,top" pour le visualiseur PDF natif -- pour
// que le PDF original s'ouvre deja zoome et scrolle sur le bon paragraphe,
// au lieu de laisser l'analyste chercher a l'oeil sur toute la page. left/top
// sont exprimes dans l'espace utilisateur de la page (points, origine bas-
// gauche, convention des parametres d'ouverture PDF) : convertis a partir du
// rectangle percentuel deja calcule par deriveBox (meme donnee que les box
// de verification.js) et des dimensions reelles de la page (pdfText.js).
router.get('/documents/:id/page/:n', asyncHandler(async (req, res) => {
  const doc = await getDocument(req.params.id, req.workspaceId);
  if (!doc || !doc.pages_json) return res.status(404).json({ error: 'Document ou pages introuvables.' });
  const n = parseInt(req.params.n, 10);
  const page = doc.pages_json.find(p => p.pageNumber === n);
  if (!page) return res.status(404).json({ error: 'Page introuvable.' });
  const quote = typeof req.query.quote === 'string' ? req.query.quote : '';

  let zoomFragment = null;
  if (quote) {
    const located = locateQuote(quote, page.text);
    if (located) {
      const box = deriveBox(page, located.start, located.end); // [xPct, yPct, wPct, hPct], yPct depuis le haut
      if (box && page.pageWidth && page.pageHeight) {
        const left = Math.round(((box[0] / 100) * page.pageWidth) * 100) / 100;
        const topFromBottom = Math.round((page.pageHeight - (box[1] / 100) * page.pageHeight) * 100) / 100;
        zoomFragment = `zoom=60,${left},${topFromBottom}`;
      }
    }
  }

  res.json({ pageNumber: page.pageNumber, text: page.text, zoomFragment });
}));

module.exports = router;
