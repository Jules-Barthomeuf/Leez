const express = require('express');
const { interpretPresentationCopilot } = require('../services/promptPresentation');

const router = express.Router();

router.post('/presentation/prompt', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) return res.status(400).json({ error: 'Le prompt est vide.' });
  try {
    const spec = await interpretPresentationCopilot({ prompt, context: req.body?.context });
    res.json(spec);
  } catch (err) {
    res.status(500).json({ error: err.message || "Erreur lors de l'interprétation du prompt." });
  }
});

module.exports = router;
