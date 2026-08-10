// Test synthetique du moteur de verification, sans appel a l'API Claude.
// Execution : npm run test:verification
const assert = require('assert');
const { verifyClaim, verifyExtractedTree, verifyVendorClaims } = require('./verification');

const pages = [
  {
    pageNumber: 1,
    text: 'NORTHGATE CORPORATE CENTER 18 Avenue du General de Gaulle 69130 Ecully. Prix de vente affiche : 255 000 000 EUR.',
    pageWidth: 595,
    pageHeight: 842,
    spans: [
      { start: 0, end: 27, x: 50, y: 50, w: 300, h: 14 },
      { start: 28, end: 60, x: 50, y: 70, w: 320, h: 12 },
      { start: 61, end: 82, x: 50, y: 90, w: 150, h: 12 },
      { start: 83, end: 115, x: 50, y: 110, w: 260, h: 12 },
    ],
  },
  {
    pageNumber: 2,
    text: 'Etat locatif. Loyer annuel Vertex Systems : 1 938 900 EUR.',
    pageWidth: 595,
    pageHeight: 842,
    spans: [
      { start: 0, end: 13, x: 50, y: 50, w: 100, h: 12 },
      { start: 14, end: 59, x: 50, y: 70, w: 300, h: 12 },
    ],
  },
];

// 1. Citation exacte, valeur correcte -> verifie, avec box derivee.
{
  const claim = { value: '255 000 000 €', page: 1, quote: 'Prix de vente affiché : 255 000 000 EUR' };
  const result = verifyClaim(claim, pages);
  assert.strictEqual(result.verified, true, 'citation exacte doit etre verifiee');
  assert.strictEqual(result.page, 1);
  assert.ok(Array.isArray(result.box), 'une box doit etre derivee');
  console.log('OK  1. citation exacte + valeur correcte ->', result.verified, result.box);
}

// 2. Citation legerement differente (une lettre) -> doit passer par le flou.
{
  const claim = { value: '255 000 000 €', page: 1, quote: 'Prx de vente affiche : 255 000 000 EUR' };
  const result = verifyClaim(claim, pages, { threshold: 0.85 });
  assert.strictEqual(result.verified, true, 'une citation quasi-exacte doit passer le seuil flou');
  console.log('OK  2. citation avec faute mineure (floue) ->', result.verified, 'score=', result.matchScore.toFixed(3));
}

// 3. Page correcte, mais citation qui n'existe nulle part -> rejet.
{
  const claim = { value: '999 999 999 €', page: 1, quote: 'Ceci ne figure nulle part dans le document source' };
  const result = verifyClaim(claim, pages);
  assert.strictEqual(result.verified, false, 'une citation absente doit etre rejetee');
  assert.strictEqual(result.reason, 'quote_not_found');
  console.log('OK  3. citation absente -> rejetee, reason=', result.reason);
}

// 4. Citation trouvee mais valeur annoncee incorrecte -> rejet (cas hallucination).
{
  const claim = { value: '999 000 000 €', page: 1, quote: 'Prix de vente affiché : 255 000 000 EUR' };
  const result = verifyClaim(claim, pages);
  assert.strictEqual(result.verified, false, 'une valeur qui ne correspond pas au texte cite doit etre rejetee');
  assert.strictEqual(result.reason, 'value_not_in_quote');
  console.log('OK  4. valeur divergente de la citation -> rejetee, reason=', result.reason);
}

// 5. Page hors bornes -> rejet immediat, jamais de recherche floue sur la mauvaise page.
{
  const claim = { value: '255 000 000 €', page: 99, quote: 'Prix de vente affiché : 255 000 000 EUR' };
  const result = verifyClaim(claim, pages);
  assert.strictEqual(result.verified, false);
  assert.strictEqual(result.reason, 'page_out_of_range');
  console.log('OK  5. page hors bornes -> rejetee, reason=', result.reason);
}

// 6. Verification d'un arbre complet (forme retournee par extraction.js).
{
  const tree = {
    ficheIdentite: {
      adresse: { value: '18 Avenue du Général de Gaulle', page: 1, quote: '18 Avenue du General de Gaulle' },
      prixDemande: { value: '999 000 000 €', page: 1, quote: 'Prix de vente affiché : 255 000 000 EUR' },
    },
    etatLocatif: [
      { locataire: 'Vertex Systems', loyerAnnuel: { value: 1938900, page: 2, quote: 'Loyer annuel Vertex Systems : 1 938 900 EUR' } },
    ],
  };
  const verified = verifyExtractedTree(tree, pages);
  assert.strictEqual(verified.ficheIdentite.adresse.verified, true);
  assert.strictEqual(verified.ficheIdentite.prixDemande.verified, false);
  assert.strictEqual(verified.ficheIdentite.prixDemande.value, null, 'un champ non verifie doit etre mis a null, jamais affiche');
  assert.strictEqual(verified.etatLocatif[0].loyerAnnuel.verified, true);
  assert.strictEqual(verified.etatLocatif[0].loyerAnnuel.value, 1938900);
  console.log('OK  6. verification recursive de l\'arbre complet -> champs mixtes geres correctement');
}

// 7. verifyVendorClaims -- contrat STRICT (contraire de verifyContexteTheme) :
// une affirmation dont la citation ne se retrouve pas est rejetee dans son
// ENTIER, jamais gardee sous une forme degradee.
{
  const raw = [
    { theme: 'Croissance du marché', claimText: 'Le quartier est en forte croissance', page: 1, quote: 'Prix de vente affiché : 255 000 000 EUR' },
    { theme: 'Affirmation fantaisiste', claimText: 'Ceci ne figure nulle part', page: 1, quote: 'Ceci ne figure nulle part dans le document source' },
  ];
  const kept = verifyVendorClaims(raw, pages);
  assert.strictEqual(kept.length, 1, 'seule la claim a citation verifiee doit survivre');
  assert.strictEqual(kept[0].theme, 'Croissance du marché');
  assert.strictEqual(kept[0].claimText, 'Le quartier est en forte croissance');
  console.log('OK  7. verifyVendorClaims -> rejette la citation non retrouvée, garde la valide');
}

console.log('\nTous les tests de verification.js sont passes.');
