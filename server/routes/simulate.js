const express = require('express');
const { interpretSimCopilot, interpretSimSuggestions } = require('../services/promptSim');
const { generateSimNarrative } = require('../services/simNarrative');

const router = express.Router();

router.post('/simulate/prompt', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) return res.status(400).json({ error: "Le prompt est vide." });
  try {
    const spec = await interpretSimCopilot({ prompt, simState: req.body?.simState });
    res.json(spec);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de l\'interprétation du prompt.' });
  }
});

router.post('/simulate/suggest', async (req, res) => {
  try {
    const spec = await interpretSimSuggestions(req.body || {});
    res.json(spec);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de la génération des suggestions.' });
  }
});

router.post('/simulate/narrative', async (req, res) => {
  try {
    const result = await generateSimNarrative(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de la génération du commentaire.' });
  }
});

module.exports = router;
