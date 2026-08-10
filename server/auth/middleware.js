// Porte d'entree de toutes les routes /api (sauf /api/auth/*, montees
// avant ce middleware -- voir index.js). Injecte req.workspaceId/req.userEmail,
// seules informations dont les routes ont besoin pour scoper leurs requetes :
// la session ne "sait" pas la logique metier, elle porte juste l'identite.
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Non authentifié.' });
  }
  req.userId = req.session.userId;
  req.workspaceId = req.session.workspaceId;
  req.userEmail = req.session.email;
  next();
}

// Un compte auto-inscrit (voir POST /auth/signup) n'a pas de workspace_id
// tant qu'un administrateur ne l'a pas rattache a un fonds (routes/admin.js).
// Toutes les routes qui manipulent des dossiers/reglages/etc. d'un fonds
// doivent passer par ce garde APRES requireAuth -- sans lui, une requete
// avec workspaceId=null tenterait des ecritures avec une valeur NULL sur
// des colonnes NOT NULL (documents.workspace_id) et echouerait en 500 au
// lieu d'un message clair.
function requireWorkspace(req, res, next) {
  if (!req.workspaceId) {
    return res.status(403).json({
      error: "Ce compte n'est pas encore rattaché à un fonds. Un administrateur doit vous assigner un espace de travail.",
      code: 'no_workspace',
    });
  }
  next();
}

// Un seul administrateur de plateforme pour ce pilote : identifie par son
// email (SUPER_ADMIN_EMAIL, par defaut jules.btmf@gmail.com -- voir
// .env.example), pas par une colonne en base. Volontaire : evite toute
// possibilite d'auto-promotion via un bug de "Ajouter un membre" ou une
// injection SQL -- ce role ne peut jamais etre accorde via l'UI.
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'jules.btmf@gmail.com').trim().toLowerCase();
function isSuperAdmin(email) {
  return typeof email === 'string' && email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}
function requireSuperAdmin(req, res, next) {
  if (!isSuperAdmin(req.userEmail)) {
    return res.status(403).json({ error: 'Réservé à l\'administrateur de la plateforme.' });
  }
  next();
}

module.exports = { requireAuth, requireWorkspace, requireSuperAdmin, isSuperAdmin };
