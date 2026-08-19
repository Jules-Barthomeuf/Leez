const express = require('express');
const multer = require('multer');
const { getDocument, getSetting } = require('../db');
const { askAboutDossier } = require('../services/dealChat');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// Image jointe a une question de l'Assistant (mode normal uniquement) :
// jamais ecrite sur disque, jamais persistee -- seulement transmise au
// modele pour CETTE reponse (voir dealChat.js), donc memoire suffit.
// Meme filtre de type que les documents annexes "Photos & visuels".
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(new Error('Type de fichier non accepté (JPG, PNG ou WEBP).'));
    }
    cb(null, true);
  },
}).single('image');

// Assistant global (ecran d'accueil) -- le dossier est OPTIONNEL : un
// selecteur cote client permet de choisir sur quel dossier une question
// specifique porte (Q/R citee sur son texte reel + base de connaissances).
// Sans dossier selectionne, seuls la conversation generale, la base de
// connaissances et les actions restent disponibles -- voir dealChat.js.
router.post('/assistant/ask', uploadImage, asyncHandler(async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) return res.status(400).json({ error: 'La question est vide.' });
  const dossierId = typeof req.body?.dossierId === 'string' ? req.body.dossierId.trim() : '';
  let doc = null;
  if (dossierId) {
    doc = await getDocument(dossierId, req.workspaceId);
    if (!doc) return res.status(404).json({ error: 'Dossier introuvable.' });
    if (doc.status !== 'complete') return res.status(400).json({ error: "L'extraction du dossier doit être terminée avant de poser une question." });
  }
  const image = req.file ? { mediaType: req.file.mimetype, base64: req.file.buffer.toString('base64') } : null;
  try {
    // Toujours recharge (jamais mis en cache) : les reglages du fonds
    // peuvent changer entre deux questions, l'Assistant doit refleter la
    // configuration actuelle, pas celle du demarrage du serveur.
    const fundCriteria = (await getSetting('fund_criteria', req.workspaceId)) || null;
    // Flags de sources (chat du dossier) -- valeurs FormData, donc chaines.
    const useDoc = req.body?.useDoc !== 'false' && req.body?.useDoc !== false;
    const useKb = req.body?.useKb !== 'false' && req.body?.useKb !== false;
    const result = await askAboutDossier({ doc, question, fundCriteria, image, useDoc, useKb });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Erreur lors de la réponse." });
  }
}));

module.exports = router;
