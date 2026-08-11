// Petit utilitaire partage : traite `items` avec au plus `limit` appels
// `fn` en vol simultanement. Extrait de vendorClaimsVerifier.js (premier
// usage) pour etre reutilise par l'orchestrateur d'agents sans dupliquer
// la logique de pool.
async function mapWithConcurrency(items, limit, fn) {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

module.exports = { mapWithConcurrency };
