// packages/calc : le seul endroit ou un nombre est produit (principe 2).
// Fonctions pures en decimal.js, sans I/O, typees en JSDoc (decision A3).
// Les metriques de la section 7 arrivent avec la phase 3 ; ce fichier fixe
// le contrat et les outils communs.
const { Decimal } = require('decimal.js');

/** @typedef {import('../core/types').Money} Money */
/** @typedef {import('../core/types').MoneyJson} MoneyJson */
/** @typedef {import('../core/types').MetricResult} MetricResult */

// Arithmetique decimale a 20 chiffres significatifs, arrondi au plus proche : jamais de flottant.
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_EVEN });

/**
 * Lit un montant JSON (chaine decimale) en Money (Decimal). Leve si la chaine n'est pas un decimal.
 * @param {MoneyJson} json
 * @returns {Money}
 */
function lireMoney(json) {
  if (!/^-?\d+(\.\d+)?$/.test(json.amount)) throw new Error(`Montant invalide : ${json.amount}`);
  return { amount: new Decimal(json.amount), currency: json.currency || 'EUR', period: json.period, tax: json.tax ?? null, charges: json.charges ?? null };
}

/**
 * Ecrit un Decimal en chaine decimale pour la base ou l'API (jamais en number).
 * @param {Decimal|null} d
 * @param {number} [decimales]  nombre de decimales, par defaut sans arrondi
 * @returns {string|null}
 */
function enChaine(d, decimales) {
  if (d == null) return null;
  return decimales == null ? d.toString() : d.toFixed(decimales);
}

module.exports = { Decimal, lireMoney, enChaine };
