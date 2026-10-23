// packages/core : les formats de donnees de la plateforme (docs/SPEC.md, section 3)
// en schemas Zod, plus les constantes partagees (etapes, statuts, cles
// canoniques, types de fichiers). Aucune I/O ici : ce module se charge aussi
// bien dans le serveur que dans un test isole.
const { z } = require('zod');

// ---------- 3.1 Types de valeurs ----------
// Les montants et nombres sont des chaines decimales, jamais des flottants.
const DECIMALE = /^-?\d+(\.\d+)?$/;
const Decimale = z.string().regex(DECIMALE, 'nombre décimal en chaîne attendu (ex. "118500" ou "0.062")');
const DateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO attendue (AAAA-MM-JJ)');

const VALEURS = {
  money: z.strictObject({
    amount: Decimale,
    currency: z.string().default('EUR'),
    period: z.enum(['month', 'quarter', 'year']),
    tax: z.enum(['HT', 'TTC']).nullable().default(null),
    charges: z.enum(['HC', 'CC']).nullable().default(null),
  }),
  number: z.strictObject({ value: Decimale }),
  percent: z.strictObject({ value: Decimale }), // fraction : 0.062 pour 6,2 %
  surface: z.strictObject({ value: Decimale, kind: z.enum(['utile', 'ponderee', 'vente', 'inconnue']).default('inconnue') }),
  date: z.strictObject({ value: DateIso }),
  duration: z.strictObject({ years: z.number().int().min(0), months: z.number().int().min(0).max(11).default(0) }),
  index_ref: z.strictObject({ index: z.enum(['ILC', 'ILAT', 'ICC', 'IRL']), year: z.number().int().min(1950).max(2100), quarter: z.number().int().min(1).max(4) }),
  boolean: z.strictObject({ value: z.boolean() }),
  enum: z.strictObject({ value: z.string().min(1) }),
  text: z.strictObject({ value: z.string() }),
  address: z.strictObject({ line: z.string(), postcode: z.string(), city: z.string(), insee_code: z.string().optional() }),
};
const VALUE_TYPES = Object.keys(VALEURS);

/** Le schema Zod de la valeur d'un type donne (ex. 'money'). */
function schemaValeur(type) {
  const s = VALEURS[type];
  if (!s) throw new Error(`Type de valeur inconnu : ${type}`);
  return s;
}

// ---------- 3.2 Template d'extraction ----------
const CleChamp = z.string().regex(/^[a-z][a-z0-9_]*$/, 'clé en minuscules, chiffres et tirets bas');
const ChampTemplate = z.strictObject({
  key: CleChamp,
  label: z.string().min(1),
  value_type: z.enum(VALUE_TYPES),
  required: z.boolean().default(false),
  instructions: z.string().default(''),
  enum_values: z.array(z.string().min(1)).nullable().default(null),
  normalizer: z.string().nullable().default(null),
  deal_fact_key: CleChamp.nullable().default(null),
  examples: z.array(z.strictObject({ text: z.string(), value: z.unknown() })).default([]),
  active: z.boolean().default(true),
});
const TemplateExtraction = z.strictObject({
  doc_type: CleChamp,
  label: z.string().min(1),
  classification_hints: z.array(z.string()).default([]),
  multiplicity: z.enum(['one', 'rows']).default('one'),
  row_key_field: CleChamp.nullable().default(null),
  fields: z.array(ChampTemplate).min(1),
}).superRefine((t, ctx) => {
  const cles = new Set();
  t.fields.forEach((f, i) => {
    if (cles.has(f.key)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'key'], message: `clé en double : ${f.key}` });
    cles.add(f.key);
    if (f.value_type === 'enum' && !(f.enum_values && f.enum_values.length)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'enum_values'], message: 'un champ enum doit lister ses valeurs' });
  });
  if (t.multiplicity === 'rows' && !(t.row_key_field && cles.has(t.row_key_field))) ctx.addIssue({ code: 'custom', path: ['row_key_field'], message: 'en multiplicité rows, row_key_field doit désigner un champ du template' });
});

