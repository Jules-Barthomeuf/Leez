// Tests purs (aucun appel API) de la resolution geographique du critere de
// localisation.  Execution : npm run test:geography
const assert = require('assert');
const { evaluerLocalisation } = require('./geography');

function cas(cible, observe, attendu, note) {
  const r = evaluerLocalisation(cible, observe);
  assert.strictEqual(r.status, attendu,
    `« ${cible} » vs « ${observe} » : attendu ${attendu}, obtenu ${r.status} (${r.motif})`);
  console.log(`OK  ${String(cible).padEnd(12)} vs ${String(observe).slice(0, 34).padEnd(36)} -> ${attendu.padEnd(12)} ${note || ''}`);
}

// --- le cas signale : Madrid est evidemment en Europe ---
cas('Europe', 'Coslada, Communauté de Madrid', 'ok', '(cas signalé)');

// --- appartenance par hierarchie ---
cas('Europe', '75013 Paris', 'ok', '(code postal FR -> France -> Europe)');
cas('Europe', 'Kingston upon Hull, East Riding of Yorkshire', 'ok');
cas('Europe', 'Panningen, Limbourg', 'ok');
cas('France', 'Meaux, Seine-et-Marne', 'ok');
cas('Espagne', 'Coslada, Communauté de Madrid', 'ok');
cas('Royaume-Uni', 'Hull', 'ok');

// --- correspondance textuelle directe (comportement historique preserve) ---
cas('Paris', '10 Place de la Démonstration, 75013 Paris', 'ok');
cas('paris', 'PARIS 13e', 'ok', '(insensible casse/accents)');

// --- non-appartenance REELLEMENT etablie ---
cas('France', 'Coslada, Communauté de Madrid', 'echec', '(Espagne ≠ France)');
cas('Espagne', 'Meaux, Seine-et-Marne', 'echec');
cas('Paris', 'Lyon', 'echec', '(deux lieux connus, distincts)');

// --- doute : jamais un echec invente ---
cas('Europe', 'Zone industrielle non précisée', 'indetermine', '(lieu inconnu)');
cas('Grand Paris', 'Coslada, Communauté de Madrid', 'indetermine', '(cible non reconnue)');
cas('Europe', '', 'indetermine', '(localisation non extraite)');

console.log('\nTous les tests de geography.js sont passés.');
