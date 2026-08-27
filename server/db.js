const { Pool } = require('pg');

// SSL uniquement pour un hote *.render.com (connexion EXTERNE) -- le
// render.yaml de ce depot alimente DATABASE_URL avec l'URL INTERNE (reseau
// prive Render, fromDatabase.property: connectionString), qui ne supporte
// pas du tout SSL ("The server does not support SSL connections" si on le
// force). Se baser sur NODE_ENV seul forcait SSL a tort sur cette URL
// interne. Postgres local (embarque ou docker-compose) n'a jamais de host
// *.render.com donc reste toujours en clair, comme avant.
function needsSsl(connectionString) {
  if (!connectionString) return false;
  try {
    return new URL(connectionString).hostname.endsWith('.render.com');
  } catch {
    return false;
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSsl(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
});

// Colonnes JSONB : pg lit deja ces colonnes comme des objets/tableaux JS
// (parseur jsonb natif, aucun JSON.parse manuel necessaire en lecture).
// En ECRITURE en revanche, on stringify explicitement avant de passer la
// valeur en parametre -- la serialisation par defaut de `pg` pour un
// tableau JS produit une syntaxe de tableau Postgres ({a,b,c}), pas un
// tableau JSON ([...]), ce qui casserait toutes nos colonnes qui stockent
// des arrays (etat_locatif_json, t12_json, pages_json, etc.).
const JSONB_COLUMNS = new Set([
  'pages_json', 'fiche_identite_json', 'etat_locatif_json',
  't12_json', 'mix_json', 'expiry_json', 'indicateurs_json', 'consistency_json', 'red_flags_json',
  'contexte_narratif_json', 'simulation_json', 'vendor_claims_json',
  'presentation_hidden_cards_json', 'deal_recap_json', 'queries_json', 'file_notes_json',
]);

// ---------- espaces de travail & comptes nominatifs ----------
// Un workspace = l'espace partage d'un fonds (tous ses analystes voient les
// memes dossiers). findOrCreateWorkspace sert aux scripts hors-ligne
// (seed-demo.js, create-user.js) qui n'ont pas de session pour connaitre le
// workspace courant -- ils identifient/creent le leur par son nom.
async function findOrCreateWorkspace(name) {
  const { rows } = await pool.query('SELECT id FROM workspaces WHERE name = $1', [name]);
  if (rows[0]) return rows[0].id;
  const { rows: inserted } = await pool.query('INSERT INTO workspaces (name) VALUES ($1) RETURNING id', [name]);
  return inserted[0].id;
}
// Toujours un NOUVEAU workspace (jamais une jointure par nom, contrairement
// a findOrCreateWorkspace) -- utilise par l'auto-inscription publique
// (POST /auth/signup) : le nom d'un fonds n'est pas un secret, deux fonds
// distincts peuvent choisir le meme nom, et les faire rejoindre le meme
// workspace romprait l'isolation des dossiers entre eux.
async function createWorkspace(name) {
  const { rows } = await pool.query('INSERT INTO workspaces (name) VALUES ($1) RETURNING id', [name]);
  return rows[0].id;
}

// workspaceId peut etre null (auto-inscription personnelle en attente
// d'assignation par un administrateur -- voir POST /auth/signup) ; name
// peut aussi etre null (create-user.js / "Ajouter un membre" ne le
// demandent pas, seule l'auto-inscription publique le collecte).
async function createUser({ id, workspaceId = null, email, passwordHash, name = null }) {
  await pool.query(
    'INSERT INTO users (id, workspace_id, email, password_hash, name) VALUES ($1, $2, $3, $4, $5)',
    [id, workspaceId, email, passwordHash, name]
  );
}
// lower(email) cote requete (et non en JS) : s'appuie sur le meme index
// unique idx_users_email_lower que la contrainte d'unicite (002_create_users.js).
async function getUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return rows[0] || null;
}
async function touchUserLogin(id) {
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
}
async function getUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}
async function updateUserPassword(id, passwordHash) {
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
}

