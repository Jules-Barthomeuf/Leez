// Coeur du dispositif anti-hallucination pour la couche "agents" (voir
// spec "Leez -- orchestration multi-agents" §4.2) -- le pendant, au niveau
// d'un agent, du recoupement de citation deja applique aux champs extraits
// de l'OM (verification.js). Trois regles, appliquees cote SERVEUR avant
// toute ecriture en base, jamais laissees a la discipline du modele :
//
// 1. Un finding sans source_url est rejete silencieusement (jamais affiche).
// 2. Si plus aucun finding ne survit au filtrage, le statut passe a
//    'insufficient_data' quoi qu'ait renvoye le modele -- jamais de
//    'succeeded' avec zero finding.
// 3. Le resume (summary) ne doit contenir aucun nombre absent des findings
//    retenus : sinon il est rejete et remplace par une liste brute des
//    findings (jamais un chiffre invente qui se glisserait dans une phrase
//    de synthese sans etre rattache a une source verifiable). Ne s'applique
//    QUE si le resume est redige par le modele -- un agent qui construit
//    lui-meme un resume deterministe (comptes deja connus cote code, ex.
//    "5 locataires recherches") doit passer `deterministicSummary: true`
//    pour etre exempte : ce genre de resume contient legitimement des
//    nombres absents du payload des findings (des METAdonnees sur le run,
//    pas des faits extraits), la regle 3 les rejetterait sinon a tort.
//
// Pure -- aucun appel reseau/DB ici, uniquement transforme un objet brut
// (contrat §4.2) en {status, findings, summary, stepsLog} prets a persister.

// Nombres avec separateur decimal , ou . -- suffisant pour les grandeurs
// qu'un agent manipule ici (loyers, surfaces, taux, annees), pas un
// parseur numerique general. Lookbehind negatif sur une lettre : sans lui,
// "m2"/"m²" (unite de surface collee au chiffre) ferait remonter un faux
// nombre "2" absent des findings et rejetterait a tort un resume correct.
function extractNumericTokens(text) {
  if (!text) return [];
  const matches = String(text).match(/(?<![a-zà-ü])\d+(?:[.,]\d+)?/gi) || [];
  return matches.map(m => m.replace(',', '.'));
}

function filterFindingsWithSource(findings) {
  return (Array.isArray(findings) ? findings : []).filter(
    f => f && typeof f.source_url === 'string' && f.source_url.trim().length > 0
  );
}

// Compare les nombres presents dans le resume a ceux presents dans le
// payload des findings retenus -- un nombre du resume absent de tous les
// findings est un signe de chiffre invente/extrapole par le modele.
function summaryHasStrayNumbers(summary, findings) {
  const findingsText = findings.map(f => JSON.stringify(f.payload || {})).join(' ');
  const allowed = new Set(extractNumericTokens(findingsText));
  return extractNumericTokens(summary).some(n => !allowed.has(n));
}

function buildFallbackSummary(findings) {
  if (findings.length === 0) return 'Aucune donnée exploitable trouvée.';
  return findings.map(f => `• ${f.source_label || f.source_url} : ${JSON.stringify(f.payload)}`).join('\n');
}

function validateAgentOutput(raw) {
  const findings = filterFindingsWithSource(raw?.findings);
  const stepsLog = Array.isArray(raw?.steps_log) ? raw.steps_log : [];
  if (findings.length === 0) {
    return { status: 'insufficient_data', findings: [], summary: 'Aucune donnée exploitable trouvée.', stepsLog };
  }
  let summary = String(raw?.summary || '').trim();
  if (!summary || (!raw?.deterministicSummary && summaryHasStrayNumbers(summary, findings))) {
    summary = buildFallbackSummary(findings);
  }
  return { status: 'succeeded', findings, summary, stepsLog };
}

module.exports = { validateAgentOutput, extractNumericTokens, filterFindingsWithSource, summaryHasStrayNumbers };
