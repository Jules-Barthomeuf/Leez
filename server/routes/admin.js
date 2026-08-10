// Panneau d'administration globale -- reserve a SUPER_ADMIN_EMAIL (voir
// auth/middleware.js), monte AVANT requireWorkspace dans index.js : cette
// personne n'a pas besoin d'appartenir elle-meme a un fonds pour creer des
// fonds et y rattacher les comptes auto-inscrits. Jamais scope par
// workspace, contrairement a tout le reste de l'API -- c'est le seul
// endroit ou une vue transverse a tous les fonds est legitime.
const express = require('express');
const { listAllWorkspaces, listAllUsers, createWorkspace, assignUserWorkspace } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireSuperAdmin } = require('../auth/middleware');

const router = express.Router();
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

router.patch('/admin/users/:id/workspace', asyncHandler(async (req, res) => {
  const workspaceId = typeof req.body?.workspaceId === 'string' && req.body.workspaceId ? req.body.workspaceId : null;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId requis.' });
  await assignUserWorkspace(req.params.id, workspaceId);
  res.json({ ok: true });
}));

module.exports = router;
