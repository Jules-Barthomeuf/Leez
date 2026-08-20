const express = require('express');
const { getSetting, setSetting } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/settings/fund-criteria', asyncHandler(async (req, res) => {
  res.json((await getSetting('fund_criteria', req.workspaceId)) || {});
}));

router.put('/settings/fund-criteria', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const criteria = {
    tailleMin: typeof body.tailleMin === 'number' ? body.tailleMin : null,
    tailleMax: typeof body.tailleMax === 'number' ? body.tailleMax : null,
    typologies: Array.isArray(body.typologies) ? body.typologies.filter(t => typeof t === 'string' && t.trim()) : [],
    localisation: typeof body.localisation === 'string' && body.localisation.trim() ? body.localisation.trim() : null,
    rendementCibleMin: typeof body.rendementCibleMin === 'number' ? body.rendementCibleMin : null,
    // Nature de chaque critere : eliminatoire (un echec = NO-GO) ou
    // negociable (un echec = point de discussion). Par defaut eliminatoire
    // -- un mandat est strict tant que le fonds n'a pas dit le contraire.
    natures: {
      taille: body.natures?.taille === 'negociable' ? 'negociable' : 'eliminatoire',
      typologie: body.natures?.typologie === 'negociable' ? 'negociable' : 'eliminatoire',
      localisation: body.natures?.localisation === 'negociable' ? 'negociable' : 'eliminatoire',
      rendement: body.natures?.rendement === 'negociable' ? 'negociable' : 'eliminatoire',
    },
  };
  // Bornes aberrantes rejetees ici plutot que digerees en silence : un
  // mandat mal saisi produirait des verdicts faux sur tous les dossiers.
  if (criteria.tailleMin != null && criteria.tailleMax != null && criteria.tailleMin >= criteria.tailleMax) {
    return res.status(400).json({ error: 'Taille minimum ≥ taille maximum : corrigez les bornes du ticket.' });
  }
  if (criteria.tailleMin != null && criteria.tailleMin < 0) return res.status(400).json({ error: 'La taille minimum ne peut pas être négative.' });
  if (criteria.tailleMax != null && criteria.tailleMax > 5e9) return res.status(400).json({ error: 'Taille maximum invraisemblable (> 5 Md€) : vérifiez la saisie.' });
  if (criteria.rendementCibleMin != null && (criteria.rendementCibleMin <= 0 || criteria.rendementCibleMin > 30)) {
    return res.status(400).json({ error: 'Rendement cible hors plage plausible (0–30 %).' });
  }
  await setSetting('fund_criteria', criteria, req.workspaceId);
  res.json(criteria);
}));

module.exports = router;
