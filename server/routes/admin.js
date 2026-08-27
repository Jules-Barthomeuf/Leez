// Panneau d'administration globale -- reserve a SUPER_ADMIN_EMAIL (voir
// auth/middleware.js), monte AVANT requireWorkspace dans index.js : cette
// personne n'a pas besoin d'appartenir elle-meme a un fonds pour creer des
// fonds et y rattacher les comptes auto-inscrits. Jamais scope par
// workspace, contrairement a tout le reste de l'API -- c'est le seul
// endroit ou une vue transverse a tous les fonds est legitime.
const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { listAllWorkspaces, listAllUsers, createWorkspace, assignUserWorkspace,
  findOrCreateWorkspace, getUserById, updateUserPassword,
  getUserByEmail, createUser, setUserInvite } = require('../db');
const { hashPassword } = require('../auth/passwords');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireSuperAdmin } = require('../auth/middleware');

const router = express.Router();

const INVITE_VALIDITE_JOURS = 14;
// Path explicite obligatoire : router.use(fn) SANS path s'appliquerait a
// TOUTES les requetes qui traversent ce router une fois monte sur /api
// (pas seulement /admin/*) puisque index.js le monte avant requireWorkspace
// -- sans ce filtre, /api/documents etc. se feraient aussi rejeter en 403
// "reserve a l'administrateur" avant meme d'atteindre requireWorkspace.
router.use('/admin', requireSuperAdmin);

router.get('/admin/workspaces', asyncHandler(async (req, res) => {
  const workspaces = await listAllWorkspaces();
  res.json(workspaces.map(w => ({ id: w.id, name: w.name, createdAt: w.created_at, memberCount: w.member_count })));
}));

router.post('/admin/workspaces', asyncHandler(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Nom du fonds requis.' });
  const id = await createWorkspace(name);
  res.status(201).json({ id, name });
}));

router.get('/admin/users', asyncHandler(async (req, res) => {
  const users = await listAllUsers();
  res.json(users.map(u => ({
    id: u.id,
    email: u.email,
    name: u.name,
    workspaceId: u.workspace_id,
    workspaceName: u.workspace_name,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  })));
}));

// Creer un client en une action : le fonds (espace de travail) ET
// l'invitation de son premier contact. Evite l'enchainement en deux temps
// (creer le fonds, puis inviter en le choisissant dans une liste).
router.post('/admin/clients', asyncHandler(async (req, res) => {
  const workspaceName = typeof req.body?.workspaceName === 'string' ? req.body.workspaceName.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  if (!workspaceName) return res.status(400).json({ error: 'Nom du client requis.' });
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email du contact invalide.' });

  const existing = await getUserByEmail(email);
  if (existing && existing.password_hash) {
    return res.status(409).json({ error: 'Ce contact a déjà un compte actif — invitez-le depuis la liste des comptes.' });
  }

  // Toujours un NOUVEAU fonds (createWorkspace, pas findOrCreate) : deux
  // clients peuvent porter le meme nom sans partager leurs dossiers.
  const workspaceId = await createWorkspace(workspaceName);
  let userId;
  if (existing) {
    await assignUserWorkspace(existing.id, workspaceId);
    userId = existing.id;
  } else {
    userId = uuidv4();
    await createUser({ id: userId, workspaceId, email, passwordHash: null });
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + INVITE_VALIDITE_JOURS * 24 * 3600 * 1000).toISOString();
  await setUserInvite(userId, tokenHash, expiresAt);

  const base = `${req.protocol}://${req.get('host')}`;
  res.status(201).json({
    workspaceName, workspaceId, email,
    inviteUrl: `${base}/invite.html?token=${token}`,
    expiresAt,
  });
}));

// Invitation : l'administrateur cree le compte (email + fonds), le serveur
// renvoie un lien a transmettre a la personne, qui n'aura qu'a choisir son
// mot de passe. Le compte est cree SANS mot de passe -- il ne peut donc pas
// servir a se connecter tant que l'invitation n'a pas ete consommee.
router.post('/admin/users/invite', asyncHandler(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const workspaceId = typeof req.body?.workspaceId === 'string' && req.body.workspaceId ? req.body.workspaceId : null;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email invalide.' });

  let user = await getUserByEmail(email);
  if (user && user.password_hash) {
    return res.status(409).json({ error: 'Ce compte existe déjà et a un mot de passe — utilisez « Réinitialiser le mot de passe ».' });
  }
  if (!user) {
    const id = uuidv4();
    await createUser({ id, workspaceId, email, passwordHash: null });
    user = await getUserById(id);
  } else if (workspaceId && !user.workspace_id) {
    await assignUserWorkspace(user.id, workspaceId);
  }

  // Jeton en clair envoye UNE SEULE FOIS dans la reponse ; seul son sha256
  // est stocke -- une fuite de la base ne permet pas de forger un lien.
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + INVITE_VALIDITE_JOURS * 24 * 3600 * 1000).toISOString();
  await setUserInvite(user.id, tokenHash, expiresAt);

  const base = `${req.protocol}://${req.get('host')}`;
  res.status(201).json({
    email: user.email,
    inviteUrl: `${base}/invite.html?token=${token}`,
    expiresAt,
  });
}));

// Reinitialisation du mot de passe d'un compte par l'administrateur --
// evite d'avoir a passer par un shell serveur quand quelqu'un a oublie le
// sien. Le nouveau mot de passe n'est jamais journalise.
router.patch('/admin/users/:id/password', asyncHandler(async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères.' });
  const user = await getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Compte introuvable.' });
  await updateUserPassword(user.id, await hashPassword(password));
  res.json({ ok: true, email: user.email });
}));

// L'administrateur de la plateforme se rattache lui-meme a un espace de
// travail en un clic (ecran "En attente d'assignation") : personne d'autre
// ne peut le faire pour lui, c'est le seul cas ou l'attente serait sans
// issue. Reutilise un espace existant du meme nom plutot que d'en empiler.
router.post('/admin/self-workspace', asyncHandler(async (req, res) => {
  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : 'Espace par défaut';
  const workspaceId = await findOrCreateWorkspace(name);
  await assignUserWorkspace(req.userId, workspaceId);
  req.session.workspaceId = workspaceId;
  res.json({ ok: true, workspaceId, name });
}));

router.patch('/admin/users/:id/workspace', asyncHandler(async (req, res) => {
  const workspaceId = typeof req.body?.workspaceId === 'string' && req.body.workspaceId ? req.body.workspaceId : null;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId requis.' });
  await assignUserWorkspace(req.params.id, workspaceId);
  res.json({ ok: true });
}));

module.exports = router;
