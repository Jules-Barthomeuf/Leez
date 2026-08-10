// Tests purs (sans appel API) des briques deterministes du verificateur
// d'affirmations du vendeur. Execution : npm run test:vendor-claims
const assert = require('assert');
const { classifySourceReliability } = require('./sourceReliability');
const { buildDealContextBlock } = require('./dealContext');

// 1. Domaines officiels reconnus -> 'officielle'.
{
  const officials = [
    'https://www.insee.fr/fr/statistiques/1234',
    'https://data.gouv.fr/fr/datasets/dvf',
    'https://www.ademe.fr/expertises/dpe',
    'https://www.geoportail-urbanisme.gouv.fr/',
    'https://cadastre.data.gouv.fr/map',
    'https://app.dvf.etalab.gouv.fr/',
    'https://www.economie.gouv.fr/actualite', // *.gouv.fr générique
  ];
  for (const url of officials) {
    assert.strictEqual(classifySourceReliability(url), 'officielle', `${url} devrait être 'officielle'`);
  }
  console.log('OK  1. classifySourceReliability -> domaines officiels reconnus');
}

// 2. Domaines non officiels -> 'a_confirmer' (jamais 'officielle' par défaut).
{
  const others = [
    'https://www.toutsurmesfinances.com/placements/taux-livret-a.html',
    'https://forum-immobilier.fr/discussion/123',
    'https://www.lesechos.fr/finance-marches/marches-financiers',
  ];
  for (const url of others) {
    assert.strictEqual(classifySourceReliability(url), 'a_confirmer', `${url} devrait être 'a_confirmer'`);
  }
  console.log('OK  2. classifySourceReliability -> autres domaines = a_confirmer par défaut');
}

// 3. URL malformée -> ne jamais lever, repli sur 'a_confirmer'.
{
  assert.strictEqual(classifySourceReliability('ceci-nest-pas-une-url'), 'a_confirmer');
  assert.strictEqual(classifySourceReliability(''), 'a_confirmer');
  console.log('OK  3. classifySourceReliability -> URL malformée gérée sans exception');
}

// 4. buildDealContextBlock -- champs vides/null ignorés, champs peuplés inclus.
{
  const fiche = {
    adresse: { value: '42 Avenue des Champs-Élysées' },
    typeActif: { value: 'Bureaux' },
    sousMarche: { value: null },
    prixDemande: { value: '' },
    classeDPE: { value: 'C' },
  };
  const block = buildDealContextBlock(fiche);
  assert.ok(block.includes('Adresse : 42 Avenue des Champs-Élysées'), 'adresse peuplée doit apparaître');
  assert.ok(block.includes('Bureaux'), "typeActif peuplé doit apparaître");
  assert.ok(block.includes('Classe DPE : C'), 'classeDPE peuplé doit apparaître');
  assert.ok(!block.includes('Sous-marché'), 'champ null doit être ignoré');
  assert.ok(!block.includes('Prix demandé'), 'champ vide doit être ignoré');
  console.log('OK  4. buildDealContextBlock -> ignore les champs vides/null, garde les champs peuplés');
}

// 5. buildDealContextBlock -- fiche vide/absente -> chaîne vide, jamais d'exception.
{
  assert.strictEqual(buildDealContextBlock(null), '');
  assert.strictEqual(buildDealContextBlock(undefined), '');
  assert.strictEqual(buildDealContextBlock({}), '');
  console.log('OK  5. buildDealContextBlock -> fiche absente/vide -> chaîne vide');
}

console.log('\nTous les tests de vendorClaims (sourceReliability + dealContext) sont passés.');
