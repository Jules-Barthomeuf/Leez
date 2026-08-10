// Seule voie de creation de compte -- pas d'auto-inscription publique
// (pilote a quelques analystes nominatifs par fonds). Cree le workspace
// s'il n'existe pas encore (idempotent sur le nom), toujours un nouvel
// utilisateur.
//
// Usage : node server/scripts/create-user.js --email a@fonds.fr --password 'motdepasse' --workspace "Nom du fonds"
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { hashPassword } = require('../auth/passwords');

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

let pool = null;

async function main() {
  const { email, password, workspace } = parseArgs();
  if (!email || !password || !workspace) {
    console.error('Usage : node server/scripts/create-user.js --email a@fonds.fr --password \'motdepasse\' --workspace "Nom du fonds"');
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error('Le mot de passe doit faire au moins 8 caracteres.');
    process.exitCode = 1;
    return;
  }

  // require() différé après la résolution de DATABASE_URL -- en local sans
  // Postgres installé, démarre le Postgres embarqué (voir index.js pour la
  // même logique côté serveur).
  if (!process.env.DATABASE_URL) await require('../localPostgres').ensureLocalPostgres();
  const db = require('../db');
  pool = db.pool;
  const { findOrCreateWorkspace, createUser, getUserByEmail } = db;

  const existing = await getUserByEmail(email);
  if (existing) {
    console.error(`Un compte existe deja pour ${email} (workspace ${existing.workspace_id}).`);
    process.exitCode = 1;
    return;
  }

  const workspaceId = await findOrCreateWorkspace(workspace);
  const passwordHash = await hashPassword(password);
  const id = uuidv4();
  await createUser({ id, workspaceId, email, passwordHash });

  console.log(`Compte cree : ${email} -- workspace "${workspace}" (${workspaceId}).`);
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => pool?.end());
