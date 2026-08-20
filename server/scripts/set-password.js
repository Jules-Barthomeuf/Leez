// Réinitialise le mot de passe d'un compte existant, par email.
// Usage (local ou Shell Render) :
//   node server/scripts/set-password.js --email jules@exemple.fr --password 'NouveauMDP'
// Sur Render, DATABASE_URL est déjà défini par l'environnement du service ;
// en local, le Postgres embarqué est démarré au besoin (comme seed-demo.js).
require('dotenv').config();

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

(async () => {
  const email = arg('email');
  const password = arg('password');
  if (!email || !password) {
    console.error("Usage : node server/scripts/set-password.js --email <email> --password '<mot de passe>'");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Le mot de passe doit faire au moins 8 caractères.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) await require('../localPostgres').ensureLocalPostgres();
  const { hashPassword } = require('../auth/passwords');
  const { getUserByEmail, updateUserPassword } = require('../db');

  const user = await getUserByEmail(email);
  if (!user) {
    console.error(`Aucun compte pour ${email} — rien n'est créé (utilisez create-user.js pour créer un compte).`);
    process.exit(1);
  }
  await updateUserPassword(user.id, await hashPassword(password));
  console.log(`Mot de passe réinitialisé pour ${user.email}.`);
  process.exit(0);
})().catch(err => { console.error(err.message); process.exit(1); });
