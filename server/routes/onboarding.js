// Parcours d'accueil d'un nouvel utilisateur :
//   1. pop-up "prendre rendez-vous strategique pour definir votre strategie
//      d'investissement" -- affichee tant qu'aucun rendez-vous n'est connu ;
//   2. une fois le rendez-vous constate, invitation a s'acculturer via la
//      page Ressources -- FACULTATIVE, jamais bloquante.
//
// La prise de rendez-vous est constatee par le webhook de l'outil de
// reservation (voir POST /webhooks/booking dans index.js) : Leez ne
// declare jamais un rendez-vous pris sur la seule affirmation du client.
const express = require('express');
const { pool } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

router.get('/onboarding', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT meeting_booked_at, acculturation_seen_at FROM users WHERE id = $1',
    [req.userId]
  );
  const u = rows[0] || {};
  res.json({
    bookingUrl: (process.env.BOOKING_URL || '').trim() || null,
    meetingBookedAt: u.meeting_booked_at || null,
    acculturationSeenAt: u.acculturation_seen_at || null,
  });
}));

// L'utilisateur a pris connaissance de l'invitation a s'acculturer : on ne
// la lui repropose plus. Ne conditionne AUCUN acces -- purement cosmetique.
router.post('/onboarding/acculturation-seen', asyncHandler(async (req, res) => {
  await pool.query('UPDATE users SET acculturation_seen_at = now() WHERE id = $1 AND acculturation_seen_at IS NULL', [req.userId]);
  res.json({ ok: true });
}));

module.exports = router;
