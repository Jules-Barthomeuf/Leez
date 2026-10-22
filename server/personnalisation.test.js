const test = require('node:test');
const assert = require('node:assert');
const P = require('../public/js/personnalisation');

test('valeurs inconnues : retour au defaut', () => {
  const p = P.normaliser({ mode: 'nuit', accent: 'fuchsia', police: 'comic', fond_sombre: 'gris', barre_clair: 'rouge', inconnu: 1 });
  assert.deepEqual(p, { ...P.DEFAUT });
});

test('couleurs personnalisees acceptees en hexadecimal seulement', () => {
  assert.equal(P.normaliser({ accent: '#ABCDEF' }).accent, '#abcdef');
  assert.equal(P.normaliser({ accent: 'red' }).accent, P.DEFAUT.accent);
  assert.equal(P.normaliser({ barre_sombre: '#102030' }).barre_sombre, '#102030');
  assert.equal(P.normaliser({ barre_sombre: 'javascript:alert(1)' }).barre_sombre, 'origine');
});

test('halo : faux seulement si demande explicitement', () => {
  assert.equal(P.normaliser({ halo: false }).halo, false);
  assert.equal(P.normaliser({ halo: 'false' }).halo, false);
  assert.equal(P.normaliser({}).halo, true);
});

test('accent par theme et lisibilite de la barre', () => {
  assert.equal(P.accentHex('menthe', 'sombre'), '#96c0b8');
  assert.equal(P.accentHex('menthe', 'clair'), '#3f7466');
  assert.ok(P.barreLisible('#191a19', 'sombre'));
  assert.ok(!P.barreLisible('#d0d0d0', 'sombre'));
});
