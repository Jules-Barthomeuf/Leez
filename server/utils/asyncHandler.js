// Express 4 n'attrape pas automatiquement le rejet d'une promesse renvoyee
// par un handler async : sans ce wrapper, une erreur DB (Postgres) dans un
// handler async ferait pendre la requete indefiniment au lieu de renvoyer
// une 500. A utiliser sur toute route qui n'a pas deja son propre
// try/catch complet.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
