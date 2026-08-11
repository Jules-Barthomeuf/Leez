// Tests purs (sans appel API) des 3 regles anti-hallucination de la couche
// agents. Execution : npm run test:agent-validation
const assert = require('assert');
const { validateAgentOutput, summaryHasStrayNumbers, filterFindingsWithSource } = require('./agentOutputValidation');

// 1. Finding sans source_url rejete silencieusement.
{
  const raw = {
    findings: [
      { kind: 'tenant_health', payload: { note: 'ok' }, source_url: 'https://example.com/a' },
      { kind: 'tenant_health', payload: { note: 'invente' }, source_url: '' },
      { kind: 'tenant_health', payload: { note: 'invente2' } }, // source_url absent
    ],
    summary: 'Un locataire recherché.',
  };
  const result = validateAgentOutput(raw);
  assert.strictEqual(result.findings.length, 1, 'seul le finding avec source_url doit survivre');
  assert.strictEqual(result.status, 'succeeded');
  console.log('OK  1. validateAgentOutput -> finding sans source_url rejeté silencieusement');
}

// 2. findings vide apres filtrage -> insufficient_data, quoi qu'ait renvoyé le modèle.
{
  const raw = { status: 'succeeded', findings: [{ kind: 'x', payload: {}, source_url: '' }], summary: 'Tout va bien.' };
  const result = validateAgentOutput(raw);
  assert.strictEqual(result.status, 'insufficient_data');
  assert.strictEqual(result.findings.length, 0);
  console.log('OK  2. validateAgentOutput -> findings vide après filtrage => insufficient_data');
}

// 3a. Résumé avec un chiffre absent des findings -> rejeté, remplacé par une liste brute.
{
  const findings = [{ kind: 'market_rent', payload: { min: 82, max: 95 }, source_url: 'https://a.fr' }];
  assert.strictEqual(summaryHasStrayNumbers('Loyer observé autour de 150 EUR/m2.', findings), true, '150 absent des findings doit être détecté');
  const result = validateAgentOutput({ findings, summary: 'Loyer observé autour de 150 EUR/m2 (chiffre halluciné).' });
  assert.ok(!result.summary.includes('150'), 'le résumé halluciné ne doit pas être conservé tel quel');
  assert.ok(result.summary.includes('82') || result.summary.includes('95'), 'le résumé de repli doit refléter les vrais findings');
  console.log('OK  3a. validateAgentOutput -> résumé avec chiffre non sourcé rejeté et remplacé');
}

// 3b. Résumé dont tous les chiffres proviennent bien des findings -> conservé tel quel.
{
  const findings = [{ kind: 'market_rent', payload: { min: 82, max: 95 }, source_url: 'https://a.fr' }];
  const result = validateAgentOutput({ findings, summary: 'Fourchette de loyer observée entre 82 et 95 EUR/m2.' });
  assert.strictEqual(result.summary, 'Fourchette de loyer observée entre 82 et 95 EUR/m2.');
  console.log('OK  3b. validateAgentOutput -> résumé dont les chiffres sont tous sourcés conservé tel quel');
}

// 3c. Résumé DÉTERMINISTE (deterministicSummary:true) -- jamais rejeté pour
// un chiffre absent des findings, même s'il en contient un (compte de
// locataires/éléments, pas un fait extrait) : ce n'est pas le modèle qui
// l'a rédigé, la régle anti-hallucination #3 ne s'applique qu'à ça.
{
  const findings = [{ kind: 'tenant_health', payload: { note: 'ok' }, source_url: 'https://a.fr' }];
  const result = validateAgentOutput({ findings, summary: '5 locataire(s) recherché(s), 1 élément(s) trouvé(s).', deterministicSummary: true });
  assert.strictEqual(result.summary, '5 locataire(s) recherché(s), 1 élément(s) trouvé(s).');
  console.log('OK  3c. validateAgentOutput -> résumé déterministe jamais rejeté même avec un chiffre absent des findings');
}

// 4. filterFindingsWithSource -- robuste à une entrée non-tableau (jamais d'exception).
{
  assert.deepStrictEqual(filterFindingsWithSource(null), []);
  assert.deepStrictEqual(filterFindingsWithSource(undefined), []);
  assert.deepStrictEqual(filterFindingsWithSource('pas un tableau'), []);
  console.log('OK  4. filterFindingsWithSource -> entrée non-tableau gérée sans exception');
}

console.log('\nTous les tests de agentOutputValidation.js sont passés.');
