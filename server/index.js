require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Necessaire derriere le proxy TLS-terminating de Render : sans ca,
// req.protocol resterait "http" meme pour une vraie requete HTTPS, ce qui
// casserait a la fois la construction de l'URI de redirection Google
// OAuth (doit correspondre exactement a ce qui est enregistre cote
// Google) et la detection secure des cookies de session.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('\n⚠️  ANTHROPIC_API_KEY absente. Copiez .env.example en .env et renseignez votre clé Anthropic avant d\'importer un document.\n');
}
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.warn('\n⚠️  SESSION_SECRET absente en production -- les sessions utilisent un secret par defaut non sur. Definissez SESSION_SECRET.\n');
}

// Cible du health check Render -- public, sans dependance DB (une base
// momentanement indisponible ne doit pas faire echouer le health check et
// declencher un redemarrage en boucle).
app.get('/healthz', (req, res) => res.status(200).send('ok'));

// Tout ce qui suit (db.js et tout ce qui en depend -- sessions, routes...)
// doit etre require() APRES la resolution de DATABASE_URL : en local sans
// Postgres installe (ni Docker, ni Homebrew), ensureLocalPostgres() demarre
// un Postgres embarque et definit process.env.DATABASE_URL avant que
// db.js ne construise son Pool. En production (Render), DATABASE_URL est
// deja definie -- ce chemin ne s'execute jamais, require() se contente
// alors de charger les modules normalement.
async function main() {
  if (!process.env.DATABASE_URL) {
    const { ensureLocalPostgres } = require('./localPostgres');
    await ensureLocalPostgres();
  }

  const sessionMiddleware = require('./auth/session');
  const { requireAuth, requireWorkspace } = require('./auth/middleware');
  const authRouter = require('./routes/auth');
  const publicConfigRouter = require('./routes/publicConfig');
  const adminRouter = require('./routes/admin');
  const workspaceRouter = require('./routes/workspace');
  const documentsRouter = require('./routes/documents');
  const settingsRouter = require('./routes/settings');
  const simulateRouter = require('./routes/simulate');
  const knowledgeRouter = require('./routes/knowledge');
  const webSearchRouter = require('./routes/webSearch');
  const assistantRouter = require('./routes/assistant');
  const presentationRouter = require('./routes/presentation');
  const webPageRouter = require('./routes/webPage');
  const agentsRouter = require('./routes/agents');
  const { sweepStaleAgentRuns } = require('./services/agentRunner');
  await sweepStaleAgentRuns();

  app.use(express.json());
  app.use(cookieParser());
  app.use(sessionMiddleware);

  // /api/auth/* et /api/public-config sont accessibles SANS session --
  // montes avant le requireAuth global ci-dessous, qui protege tout le
  // reste de l'API. Necessaire pour /public-config : l'initialisation
  // PostHog en tete d'app.js appelle cette route des le chargement de la
  // page, avant meme d'avoir confirme qu'une session est valide.
  app.use('/api', authRouter);
  app.use('/api', publicConfigRouter);
  app.use('/api', requireAuth);

  // adminRouter AVANT requireWorkspace : reserve a SUPER_ADMIN_EMAIL (voir
  // requireSuperAdmin dans adminRouter lui-meme), l'administrateur de la
  // plateforme n'a pas besoin d'appartenir lui-meme a un fonds pour creer
  // des fonds et y rattacher des comptes auto-inscrits.
  app.use('/api', adminRouter);
  // Tout ce qui suit manipule les dossiers/reglages d'UN fonds precis :
  // un compte auto-inscrit pas encore rattache (workspaceId null) ne doit
  // jamais les atteindre (voir requireWorkspace).
  app.use('/api', requireWorkspace);
  app.use('/api', workspaceRouter);
  app.use('/api', documentsRouter);
  app.use('/api', settingsRouter);
  app.use('/api', simulateRouter);
  app.use('/api', knowledgeRouter);
  app.use('/api', webSearchRouter);
  app.use('/api', assistantRouter);
  app.use('/api', presentationRouter);
  app.use('/api', webPageRouter);
  app.use('/api', agentsRouter);
  // Page d'atterrissage publique à la racine ; l'application (Dashboard,
  // Dossiers, etc.) reste servie telle quelle sur /index.html. Ces fichiers
  // statiques (HTML/JS/CSS) ne portent aucune donnee de dossier -- la vraie
  // protection est sur les routes /api ci-dessus ; app.js se charge cote
  // client de rediriger vers /login.html si /api/auth/me echoue.
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'landing.html')));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Filet de securite pour les routes async (voir utils/asyncHandler.js) :
  // sans ce middleware, une erreur Postgres (ou autre) rejetee dans un
  // handler async ferait pendre la requete indefiniment au lieu de renvoyer
  // une reponse -- Express 4 n'attrape pas automatiquement les rejets de
  // promesses. Doit rester le DERNIER middleware monte.
  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err.message || 'Erreur serveur.' });
  });

  app.listen(PORT, () => {
    console.log(`Leez — serveur local sur http://localhost:${PORT}`);
  });

  // Render envoie SIGTERM avant de couper un service (redeploiement,
  // mise a l'echelle) -- laisse a PostHog une chance d'envoyer les
  // evenements encore en file plutot que de les perdre silencieusement.
  const analytics = require('./services/analytics');
  process.on('SIGTERM', async () => { await analytics.shutdown(); process.exit(0); });
}

main().catch(err => {
  console.error('Échec du démarrage du serveur :', err);
  process.exit(1);
});
