const express = require('express');
const { getUserByEmail, touchUserLogin, getUserById, updateUserPassword } = require('../db');
const { verifyPassword, hashPassword } = require('../auth/passwords');
const { asyncHandler } = require('../utils/asyncHandler');
const analytics = require('../services/analytics');

const router = express.Router();

// Pas d'auto-inscription : les comptes sont crees par un administrateur via
// server/scripts/create-user.js (pilote a quelques analystes nominatifs par
// fonds, pas un produit grand public). Cette route se contente donc de
// verifier un couple email/mot de passe deja provisionne.
router.post('/auth/login', asyncHandler(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });

  const user = await getUserByEmail(email);
  // Meme message generique que l'email existe ou non -- n'indique jamais a
  // un attaquant si une adresse est enregistree.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
  }

  // regenerate() avant d'ecrire l'identite : evite la fixation de session
  // (un id de session emis avant authentification ne doit jamais devenir
  // une session authentifiee).
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Erreur lors de la connexion.' });
    req.session.userId = user.id;
    req.session.workspaceId = user.workspace_id;
    req.session.email = user.email;
    touchUserLogin(user.id).catch(() => {}); // best-effort, ne doit jamais bloquer la connexion
    analytics.identify(user.id, { email: user.email, workspaceId: user.workspace_id });
    analytics.track('user_logged_in', user.id, { workspaceId: user.workspace_id });
    res.json({ email: user.email, workspaceId: user.workspace_id });
  });
}));

router.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/auth/me', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non authentifié.' });
  // id inclus pour que le client puisse s'identifier aupres de PostHog avec
  // le MEME distinctId que celui utilise cote serveur (user.id) -- sans
  // ca, les evenements client et serveur d'une meme personne se
  // retrouveraient sur deux profils PostHog distincts.
  res.json({ id: req.session.userId, email: req.session.email, workspaceId: req.session.workspaceId });
});

// Changement de mot de passe depuis la page "Mon compte" -- montee avant le
// requireAuth global (comme le reste de /api/auth/*), donc la verification
// de session se fait ici, en dur, comme /auth/me juste au-dessus.
router.patch('/auth/password', asyncHandler(async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non authentifié.' });
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Mot de passe actuel et nouveau mot de passe requis.' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 8 caractères.' });

  const user = await getUserById(req.session.userId);
  if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
  }
  await updateUserPassword(user.id, await hashPassword(newPassword));
  res.json({ ok: true });
}));

module.exports = router;
