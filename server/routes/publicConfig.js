// Configuration publique exposee au client -- montee AVANT le requireAuth
// global (comme /api/auth/*, voir index.js) : app.js appelle cette route
// des le chargement de la page pour initialiser PostHog, avant meme
// d'avoir confirme qu'une session est valide. Ne jamais y ajouter un
// secret qui ne soit pas deja destine a etre visible cote navigateur (une
// cle PostHog client est publique par design, comme une cle Stripe
// publishable).
const express = require('express');

const router = express.Router();

router.get('/public-config', (req, res) => {
  res.json({
    posthogKey: process.env.POSTHOG_API_KEY || null,
    posthogHost: process.env.POSTHOG_HOST || 'https://eu.i.posthog.com',
  });
});

module.exports = router;
