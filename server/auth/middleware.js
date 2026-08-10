// Porte d'entree de toutes les routes /api (sauf /api/auth/*, montees
// avant ce middleware -- voir index.js). Injecte req.workspaceId, seule
// information dont les routes ont besoin pour scoper leurs requetes : la
// session ne "sait" pas la logique metier, elle porte juste l'identite.
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Non authentifié.' });
  }
  req.userId = req.session.userId;
  req.workspaceId = req.session.workspaceId;
  next();
}

module.exports = { requireAuth };
