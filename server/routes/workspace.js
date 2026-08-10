// Gestion de l'espace de travail partage depuis la page "Mon compte" --
// voir les collegues du meme fonds, en ajouter (seule voie de creation de
// compte en dehors du script CLI create-user.js), en retirer. Montee APRES
// le requireAuth global (index.js) : req.workspaceId/req.userId toujours
// disponibles ici, jamais de verification manuelle de session necessaire
// (contrairement a auth.js, monte avant).
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { listUsersByWorkspace, createUser, getUserByEmail, deleteUser, getWorkspace } = require('../db');
const { hashPassword } = require('../auth/passwords');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/workspace', asyncHandler(async (req, res) => {
  const ws = await getWorkspace(req.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Espace de travail introuvable.' });
  res.json({ id: ws.id, name: ws.name });
}));

router.get('/workspace/members', asyncHandler(async (req, res) => {
  const members = await listUsersByWorkspace(req.workspaceId);
  res.json(members.map(u => ({
    id: u.id,
    email: u.email,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
    isYou: u.id === req.userId,
  })));
}));

// Pas de notion de role admin/analyste distincte pour ce pilote a quelques
// utilisateurs par fonds : n'importe quel membre deja authentifie peut
// inviter un collegue dans SON PROPRE espace de travail -- jamais dans un
// autre (req.workspaceId, jamais un id fourni par le client).
router.post('/workspace/members', asyncHandler(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères.' });

  const existing = await getUserByEmail(email);
  if (existing) return res.status(409).json({ error: 'Un compte existe déjà pour cet email.' });

  const passwordHash = await hashPassword(password);
  const id = uuidv4();
  await createUser({ id, workspaceId: req.workspaceId, email, passwordHash });
  res.status(201).json({ id, email });
}));

router.delete('/workspace/members/:id', asyncHandler(async (req, res) => {
  if (req.params.id === req.userId) return res.status(400).json({ error: 'Vous ne pouvez pas vous retirer vous-même.' });
  await deleteUser(req.params.id, req.workspaceId);
  res.json({ ok: true });
}));

module.exports = router;
