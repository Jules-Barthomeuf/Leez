// Retry avec backoff exponentiel pour les appels a l'API Anthropic --
// UNIQUEMENT sur les erreurs transitoires (rate limit, indisponibilite
// temporaire, probleme reseau) : une erreur permanente (schema invalide,
// refus du modele, cle API invalide) ne se resout jamais en reessayant,
// autant echouer immediatement avec un message clair plutot que de faire
// attendre l'analyste pour rien.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 529]); // 529 = "overloaded" cote Anthropic
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']);

async function withRetry(fn, { maxAttempts = 3, baseDelayMs = 1000, maxDelayMs = 20000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.status || err.response?.status;
      const retryable = RETRYABLE_STATUSES.has(status) || (!status && RETRYABLE_CODES.has(err.code));
      if (!retryable || attempt >= maxAttempts) throw err;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs) + Math.random() * 250;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

module.exports = { withRetry };
