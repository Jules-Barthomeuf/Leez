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
  };
  await setSetting('fund_criteria', criteria, req.workspaceId);
  res.json(criteria);
}));

module.exports = router;