// ---------- 3.3 Contrat de sortie de l'extraction ----------
const ChampExtrait = z.strictObject({
  value: z.unknown().nullable(),
  raw_text: z.string().nullable(),
  quote: z.string().max(300).nullable(),
  page: z.number().int().positive().nullable(),
  confidence: z.number().min(0).max(1),
  note: z.string().optional(),
});
const SortieExtraction = z.strictObject({
  rows: z.array(z.strictObject({ row_key: z.string().nullable(), fields: z.record(z.string(), ChampExtrait) })),
});
/** La sortie attendue pour UN template : exactement ses champs, rien d'autre. Sert a generer le schema de l'outil du modele. */
function schemaSortiePour(template) {
  const champs = Object.fromEntries(template.fields.filter((f) => f.active !== false).map((f) => [f.key, ChampExtrait]));
  return z.strictObject({ rows: z.array(z.strictObject({ row_key: z.string().nullable(), fields: z.strictObject(champs) })) });
}

// ---------- 3.4 Criteres ----------
const SeveriteCritere = z.enum(['eliminatory', 'warning']);
const baseRegle = { id: CleChamp, label: z.string().min(1), severity: SeveriteCritere, fact: CleChamp.optional(), metric: CleChamp.optional() };
const RegleCritere = z.discriminatedUnion('type', [
  z.strictObject({ ...baseRegle, type: z.literal('compare'), op: z.enum(['>=', '<=', '>', '<', '==', '!=']), value: Decimale }),
  z.strictObject({ ...baseRegle, type: z.literal('range'), min: Decimale.optional(), max: Decimale.optional() }),
  z.strictObject({ ...baseRegle, type: z.literal('in'), values: z.array(z.string()).min(1) }),
  z.strictObject({ ...baseRegle, type: z.literal('not_in'), values: z.array(z.string()).min(1) }),
  z.strictObject({ ...baseRegle, type: z.literal('equals'), value: z.union([z.string(), z.boolean()]) }),
  z.strictObject({ ...baseRegle, type: z.literal('exists') }),
]).superRefine((r, ctx) => {
  if (!!r.fact === !!r.metric) ctx.addIssue({ code: 'custom', path: ['fact'], message: 'une règle porte soit fact, soit metric' });
  if (r.type === 'range' && r.min == null && r.max == null) ctx.addIssue({ code: 'custom', path: ['min'], message: 'range : min ou max requis' });
});
const JeuDeCriteres = z.strictObject({ rules: z.array(RegleCritere) }).superRefine((j, ctx) => {
  const ids = new Set();
  j.rules.forEach((r, i) => { if (ids.has(r.id)) ctx.addIssue({ code: 'custom', path: ['rules', i, 'id'], message: `id en double : ${r.id}` }); ids.add(r.id); });
});

// ---------- 3.5 Regle de recoupement ----------
const Cote = z.union([
  z.strictObject({ fact: CleChamp }),
  z.strictObject({ metric: CleChamp }),
  z.strictObject({ doc_types: z.array(CleChamp).min(1) }),
  z.strictObject({ fact: CleChamp, doc_type: CleChamp }), // la valeur d'un type de document precis (ex. le loyer du teaser)
]);
const RegleRecoupement = z.strictObject({
  key: CleChamp,
  label: z.string().min(1),
  left: Cote,
  right: Cote,
  compare: z.enum(['relative_diff', 'abs_diff', 'equals', 'date_diff_days', 'required_doc_types', 'presence', 'membership']),
  tolerance: Decimale.optional(),
  severity: z.enum(['info', 'warning', 'critical']),
  message: z.string().min(1),
  impact_metric: CleChamp.optional(),
});

