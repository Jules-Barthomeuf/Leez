const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getUserByEmail, touchUserLogin, getUserById, updateUserPassword, getUserByGoogleId, linkGoogleId, createUser } = require('../db');
const { verifyPassword, hashPassword } = require('../auth/passwords');
const google = require('../auth/google');
const { asyncHandler } = require('../utils/asyncHandler');
const analytics = require('../services/analytics');
const { isSuperAdmin } = require('../auth/middleware');

const router = express.Router();

// Etablit la session pour un utilisateur deja identifie (mot de passe OU
// Google) -- factorise pour eviter de dupliquer regenerate()/touchUserLogin/
// analytics entre les deux methodes de connexion.
function establishSession(req, res, user, method, onDone) {
  req.session.regenerate((err) => {
    if (err) return onDone(err);
    req.session.userId = user.id;
    req.session.workspaceId = user.workspace_id;
    req.session.email = user.email;
    req.session.name = user.name || null;
    touchUserLogin(user.id).catch(() => {});
    analytics.identify(user.id, { email: user.email, workspaceId: user.workspace_id });
    analytics.track('user_logged_in', user.id, { workspaceId: user.workspace_id, method });
    onDone(null);
  });
}

router.post('/auth/login', asyncHandler(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });

  const user = await getUserByEmail(email);
  // Meme message generique que l'email existe ou non -- n'indique jamais a
  // un attaquant si une adresse est enregistree.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
  }

  // regenerate() avant d'ecrire l'identite : evite la fixation de session
  // (un id de session emis avant authentification ne doit jamais devenir
  // une session authentifiee).
  establishSession(req, res, user, 'password', (err) => {
    if (err) return res.status(500).json({ error: 'Erreur lors de la connexion.' });
    res.json({ email: user.email, workspaceId: user.workspace_id });
  });
}));

// Auto-inscription publique : cree un compte PERSONNEL, sans fonds
// (workspace_id NULL) -- ne cree jamais de workspace elle-meme,
// contrairement a l'ancienne version. Un administrateur (SUPER_ADMIN_EMAIL,
// voir routes/admin.js) cree les fonds et y rattache chaque compte
// auto-inscrit. Tant qu'un compte n'est pas rattache, l'app affiche un
// ecran d'attente (voir requireWorkspace) plutot que le tableau de bord.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
router.post('/auth/signup', asyncHandler(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nom, email et mot de passe requis.' });
  }
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Adresse email invalide." });
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères.' });

  const existing = await getUserByEmail(email);
  if (existing) return res.status(409).json({ error: 'Un compte existe déjà avec cette adresse email.' });

  const passwordHash = await hashPassword(password);
  const id = uuidv4();
  await createUser({ id, workspaceId: null, email, passwordHash, name });
  const user = { id, workspace_id: null, email, name };

  analytics.track('signup_completed', user.id, {});
  establishSession(req, res, user, 'signup', (err) => {
    if (err) return res.status(500).json({ error: 'Erreur lors de la connexion.' });
    res.status(201).json({ email: user.email, workspaceId: user.workspace_id });
  });
}));

// ---------- Connexion avec Google ----------
// Ne cree PAS de compte (contrairement a /auth/signup ci-dessus) :
// authentifie seulement un compte deja existant (auto-inscrit ou
// provisionne par un administrateur via create-user.js / "Ajouter un
// membre"), en associant son google_id au premier login reussi. Choix
// volontaire pour eviter de creer silencieusement un workspace via un
// simple clic Google sans que l'utilisateur n'ait explicitement nomme
// son fonds.
const GOOGLE_STATE_COOKIE = 'google_oauth_state';

router.get('/auth/google', (req, res) => {
  if (!google.isConfigured()) return res.status(404).send('Connexion Google non configurée.');
  const state = google.generateState();
  res.cookie(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 5 * 60 * 1000,
  });
  res.redirect(google.buildAuthUrl(req, state));
});

router.get('/auth/google/callback', asyncHandler(async (req, res) => {
  const fail = (reason) => res.redirect(`/login.html?error=${encodeURIComponent(reason)}`);
  if (!google.isConfigured()) return fail('google_disabled');

  const { code, state } = req.query;
  const expectedState = req.cookies?.[GOOGLE_STATE_COOKIE];
  res.clearCookie(GOOGLE_STATE_COOKIE);
  if (!code || !state || !expectedState || state !== expectedState) return fail('google_state_mismatch');

  let profile;
  try {
    profile = await google.exchangeCodeForUserInfo(req, code);
  } catch {
    return fail('google_exchange_failed');
  }
  if (!profile.email || profile.email_verified !== true) return fail('google_email_unverified');

  // D'abord par google_id (deja lie lors d'un login precedent), sinon par
  // email (premier login Google pour ce compte -- on lie a cette occasion).
  let user = await getUserByGoogleId(profile.sub);
  if (!user) {
    user = await getUserByEmail(profile.email);
    if (!user) return fail('google_no_account'); // jamais de creation automatique
    await linkGoogleId(user.id, profile.sub);
  }

  establishSession(req, res, user, 'google', (err) => {
    if (err) return fail('google_session_error');
    res.redirect('/index.html');
  });
}));

router.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/auth/me', asyncHandler(async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non authentifié.' });
  // Resynchronise workspaceId depuis la base a chaque appel (plutot que de
  // se fier au seul cache de session) : un administrateur peut rattacher un
  // compte auto-inscrit a un fonds (routes/admin.js) PENDANT que ce compte
  // reste connecte -- sans cette resynchronisation, l'ecran d'attente ne se
  // debloquerait jamais avant une deconnexion/reconnexion manuelle. La
  // mutation de req.session ci-dessous est persistee automatiquement par
  // express-session en fin de requete, donc les routes /api suivantes
  // (requireWorkspace inclus) en beneficient aussi immediatement.
  const user = await getUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Non authentifié.' });
  req.session.workspaceId = user.workspace_id;
  // id inclus pour que le client puisse s'identifier aupres de PostHog avec
  // le MEME distinctId que celui utilise cote serveur (user.id) -- sans
  // ca, les evenements client et serveur d'une meme personne se
  // retrouveraient sur deux profils PostHog distincts. workspaceId peut
  // etre null (compte auto-inscrit pas encore rattache a un fonds -- voir
  // requireWorkspace) : le frontend affiche alors un ecran d'attente.
  // isSuperAdmin permet au frontend de proposer discretement le lien vers
  // /admin.html, la vraie protection reste server-side (requireSuperAdmin).
  res.json({
    id: user.id,
    email: user.email,
    name: user.name || null,
    workspaceId: user.workspace_id,
    isSuperAdmin: isSuperAdmin(user.email),
  });
}));

// Changement de mot de passe depuis la page "Mon compte" -- montee avant le
// requireAuth global (comme le reste de /api/auth/*), donc la verification
// de session se fait ici, en dur, comme /auth/me juste au-dessus.
router.patch('/auth/password', asyncHandler(async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non authentifié.' });
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Mot de passe actuel et nouveau mot de passe requis.' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 8 caractères.' });

  const user = await getUserById(req.session.userId);
  if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
  }
  await updateUserPassword(user.id, await hashPassword(newPassword));
  res.json({ ok: true });
}));

module.exports = router;
