// Webhook de l'outil de reservation (Calendly, Cal.com, TidyCal...) : c'est
// LUI qui atteste qu'un rendez-vous strategique a bien ete pris. Route
// PUBLIQUE (aucune session) mais protegee par un secret partage, montee
// AVANT requireAuth dans index.js.
//
// Deux protections, toutes deux necessaires :
//  - sans BOOKING_WEBHOOK_SECRET configure, la route repond 503 et ne fait
//    RIEN : une instance mal configuree ne doit pas accepter n'importe qui
//    a marquer des rendez-vous comme pris ;
//  - comparaison du secret a temps constant (timingSafeEqual) plutot que
//    `===`, qui fuit la longueur et le prefixe par son temps d'execution.
const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

function secretOk(provided) {
  const expected = (process.env.BOOKING_WEBHOOK_SECRET || '').trim();
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Les outils de reservation ne partagent pas de format commun : on cherche
// l'email de la personne aux endroits usuels plutot que d'imposer un seul
// fournisseur. Rien trouve => 400 explicite, jamais un succes silencieux.
function extractEmail(body) {
  const candidates = [
    body?.email,
    body?.invitee?.email,
    body?.payload?.email,
    body?.payload?.invitee?.email,
    body?.attendee?.email,
    Array.isArray(body?.payload?.attendees) ? body.payload.attendees[0]?.email : null,
    Array.isArray(body?.attendees) ? body.attendees[0]?.email : null,
  ];
  const found = candidates.find(v => typeof v === 'string' && v.includes('@'));
  return found ? found.trim() : null;
}

router.post('/webhooks/booking', asyncHandler(async (req, res) => {
  if (!(process.env.BOOKING_WEBHOOK_SECRET || '').trim()) {
    return res.status(503).json({ error: 'Webhook de réservation non configuré (BOOKING_WEBHOOK_SECRET absente).' });
  }
  const provided = req.get('x-booking-secret') || req.query.secret;
  if (!secretOk(provided)) return res.status(401).json({ error: 'Secret invalide.' });

  const email = extractEmail(req.body);
  if (!email) return res.status(400).json({ error: "Email de la personne introuvable dans la charge utile du webhook." });

  // Ne marque JAMAIS un compte inexistant, et n'ecrase pas une date deja
  // posee (un webhook peut etre rejoue par l'outil de reservation).
  const { rowCount } = await pool.query(
    'UPDATE users SET meeting_booked_at = COALESCE(meeting_booked_at, now()) WHERE lower(email) = lower($1)',
    [email]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Aucun compte Leez pour cette adresse.' });
  res.json({ ok: true, email });
}));

module.exports = router;
