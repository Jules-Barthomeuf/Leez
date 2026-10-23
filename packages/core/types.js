// Types de base de la plateforme, en JSDoc (decision A3). Ce fichier n'exporte
// que des types : `calc`, `rules` et `core` les importent avec
// `@typedef {import('../core/types').Money} Money`. Tout montant est un
// Decimal (decimal.js), jamais un `number`.

/** @typedef {import('decimal.js').Decimal} Decimal */

/**
 * Un montant d'argent, tel qu'il sort d'un document : jamais converti ici (la
 * conversion mensuel → annuel est faite par `calc`).
 * @typedef {object} Money
 * @property {Decimal} amount        montant en decimal.js
 * @property {string} currency       'EUR'
 * @property {'month'|'quarter'|'year'} period
 * @property {'HT'|'TTC'|null} tax
 * @property {'HC'|'CC'|null} charges
 */

/**
 * La forme JSON d'un montant, telle que stockee dans `facts.value` (chaines decimales).
 * @typedef {object} MoneyJson
 * @property {string} amount
 * @property {string} [currency]
 * @property {'month'|'quarter'|'year'} period
 * @property {'HT'|'TTC'|null} [tax]
 * @property {'HC'|'CC'|null} [charges]
 */

/** @typedef {'verified'|'unverified'|'human'|'conflict'|'public_data'} FactStatus */
/** @typedef {'extraction'|'human'|'public_data'|'resolution'} FactSource */
/** @typedef {'money'|'number'|'percent'|'surface'|'date'|'duration'|'index_ref'|'boolean'|'enum'|'text'|'address'} ValueType */

/**
 * Une preuve : l'extrait du document (ou la reference publique) qui justifie un fait.
 * @typedef {object} Evidence
 * @property {string} id
 * @property {string} org_id
 * @property {'document'|'public_data'|'human'} source_kind
 * @property {string|null} document_id
 * @property {number|null} page_number
 * @property {string|null} quote               extrait recopie mot pour mot (300 caracteres au plus)
 * @property {number|null} char_start
 * @property {number|null} char_end
 * @property {[number, number, number, number]|null} bbox   [x0, y0, x1, y1] en fractions de page (0 a 1)
 * @property {number|null} match_score
 * @property {{ source: string, url: string, params?: unknown, fetched_at: string }|null} external_ref
 */

/**
 * Un fait sourcé : l'unite de base de la plateforme (principe 1). Une ligne de la table `facts`.
 * @typedef {object} Fact
 * @property {string} id
 * @property {string} org_id
 * @property {string} deal_id
 * @property {string} lot_key                 'main' par defaut
 * @property {string|null} document_id        null = fait resolu au niveau du deal
 * @property {string} field_key
 * @property {ValueType} value_type
 * @property {unknown} value                  la forme JSON du type (voir packages/core, VALEURS) ; null si absent
 * @property {string|null} unit
 * @property {string|null} raw_text
 * @property {FactStatus} status
 * @property {number|null} confidence
 * @property {string|null} evidence_id
 * @property {FactSource} source
 * @property {string|null} extraction_run_id
 * @property {string[]|null} derived_from
 * @property {number} version
 * @property {boolean} is_current
 * @property {string|null} superseded_by
 * @property {string|null} created_by
 */

/**
 * Le resultat d'une metrique de `calc` (spec, section 7).
 * @typedef {object} MetricResult
 * @property {string} metric_key
 * @property {string|null} value          decimal en chaine, null si une entree manque
 * @property {string[]} missing           cles de faits manquantes
 * @property {string[]} input_fact_ids
 * @property {string} formula_id          ex. "rendement_aem@1"
 * @property {string} explanation         la formule avec ses valeurs, en francais
 * @property {boolean} [simulated]
 */

/**
 * Une page lue par un parseur (section 4, job document.parse, et benchmark des parseurs).
 * Les coordonnees sont des fractions de page (0 a 1), origine en haut a gauche.
 * @typedef {object} ParsedBlock
 * @property {string} id
 * @property {'text'|'title'|'table'|'figure'} type
 * @property {[number, number, number, number]|null} bbox   [x0, y0, x1, y1], null si le parseur ne donne pas de coordonnees
 * @property {number} char_start          position du bloc dans le texte de la page
 * @property {number} char_end
 * @property {string} text
 * @property {ParsedTable} [table]
 */
/**
 * @typedef {object} ParsedTable
 * @property {string[][]} rows            lignes de cellules, en texte
 * @property {[number, number, number, number]|null} [bbox]
 */
/**
 * @typedef {object} ParsedPage
 * @property {number} page_number         1 = premiere page
 * @property {number|null} width          en points PDF ou pixels ; null si inconnu
 * @property {number|null} height
 * @property {string} text                texte de la page, dans l'ordre de lecture
 * @property {ParsedBlock[]} blocks
 * @property {boolean} ocr                vrai si le texte vient d'une reconnaissance optique
 */
/**
 * @typedef {object} ParsedDocument
 * @property {string} parser              nom du parseur (pdfjs, tesseract, docling, mistral, azure, claude)
 * @property {ParsedPage[]} pages
 * @property {{ ms: number, cout_eur: number|null, pages: number }} mesure   temps et cout mesures
 */

module.exports = {};