// ---------- invitation par lien ----------
// Le jeton n'est jamais stocke en clair : seul son sha256 l'est, comme un
// mot de passe. Le lien envoye a la personne est la seule copie en clair.
async function setUserInvite(id, tokenHash, expiresAt) {
  await pool.query('UPDATE users SET invite_token_hash = $1, invite_expires_at = $2 WHERE id = $3', [tokenHash, expiresAt, id]);
}
async function getUserByInviteHash(tokenHash) {
  const { rows } = await pool.query('SELECT * FROM users WHERE invite_token_hash = $1', [tokenHash]);
  return rows[0] || null;
}
// Consomme l'invitation : le mot de passe est pose ET le jeton efface dans
// la MEME requete -- un lien ne peut jamais servir deux fois.
async function consumeInvite(id, passwordHash) {
  await pool.query(
    'UPDATE users SET password_hash = $1, invite_token_hash = NULL, invite_expires_at = NULL WHERE id = $2',
    [passwordHash, id]
  );
}
async function getUserByGoogleId(googleId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
  return rows[0] || null;
}
// Associe un compte Google a un compte DEJA existant (jamais de creation :
// voir 010_add_google_id.js) -- appele au premier login Google reussi pour
// un utilisateur trouve par email.
async function linkGoogleId(userId, googleId) {
  await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, userId]);
}

// ---------- administration globale (SUPER_ADMIN_EMAIL uniquement) ----------
// Reservees a routes/admin.js (voir requireSuperAdmin) : jamais scopees par
// workspace, contrairement a tout le reste de db.js -- c'est precisement
// leur role, donner une vue transverse a tous les fonds pour rattacher un
// compte auto-inscrit (workspace_id NULL) au bon fonds.
async function listAllWorkspaces() {
  const { rows } = await pool.query(`
    SELECT w.id, w.name, w.created_at, COUNT(u.id)::int AS member_count
    FROM workspaces w
    LEFT JOIN users u ON u.workspace_id = w.id
    GROUP BY w.id
    ORDER BY w.created_at DESC
  `);
  return rows;
}
async function listAllUsers() {
  const { rows } = await pool.query(`
    SELECT u.id, u.email, u.name, u.workspace_id, w.name AS workspace_name, u.created_at, u.last_login_at
    FROM users u
    LEFT JOIN workspaces w ON w.id = u.workspace_id
    ORDER BY u.workspace_id IS NULL DESC, u.created_at DESC
  `);
  return rows;
}
async function assignUserWorkspace(userId, workspaceId) {
  await pool.query('UPDATE users SET workspace_id = $1 WHERE id = $2', [workspaceId, userId]);
}
async function listUsersByWorkspace(workspaceId) {
  const { rows } = await pool.query(
    'SELECT id, email, created_at, last_login_at FROM users WHERE workspace_id = $1 ORDER BY created_at ASC',
    [workspaceId]
  );
  return rows;
}
// Scope par workspace_id (pas seulement l'id) : empeche de retirer un
// utilisateur d'un AUTRE espace de travail meme si son id etait devine.
async function deleteUser(id, workspaceId) {
  await pool.query('DELETE FROM users WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
}
async function getWorkspace(id) {
  const { rows } = await pool.query('SELECT * FROM workspaces WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getSetting(key, workspaceId) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1 AND workspace_id = $2', [key, workspaceId]);
  return rows[0] ? rows[0].value : null;
}
async function setSetting(key, value, workspaceId) {
  await pool.query(
    `INSERT INTO settings (workspace_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value`,
    [workspaceId, key, JSON.stringify(value)]
  );
}

async function createDocument({ id, filename, workspaceId, displayName = null }) {
  await pool.query(
    'INSERT INTO documents (id, filename, uploaded_at, status, workspace_id, display_name) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, filename, new Date().toISOString(), 'uploaded', workspaceId, displayName]
  );
}

// `workspaceId` fait partie de la clause WHERE (pas seulement de la lecture
// prealable) : meme si un appelant a deja verifie l'appartenance du dossier
// via getDocument, une double-verification au niveau de l'ecriture coute
// rien et evite qu'une regression future n'ouvre une ecriture inter-workspace.
async function updateDocument(id, fields, workspaceId) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const set = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map(k => {
    const v = fields[k];
    return JSONB_COLUMNS.has(k) && v !== null && v !== undefined ? JSON.stringify(v) : v;
  });
  await pool.query(
    `UPDATE documents SET ${set} WHERE id = $${keys.length + 1} AND workspace_id = $${keys.length + 2}`,
    [...values, id, workspaceId]
  );
}

