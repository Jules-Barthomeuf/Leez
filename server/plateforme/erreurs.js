// Erreurs des routes de la plateforme : toujours { error: { code, message } }
// (spec, section 16), avec un statut HTTP coherent.
const { ErreurValidation } = require('../../packages/core');

class ErreurApi extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const introuvable = (quoi = 'Ressource') => new ErreurApi(404, 'introuvable', `${quoi} introuvable.`);
const interdit = (message = 'Action réservée à un autre rôle.') => new ErreurApi(403, 'role', message);

// eslint-disable-next-line no-unused-vars
function gererErreurs(err, req, res, next) {
  if (res.headersSent) return;
  if (err instanceof ErreurApi || err instanceof ErreurValidation) {
    return res.status(err.status || 400).json({ error: { code: err.code, message: err.message } });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'taille_fichier', message: 'Fichier trop volumineux : 100 Mo au plus.' } });
  }
  if (err && err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ error: { code: 'nombre_fichiers', message: 'Trop de fichiers en un seul envoi (50 au plus).' } });
  }
  console.error('[plateforme]', err);
  res.status(500).json({ error: { code: 'serveur', message: 'Erreur serveur.' } });
}

module.exports = { ErreurApi, introuvable, interdit, gererErreurs };
