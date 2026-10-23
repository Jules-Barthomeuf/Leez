// packages/rules : moteur de criteres et moteur de recoupements (sections 6 et 8),
// fonctions pures sans I/O, typees en JSDoc (decision A3). Les moteurs arrivent
// avec les phases 2 et 3 ; ce fichier fixe le contrat.

/** @typedef {import('../core/types').Fact} Fact */
/** @typedef {import('../core/types').MetricResult} MetricResult */

/** @typedef {'pass'|'fail'|'missing'} RuleOutcome */

/**
 * Le resultat de l'evaluation d'une regle de criteres (section 8).
 * @typedef {object} RuleResult
 * @property {string} rule_id
 * @property {RuleOutcome} outcome
 * @property {unknown} observed
 * @property {unknown} expected
 * @property {string[]} fact_ids
 * @property {string} message
 */

/**
 * Les quatre statuts de conformite, dans l'ordre de priorite de la section 8 (principe 10).
 * @type {readonly ['non_conforme', 'incomplet', 'a_discuter', 'conforme']}
 */
const ORDRE_CONFORMITE = Object.freeze(/** @type {const} */ (['non_conforme', 'incomplet', 'a_discuter', 'conforme']));

module.exports = { ORDRE_CONFORMITE };
