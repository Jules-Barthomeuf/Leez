const express = require('express');
const { answerWithWebSearch, researchTenant } = require('../services/webSearch');
const { buildDealContextBlock } = require('../services/dealContext');
const { getDocument } = require('../db');

const router = express.Router();

// Resout le contexte de dossier (adresse/type/sous-marche) a partir d'un
// dossierId optionnel -- partage entre /web-search et /tenant-insight.
// Repli silencieux sur "pas de contexte" : un dossier introuvable ne doit
// jamais faire echouer la recherche, c'est un enrichissement, pas un
// prerequis.
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

// "AI Insight" (État locatif, clic sur une ligne) -- meme patron SSE que
// /web-search, prompt et tag de fiabilite des sources dedies au locataire
// (voir researchTenant dans webSearch.js).
router.post('/tenant-insight', async (req, res) => {
  const tenantName = typeof req.body?.tenantName === 'string' ? req.body.tenantName.trim() : '';
  if (!tenantName) return res.status(400).json({ error: 'Nom du locataire manquant.' });
  const activite = typeof req.body?.activite === 'string' ? req.body.activite.trim() : '';
  const dossierId = typeof req.body?.dossierId === 'string' ? req.body.dossierId.trim() : '';
  const dealContext = await resolveDealContext(dossierId, req.workspaceId);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  try {
    const result = await researchTenant({
      tenantName,
      activite,
      dealContext,
      onTextDelta: (text) => res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`),
    });
    res.write(`data: ${JSON.stringify({ type: 'done', sources: result.sources })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message || 'Erreur lors de la recherche sur ce locataire.' })}\n\n`);
  } finally {
    res.end();
  }
});

module.exports = router;
