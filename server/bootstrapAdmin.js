// Création automatique du compte administrateur au démarrage, pour ne plus
// dépendre d'une commande manuelle dans le Shell après chaque déploiement.
//
// Pilotée par deux variables d'environnement :
//   SUPER_ADMIN_EMAIL        (déjà utilisée par auth/middleware.js)
//   BOOTSTRAP_ADMIN_PASSWORD (le mot de passe initial ; sans elle, no-op)
//
// Règles strictes :
// - si le compte existe déjà, on ne touche À RIEN (jamais de réinitialisation
//   silencieuse d'un mot de passe que l'analyste a pu changer lui-même) ;
// - le mot de passe n'est jamais journalisé ;
// - un échec ne bloque jamais le démarrage du serveur (l'app reste
//   accessible, le compte peut toujours être créé à la main).
const BOOTSTRAP_WORKSPACE = process.env.BOOTSTRAP_WORKSPACE || 'Espace par défaut';

async function bootstrapAdmin() {
  const email = (process.env.SUPER_ADMIN_EMAIL || '').trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  if (!email || !password) return;
  if (password.length < 8) {
    console.warn('[bootstrap] BOOTSTRAP_ADMIN_PASSWORD trop court (< 8 caractères) — compte non créé.');
    return;
  }
  try {
    const { v4: uuidv4 } = require('uuid');
    const { getUserByEmail, createUser, findOrCreateWorkspace } = require('./db');
    const { hashPassword } = require('./auth/passwords');

    const existing = await getUserByEmail(email);
    if (existing) return; // compte déjà présent : on n'y touche pas.

    const workspaceId = await findOrCreateWorkspace(BOOTSTRAP_WORKSPACE);
    await createUser({ id: uuidv4(), workspaceId, email, passwordHash: await hashPassword(password) });
    console.log(`[bootstrap] Compte administrateur créé : ${email} (espace « ${BOOTSTRAP_WORKSPACE} »).`);
  } catch (err) {
    console.warn('[bootstrap] Création du compte administrateur impossible :', err.message);
  }
}

module.exports = { bootstrapAdmin };
