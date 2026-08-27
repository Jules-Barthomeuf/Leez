// bcryptjs (implementation pure JS, aucune compilation native) plutot que
// bcrypt : evite tout risque d'echec de build sur l'environnement de build
// de Render, meme API (hash/compare).
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}
function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { hashPassword, verifyPassword };