async function getDocument(id, workspaceId) {
  const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
  return rows[0] || null;
}

async function deleteDocument(id, workspaceId) {
  await pool.query('DELETE FROM documents WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
}

async function listDocuments(workspaceId) {
  const { rows } = await pool.query(`
    SELECT d.id, d.filename, d.uploaded_at, d.status, d.error_message, d.page_count,
           d.fiche_identite_json, d.indicateurs_json, d.is_demo, d.stage, d.display_name,
           d.etat_locatif_json, d.t12_json, d.queries_json,
           d.decision_motif, d.decided_at, d.decided_by,
           (SELECT COUNT(*)::int FROM supporting_documents s WHERE s.document_id = d.id) AS supporting_count
    FROM documents d WHERE d.workspace_id = $1 ORDER BY d.uploaded_at DESC
  `, [workspaceId]);
  return rows;
}

// Utilise par seed-demo.js (idempotent : supprime le dossier de demo
// precedent avant d'en recreer un dans le meme workspace) -- remplace
// l'ancien acces direct db.prepare(...) sur l'instance SQLite brute, qui
// n'a pas d'equivalent avec le Pool pg.
async function clearDemoDocuments(workspaceId) {
  await pool.query('DELETE FROM documents WHERE is_demo = true AND workspace_id = $1', [workspaceId]);
}

// ---------- orchestration multi-agents ----------
// Pas de workspaceId ici : scoping via dossier_id -> documents(id), voir le
// commentaire en tete de 012_create_agent_runs_and_findings.js. Tout
// appelant (routes/agents.js) doit avoir prealablement verifie le dossier
// parent via getDocument(id, workspaceId).
async function createAgentRun({ id, dossierId, agentType, launchedBy, dependsOn = [], stepsTotal = 1 }) {
  await pool.query(
    `INSERT INTO agent_runs (id, dossier_id, agent_type, status, launched_by, depends_on, steps_total)
     VALUES ($1, $2, $3, 'queued', $4, $5, $6)`,
    [id, dossierId, agentType, launchedBy, dependsOn, stepsTotal]
  );
}
async function getAgentRun(id) {
  const { rows } = await pool.query('SELECT * FROM agent_runs WHERE id = $1', [id]);
  return rows[0] || null;
}
const AGENT_RUN_JSONB_FIELDS = new Set(['result']);
async function updateAgentRun(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const set = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map(k => {
    const v = fields[k];
    return AGENT_RUN_JSONB_FIELDS.has(k) && v !== null && v !== undefined ? JSON.stringify(v) : v;
  });
  await pool.query(`UPDATE agent_runs SET ${set} WHERE id = $${keys.length + 1}`, [...values, id]);
}
async function listAgentRunsForDossier(dossierId) {
  const { rows } = await pool.query('SELECT * FROM agent_runs WHERE dossier_id = $1 ORDER BY created_at ASC', [dossierId]);
  return rows;
}
// Runs laisses en 'queued'/'running' par un process precedent (crash,
// redemarrage/redeploiement) -- jamais reellement repris (l'execution d'un
// agent n'est pas decoupee en etapes rejouables comme le pipeline
// d'extraction), juste bascules en echec explicite au demarrage pour ne
// jamais laisser un noeud tourner indefiniment dans l'ecran Agents.
async function failStaleAgentRuns() {
  const { rows } = await pool.query(
    `UPDATE agent_runs SET status = 'failed', error_message = 'Interrompu par un redémarrage du serveur -- relancez cet agent.', ended_at = now()
     WHERE status IN ('queued', 'running') RETURNING id`
  );
  return rows.length;
}

async function createAgentFinding({ id, agentRunId, dossierId, kind, payload, sourceUrl, sourceLabel, sourceDate, sourceTier, targetField = null }) {
  await pool.query(
    `INSERT INTO agent_findings (id, agent_run_id, dossier_id, kind, payload, source_url, source_label, source_date, source_tier, target_field)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, agentRunId, dossierId, kind, JSON.stringify(payload), sourceUrl, sourceLabel || null, sourceDate || null, sourceTier, targetField]
  );
}
async function listAgentFindingsForRun(agentRunId) {
  const { rows } = await pool.query('SELECT * FROM agent_findings WHERE agent_run_id = $1 ORDER BY created_at ASC', [agentRunId]);
  return rows;
}
async function listAgentFindingsForDossier(dossierId) {
  const { rows } = await pool.query('SELECT * FROM agent_findings WHERE dossier_id = $1 ORDER BY created_at ASC', [dossierId]);
  return rows;
}
async function getAgentFinding(id) {
  const { rows } = await pool.query('SELECT * FROM agent_findings WHERE id = $1', [id]);
  return rows[0] || null;
}
async function setFindingValidationStatus(id, status) {
  await pool.query('UPDATE agent_findings SET validation_status = $1 WHERE id = $2', [status, id]);
}

// ---------- documents annexes (baux, DPE, titre de propriete, etc.) ----------
async function createSupportingDocument({ id, documentId, category, type, filename, mimeType }) {
  await pool.query(
    `INSERT INTO supporting_documents (id, document_id, category, type, filename, uploaded_at, mime_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, documentId, category, type, filename, new Date().toISOString(), mimeType || 'application/pdf']
  );
}
async function listSupportingDocuments(documentId) {
  const { rows } = await pool.query('SELECT * FROM supporting_documents WHERE document_id = $1 ORDER BY uploaded_at ASC', [documentId]);
  return rows;
}
async function getSupportingDocument(id) {
  const { rows } = await pool.query('SELECT * FROM supporting_documents WHERE id = $1', [id]);
  return rows[0] || null;
}
// Renommage d'affichage d'une annexe (le fichier sur disque garde son id).
async function renameSupportingDocument(id, documentId, filename) {
  await pool.query('UPDATE supporting_documents SET filename = $1 WHERE id = $2 AND document_id = $3', [filename, id, documentId]);
}
async function deleteSupportingDocument(id) {
  await pool.query('DELETE FROM supporting_documents WHERE id = $1', [id]);
}

// ---------- base de connaissances RAG (kb_chunks) ----------
async function insertKbChunk({ id, sourceFile, theme, sectionTitle, articleRef, pageStart, pageEnd, content, embedding }) {
  await pool.query(
    `INSERT INTO kb_chunks (id, source_file, theme, section_title, article_ref, page_start, page_end, content, embedding, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, sourceFile, theme, sectionTitle, articleRef, pageStart, pageEnd, content, JSON.stringify(embedding), new Date().toISOString()]
  );
}
async function listKbChunks() {
  const { rows } = await pool.query('SELECT * FROM kb_chunks');
  return rows; // embedding deja parse (colonne jsonb)
}
async function clearKbChunks() {
  await pool.query('DELETE FROM kb_chunks');
}
// Sources distinctes de la base de connaissances, avec leur volume -- sert
// a l'ecran Memoire Institutionnelle pour montrer honnetement ce que la
// base contient reellement (et si elle est vide, le dire).
async function listKbSources() {
  const { rows } = await pool.query(`
    SELECT source_file, theme, COUNT(*)::int AS chunks
    FROM kb_chunks GROUP BY source_file, theme ORDER BY source_file
  `);
  return rows;
}
async function countKbChunks() {
  // COUNT(*) revient en bigint -> pg le donne en string (evite une perte de
  // precision silencieuse sur de tres gros volumes) : reconversion explicite.
  const { rows } = await pool.query('SELECT COUNT(*) AS n FROM kb_chunks');
  return parseInt(rows[0].n, 10);
}

module.exports = {
  pool, needsSsl,
  findOrCreateWorkspace, createWorkspace, createUser, getUserByEmail, touchUserLogin, getUserById, updateUserPassword,
  getUserByGoogleId, linkGoogleId,
  listAllWorkspaces, listAllUsers, assignUserWorkspace,
  setUserInvite, getUserByInviteHash, consumeInvite,
  listUsersByWorkspace, deleteUser, getWorkspace,
  createDocument, updateDocument, getDocument, deleteDocument, listDocuments, clearDemoDocuments,
  createAgentRun, getAgentRun, updateAgentRun, listAgentRunsForDossier, failStaleAgentRuns,
  createAgentFinding, listAgentFindingsForRun, listAgentFindingsForDossier, getAgentFinding, setFindingValidationStatus,
  getSetting, setSetting,
  createSupportingDocument, listSupportingDocuments, getSupportingDocument, deleteSupportingDocument, renameSupportingDocument,
  insertKbChunk, listKbChunks, clearKbChunks, countKbChunks, listKbSources,
};
