// Tests purs (sans appel API) du moteur de reconciliation OM vs realite.
// Execution : npm run test:reconciliation
const assert = require('assert');
const { computeReconciliation } = require('./reconciliation');

// 1. Cas nominal : ecart significatif sur occupation et revenus -> signale.
{
  const doc = {
    ficheIdentite: {
      prixDemande: { value: '10000000' },
      rendementAffiche: { value: '6' },
      tauxOccupation: { value: '95' },
      taxeFonciere: { value: '50000' },
      chargesCoproPropriete: { value: '20000' },
    },
    indicateurs: {
      tauxOccupation: 81.5,
      capRateRecalcule: 5.1,
      revenuBrutEffectif: 510000,
      chargesTotal: -95000, // negatif par convention (computeT12Totals) -- sortie d'argent
    },
  };
  const rows = computeReconciliation(doc);
  const occ = rows.find(r => r.id === 'occupation');
  assert.strictEqual(occ.invoqueValue, 95);
  const charges = rows.find(r => r.id === 'charges');
  assert.strictEqual(charges.invoqueValue, 70000, 'OM = taxe foncière + copro = 50000 + 20000');
  assert.strictEqual(charges.constateValue, 95000, 'chargesTotal négatif (-95000) doit être comparé en valeur absolue, jamais un signe qui fausse le delta');
  assert.ok(charges.constateLabel.includes('95'), 'le libellé affiché doit montrer une magnitude positive, pas -95000');
  assert.strictEqual(occ.constateValue, 81.5);
  assert.strictEqual(occ.signal, 'critical', `écart de 13.5pt doit être critique, obtenu ${occ.signal}`);

  const rev = rows.find(r => r.id === 'revenus');
  assert.strictEqual(rev.invoqueValue, 600000, 'revenu implicite = 10M x 6% = 600000');
  assert.strictEqual(rev.constateValue, 510000);
  assert.strictEqual(rev.signal, 'critical', `écart de -15% doit être critique, obtenu ${rev.signal}`);
  console.log('OK  1. computeReconciliation -> écarts significatifs correctement signalés (occupation, revenus)');
}

// 2. Cas conforme : écarts faibles -> 'ok', jamais un faux signal.
{
  const doc = {
    ficheIdentite: {
      prixDemande: { value: '10000000' },
      rendementAffiche: { value: '6' },
      tauxOccupation: { value: '96' },
    },
    indicateurs: { tauxOccupation: 95.5, capRateRecalcule: 5.98 },
  };
  const rows = computeReconciliation(doc);
  assert.strictEqual(rows.find(r => r.id === 'occupation').signal, 'ok');
  assert.strictEqual(rows.find(r => r.id === 'rendement').signal, 'ok');
  console.log("OK  2. computeReconciliation -> écarts faibles classés 'ok', pas de faux signal");
}

// 3. Donnée manquante d'un côté -> 'indetermine', jamais un écart inventé.
{
  const doc = { ficheIdentite: {}, indicateurs: {} };
  const rows = computeReconciliation(doc);
  for (const r of rows) {
    assert.strictEqual(r.signal, 'indetermine', `${r.id} devrait être indeterminé sans données`);
    assert.strictEqual(r.deltaPct, null);
  }
  console.log('OK  3. computeReconciliation -> données manquantes => indéterminé, jamais un écart inventé');
}

// 4. Revenu implicite : absent si prix OU rendement affiché manque (jamais une estimation partielle).
{
  const doc = {
    ficheIdentite: { prixDemande: { value: '10000000' } }, // rendementAffiche absent
    indicateurs: { revenuBrutEffectif: 500000 },
  };
  const rows = computeReconciliation(doc);
  const rev = rows.find(r => r.id === 'revenus');
  assert.strictEqual(rev.invoqueValue, null);
  assert.strictEqual(rev.signal, 'indetermine');
  console.log("OK  4. computeReconciliation -> revenu implicite absent si rendement affiché manquant (pas d'estimation partielle)");
}

console.log('\nTous les tests de reconciliation.js sont passés.');
