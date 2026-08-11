const express = require('express');
const { answerWithWebSearch } = require('../services/webSearch');
const { buildDealContextBlock } = require('../services/dealContext');
const { getDocument } = require('../db');

const router = express.Router();

// Resout le contexte de dossier (adresse/type/sous-marche) a partir d'un
// dossierId optionnel -- utilise par /web-search (l'agent 'locataires' a
// son propre resolveur equivalent dans agentRunner.js, via
// buildDealContextBlock directement sur le dossier deja charge). Repli
// silencieux sur "pas de contexte" : un dossier introuvable ne doit jamais
// faire echouer la recherche, c'est un enrichissement, pas un prerequis.
async function resolveDealContext(dossierId, workspaceId) {
  if (!dossierId) return '';
  try {
    const doc = await getDocument(dossierId, workspaceId);
    return doc?.fiche_identite_json ? buildDealContextBlock(doc.fiche_identite_json) : '';
  } catch {
    return '';
  }
}

// SSE : chaque fragment de texte genere par le modele est relaye au client
// des qu'il arrive (event "delta"), puis un event "done" porte les sources
// finales une fois la reponse complete. Les erreurs avant tout octet envoye
// restent en JSON classique ; une fois le flux ouvert, une erreur devient un
// event "error" (impossible de changer le status HTTP a ce stade).
router.post('/web-search', async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) return res.status(400).json({ error: 'La question est vide.' });
  const dossierId = typeof req.body?.dossierId === 'string' ? req.body.dossierId.trim() : '';
  const dealContext = await resolveDealContext(dossierId, req.workspaceId);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  try {
    const result = await answerWithWebSearch({
      question,
      dealContext,
      onTextDelta: (text) => res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`),
    });
    res.write(`data: ${JSON.stringify({ type: 'done', sources: result.sources })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message || 'Erreur lors de la recherche web.' })}\n\n`);
  } finally {
    res.end();
  }
});

// L'ancien "AI Insight" locataire (SSE sur connexion unique, sans
// persistance) a ete retire -- migre sur l'agent 'locataires' de
// l'orchestration multi-agents (POST /dossiers/:id/agents/run, voir
// routes/agents.js et services/agents/locataires.js), qui reutilise
// resolveDealContext ci-dessus via le meme dealContext.js.

module.exports = router;
