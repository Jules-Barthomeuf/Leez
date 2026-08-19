const express = require('express');
const { search } = require('../services/kbSearch');
const { analyzeWithKnowledge } = require('../services/kbAnalyze');
const { countKbChunks, listKbSources } = require('../db');

const router = express.Router();

// Contenu reel de la base de connaissances (sources + volume) : l'ecran
// Memoire Institutionnelle s'en sert pour afficher ce que la base contient
// -- ou pour dire clairement qu'elle est vide, plutot que d'afficher une
// recherche qui ne trouvera jamais rien sans explication.
router.get('/knowledge/stats', async (_req, res) => {
  try {
    const [chunks, sources] = await Promise.all([countKbChunks(), listKbSources()]);
    res.json({ chunks, sources });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de la lecture de la base de connaissances.' });
  }
});

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
