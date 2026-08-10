const express = require('express');
const { search } = require('../services/kbSearch');
const { analyzeWithKnowledge } = require('../services/kbAnalyze');

const router = express.Router();

router.post('/knowledge/search', async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) return res.status(400).json({ error: 'La requête est vide.' });
  try {
    const results = await search(query, req.body?.k || 5);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de la recherche.' });
  }
});

router.post('/knowledge/analyze', async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) return res.status(400).json({ error: 'La question est vide.' });
  try {
    const result = await analyzeWithKnowledge({ question, dealContext: req.body?.dealContext || '' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Erreur lors de l'analyse." });
  }
});

module.exports = router;
