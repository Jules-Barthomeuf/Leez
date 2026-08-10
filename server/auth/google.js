// Integration OAuth2/OpenID Connect avec Google, implementee directement
// via fetch vers les endpoints Google plutot qu'avec une librairie comme
// passport -- coherent avec le reste de ce sous-systeme d'auth (deja fait
// main : bcryptjs, express-session bruts, sans framework tiers).
const crypto = require('crypto');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// GOOGLE_REDIRECT_URI est optionnelle : par defaut derivee de la requete
// elle-meme, pratique en local (s'adapte au port) -- doit correspondre
// EXACTEMENT a une des URI de redirection autorisees enregistrees dans la
// console Google Cloud (les deux, local et production, peuvent y figurer
// simultanement).
function redirectUriFor(req) {
  return process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
}

function generateState() {
  return crypto.randomBytes(24).toString('hex');
}

function buildAuthUrl(req, state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUriFor(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// Echange le code d'autorisation contre un profil verifie -- deux appels
// HTTP standards OAuth2/OIDC, aucune verification manuelle de signature
// JWT necessaire puisqu'on relit le profil directement depuis l'API
// Google (le canal HTTPS est la garantie d'integrite ici, pas un decodage
// de id_token local).
async function exchangeCodeForUserInfo(req, code) {
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUriFor(req),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) throw new Error(`Échange du code Google échoué (${tokenRes.status}).`);
  const tokenData = await tokenRes.json();

  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userRes.ok) throw new Error(`Récupération du profil Google échouée (${userRes.status}).`);
  return userRes.json(); // { sub, email, email_verified, name, picture, ... }
}

module.exports = { isConfigured, redirectUriFor, generateState, buildAuthUrl, exchangeCodeForUserInfo };