// ---------- 3.6 Catalogue des cles canoniques ----------
const CLES_CANONIQUES = {
  bien: ['adresse', 'commune_insee', 'surface_utile', 'surface_ponderee', 'nombre_lots', 'occupation', 'destination'],
  prix: ['prix_fai', 'honoraires_montant', 'honoraires_charge', 'prix_net_vendeur', 'rendement_annonce'],
  locataire: ['locataire_raison_sociale', 'locataire_siren', 'enseigne', 'activite', 'activite_categorie'],
  bail: ['date_signature_bail', 'date_effet_bail', 'duree_bail', 'date_fin_bail', 'renonciation_triennale', 'loyer_contractuel_initial', 'loyer_contractuel_actuel', 'indice_indexation', 'indice_reference', 'periodicite_indexation', 'clause_echelle_mobile', 'depot_garantie', 'garantie_premiere_demande', 'caution', 'droit_preference_preneur', 'cession_bail_conditions', 'clause_resolutoire'],
  charges: ['taxe_fonciere_annuelle', 'taxe_fonciere_refacturee', 'charges_refacturees', 'travaux_606_bailleur', 'inventaire_charges_annexe', 'tva_loyer'],
  encaissements: ['loyer_quitte_annualise', 'date_derniere_quittance', 'impayes_mentionnes'],
  copropriete: ['tantiemes_lot', 'travaux_votes', 'procedures_en_cours', 'charges_copro_annuelles'],
  technique: ['dpe_classe_energie', 'dpe_classe_ges', 'dpe_date'],
  marche: ['loyer_m2_marche', 'taux_vacance_commerciale'],
};
const TOUTES_LES_CLES = Object.values(CLES_CANONIQUES).flat();

// ---------- Constantes du modele ----------
const ETAPES = ['reception', 'pre_analysis', 'data_room', 'analysis', 'committee', 'decision', 'closed'];
const ETAPES_LIBELLES = { reception: 'Réception', pre_analysis: 'Pré-analyse', data_room: 'Data room', analysis: 'Analyse', committee: 'Comité', decision: 'Décision', closed: 'Clos' };
// Seuls vocabulaires de conformite (principe 10). `pending` = pas encore evaluee.
const CONFORMITES = ['conforme', 'a_discuter', 'incomplet', 'non_conforme', 'pending'];
const CONFORMITES_LIBELLES = { conforme: 'Conforme', a_discuter: 'À discuter', incomplet: 'Incomplet', non_conforme: 'Non conforme', pending: '—' };
const SOURCES_DEAL = ['upload', 'email', 'data_room_link'];
const STATUTS_DOCUMENT = ['uploaded', 'parsing', 'parsed', 'classified', 'indexed', 'extracting', 'extracted', 'failed', 'duplicate'];
const STATUTS_DOCUMENT_LIBELLES = { uploaded: 'Reçu', parsing: 'Lecture', parsed: 'Lu', classified: 'Classé', indexed: 'Indexé', extracting: 'Extraction', extracted: 'Extrait', failed: 'Échec', duplicate: 'Doublon' };
const STATUTS_FAIT = ['verified', 'unverified', 'human', 'conflict', 'public_data'];
const DOC_TYPES = ['teaser', 'bail_commercial', 'avenant_bail', 'quittance', 'etat_locatif', 'taxe_fonciere', 'pv_ag_copropriete', 'reglement_copropriete', 'dpe', 'kbis', 'email', 'a_classer'];
const ROLES = ['owner', 'admin', 'analyst', 'viewer'];
const CATEGORIES_ACTIVITE = ['alimentaire', 'restauration', 'restauration_rapide', 'etablissement_nuit', 'sante_beaute', 'optique', 'pharmacie', 'equipement_personne', 'equipement_maison', 'services', 'banque_assurance', 'bureaux', 'professions_liberales', 'loisirs', 'autre'];
const MOTIFS_DECISION = ['rendement_insuffisant', 'prix_trop_eleve', 'emplacement', 'locataire_fragile', 'bail_defavorable', 'copropriete', 'technique', 'vacance', 'hors_criteres', 'autre'];
const ISSUES_DECISION = ['pursue', 'offer', 'on_hold', 'pass'];

// Liste blanche des fichiers acceptes (section 4, job document.ingest), par extension : le type
// annonce par le navigateur n'est pas fiable, l'extension decide et fixe le MIME enregistre.
const TYPES_FICHIERS = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  eml: 'message/rfc822',
  msg: 'application/vnd.ms-outlook',
  zip: 'application/zip',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};
