// Orchestrateur de l'onglet "Verification" -- enchaine, pour un document
// donne : (1) extraction des affirmations marketing du vendeur avec citation
// (extraction.js#extractVendorClaims), (2) verification stricte de ces
// citations contre le texte reel du document (verification.js#verifyVendorClaims
// -- une affirmation dont la citation ne se retrouve pas est rejetee dans son
// entier, jamais affichee), (3) pour chaque affirmation survivante, une vraie
// recherche web contextuelle au dossier qui produit un verdict
// confirme/nuance/contredit/donnees_insuffisantes avec sources taguees
// (webSearch.js#verifyClaimAgainstWeb).
//
// Chaque affirmation est resolue independamment (une erreur sur l'une ne
// bloque pas les autres) avec une concurrence bornee pour ne pas saturer les
// limites de debit de l'API tout en gardant un temps total raisonnable
// (plusieurs vraies recherches web sont necessairement lentes, 10-25s
// observees empiriquement cette session).
const { extractVendorClaims } = require('./extraction');
const { verifyVendorClaims } = require('./verification');
const { verifyClaimAgainstWeb } = require('./webSearch');
const { buildDealContextBlock } = require('./dealContext');

const CONCURRENCY = 3;

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

// onClaimsFound(claims) : liste initiale (citations deja verifiees) des que
// l'extraction+verification termine, AVANT toute recherche web -- permet a
// l'UI d'afficher immediatement des cartes "en attente" plutot qu'un ecran
// vide pendant plusieurs minutes.
// onClaimResult(claim) : une affirmation completee (verdict/justification/
// sources), appele au fur et a mesure, pas a la fin du lot.
// onClaimError({id, claimText, error}) : la recherche web a echoue pour
// cette affirmation precise -- n'interrompt pas le traitement des autres.
async function runVendorClaimsPipeline({ pdfBase64, pages, ficheIdentite, onClaimsFound, onClaimResult, onClaimError }) {
  const raw = await extractVendorClaims(pdfBase64);
  const claims = verifyVendorClaims(raw.claims, pages || []).map((c, i) => ({ id: `c${i + 1}`, ...c }));
  onClaimsFound(claims);

  const dealContext = buildDealContextBlock(ficheIdentite);
  await mapWithConcurrency(claims, CONCURRENCY, async (claim) => {
    try {
      const { verdict, justification, sources } = await verifyClaimAgainstWeb({
        claimText: claim.claimText,
        quote: claim.quote,
        dealContext,
      });
      onClaimResult({ ...claim, verdict, justification, sources, researchedAt: new Date().toISOString() });
    } catch (err) {
      onClaimError({ id: claim.id, claimText: claim.claimText, error: err.message || String(err) });
    }
  });
}

module.exports = { runVendorClaimsPipeline };
