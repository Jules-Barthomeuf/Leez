// bcryptjs (implementation pure JS, aucune compilation native) plutot que
// bcrypt : evite tout risque d'echec de build sur l'environnement de build
// de Render, meme API (hash/compare).
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}
// hash absent = compte invite dont le mot de passe n'a pas encore ete
// choisi. bcrypt.compare LEVE une exception sur null/undefined (verifie) :
// sans ce garde-fou, une tentative de connexion sur un tel compte renvoyait
// une erreur 500 au lieu d'un refus propre.
function verifyPassword(plain, hash) {
  if (typeof hash !== 'string' || hash.length === 0) return Promise.resolve(false);
  return bcrypt.compare(plain, hash);
}

module.exports = { hashPassword, verifyPassword };