/** { extension, mime } d'un nom de fichier accepte, sinon null. */
function typeDeFichier(nom) {
  const m = /\.([a-z0-9]+)$/i.exec(String(nom || ''));
  const ext = m ? m[1].toLowerCase() : '';
  return TYPES_FICHIERS[ext] ? { extension: ext, mime: TYPES_FICHIERS[ext] } : null;
}
const LIMITES = { taille_fichier: 100 * 1024 * 1024, pages_par_document: 600, documents_par_deal: 2000 };

// Reglages par defaut d'une organisation (sections 7, 9 et 19).
const DOCUMENTS_DEMANDES_DEFAUT = [
  { key: 'bail_et_avenants', label: 'Bail et avenants', doc_types: ['bail_commercial', 'avenant_bail'] },
  { key: 'taxe_fonciere_3_ans', label: 'Trois derniers avis de taxe foncière', doc_types: ['taxe_fonciere'] },
  { key: 'quittances_12_mois', label: 'Quittances ou avis d\'échéance des 12 derniers mois', doc_types: ['quittance'] },
  { key: 'reglement_copropriete', label: 'Règlement de copropriété', doc_types: ['reglement_copropriete'] },
  { key: 'pv_ag_3', label: 'Trois derniers PV d\'AG', doc_types: ['pv_ag_copropriete'] },
  { key: 'dpe', label: 'DPE', doc_types: ['dpe'] },
  { key: 'kbis', label: 'Kbis du locataire', doc_types: ['kbis'] },
  { key: 'etat_locatif', label: 'État locatif (si multi-lots)', doc_types: ['etat_locatif'], si_multi_lots: true },
];
const REGLAGES_DEFAUT = {
  acquisition_fee_rate: '0.075',
  requested_docs: DOCUMENTS_DEMANDES_DEFAUT,
  stages: ETAPES.filter((e) => e !== 'closed'),
  monthly_llm_budget_eur: null,
  decision_reason_codes: MOTIFS_DECISION,
};
const ReglagesOrganisation = z.strictObject({
  acquisition_fee_rate: Decimale.optional(),
  requested_docs: z.array(z.strictObject({ key: CleChamp, label: z.string().min(1), doc_types: z.array(CleChamp).min(1), si_multi_lots: z.boolean().optional() })).optional(),
  stages: z.array(z.enum(ETAPES)).optional(),
  monthly_llm_budget_eur: Decimale.nullable().optional(),
  decision_reason_codes: z.array(CleChamp).min(1).optional(),
});

// ---------- Validation ----------
class ErreurValidation extends Error {
  constructor(issues) {
    const detail = issues.map((i) => `${i.path && i.path.length ? i.path.join('.') + ' : ' : ''}${i.message}`).join(' ; ');
    super(detail || 'Données invalides.');
    this.code = 'validation';
    this.status = 400;
    this.issues = issues;
  }
}
/** Rend la valeur validee (avec les valeurs par defaut), ou leve ErreurValidation. */
function valider(schema, donnees) {
  const r = schema.safeParse(donnees);
  if (!r.success) throw new ErreurValidation(r.error.issues);
  return r.data;
}

module.exports = {
  z, Decimale, DateIso, VALEURS, VALUE_TYPES, schemaValeur,
  ChampTemplate, TemplateExtraction, ChampExtrait, SortieExtraction, schemaSortiePour,
  RegleCritere, JeuDeCriteres, RegleRecoupement,
  CLES_CANONIQUES, TOUTES_LES_CLES,
  ETAPES, ETAPES_LIBELLES, CONFORMITES, CONFORMITES_LIBELLES, SOURCES_DEAL, STATUTS_DOCUMENT, STATUTS_DOCUMENT_LIBELLES,
  STATUTS_FAIT, DOC_TYPES, ROLES, CATEGORIES_ACTIVITE, MOTIFS_DECISION, ISSUES_DECISION,
  TYPES_FICHIERS, typeDeFichier, LIMITES, REGLAGES_DEFAUT, DOCUMENTS_DEMANDES_DEFAUT, ReglagesOrganisation,
  ErreurValidation, valider,
};
