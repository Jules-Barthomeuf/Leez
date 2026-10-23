// Sentry, actif seulement si SENTRY_DSN est defini (spec, section 1). Sans
// DSN, rien n'est charge et capturer() se contente du journal.
let Sentry = null;

function initialiser(service) {
  if (!process.env.SENTRY_DSN) return false;
  try {
    Sentry = require('@sentry/node');
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development', serverName: `leez-${service}`, tracesSampleRate: 0 });
    return true;
  } catch (e) {
    console.warn('[sentry] initialisation impossible :', e.message);
    return false;
  }
}

function capturer(err, contexte = {}) {
  if (Sentry) Sentry.captureException(err, { extra: contexte });
  else console.error('[erreur]', err && err.message ? err.message : err, Object.keys(contexte).length ? contexte : '');
}

module.exports = { initialiser, capturer };
