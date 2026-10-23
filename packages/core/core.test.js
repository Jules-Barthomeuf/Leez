const test = require('node:test');
const assert = require('node:assert');
const C = require('./index');

test('valeurs : money accepte des chaines decimales, jamais des flottants', () => {
  const v = C.valider(C.schemaValeur('money'), { amount: '118500', period: 'year', tax: 'HT', charges: 'HC' });
  assert.equal(v.currency, 'EUR');
  assert.throws(() => C.valider(C.schemaValeur('money'), { amount: 118500, period: 'year' }), C.ErreurValidation);
  assert.throws(() => C.valider(C.schemaValeur('money'), { amount: '118 500', period: 'year' }), C.ErreurValidation);
  assert.throws(() => C.valider(C.schemaValeur('percent'), { value: '6,2' }), C.ErreurValidation);
  assert.deepEqual(C.valider(C.schemaValeur('index_ref'), { index: 'ILC', year: 2019, quarter: 1 }), { index: 'ILC', year: 2019, quarter: 1 });
  assert.throws(() => C.schemaValeur('inconnu'));
});

test('template : cles uniques, enum avec valeurs, rows avec row_key_field', () => {
  const base = { doc_type: 'bail_commercial', label: 'Bail commercial', fields: [{ key: 'loyer_annuel_initial', label: 'Loyer de base', value_type: 'money', deal_fact_key: 'loyer_contractuel_initial' }] };
  const t = C.valider(C.TemplateExtraction, base);
  assert.equal(t.multiplicity, 'one');
  assert.equal(t.fields[0].required, false);
  assert.throws(() => C.valider(C.TemplateExtraction, { ...base, fields: [base.fields[0], base.fields[0]] }), /clé en double/);
  assert.throws(() => C.valider(C.TemplateExtraction, { ...base, fields: [{ key: 'occupation', label: 'Occupation', value_type: 'enum' }] }), /enum/);
  assert.throws(() => C.valider(C.TemplateExtraction, { ...base, multiplicity: 'rows' }), /row_key_field/);
  const lignes = C.valider(C.TemplateExtraction, { ...base, multiplicity: 'rows', row_key_field: 'lot', fields: [{ key: 'lot', label: 'Lot', value_type: 'text' }] });
  assert.equal(lignes.row_key_field, 'lot');
});

test('sortie d\'extraction : schema genere depuis le template, champs inconnus refuses', () => {
  const t = C.valider(C.TemplateExtraction, { doc_type: 'teaser', label: 'Teaser', fields: [{ key: 'prix', label: 'Prix', value_type: 'money' }] });
  const S = C.schemaSortiePour(t);
  const ok = { rows: [{ row_key: null, fields: { prix: { value: { amount: '1' }, raw_text: '1 €', quote: 'prix 1 €', page: 2, confidence: 0.9 } } }] };
  assert.ok(S.safeParse(ok).success);
  assert.equal(S.safeParse({ rows: [{ row_key: null, fields: { autre: ok.rows[0].fields.prix } }] }).success, false);
  assert.equal(S.safeParse({ rows: [{ row_key: null, fields: { prix: { ...ok.rows[0].fields.prix, quote: 'x'.repeat(301) } } }] }).success, false);
});

test('criteres : fact ou metric, jamais les deux, ids uniques', () => {
  const jeu = { rules: [
    { id: 'rendement_min', label: 'Rendement AEM ≥ 6 %', type: 'compare', metric: 'rendement_aem', op: '>=', value: '0.06', severity: 'eliminatory' },
    { id: 'ticket', label: 'Prix', type: 'range', fact: 'prix_fai', min: '1000000', max: '8000000', severity: 'eliminatory' },
    { id: 'activites_exclues', label: 'Exclues', type: 'not_in', fact: 'activite_categorie', values: ['bureaux'], severity: 'eliminatory' },
    { id: 'occupe', label: 'Occupé', type: 'equals', fact: 'occupation', value: 'occupe', severity: 'warning' },
  ] };
  assert.equal(C.valider(C.JeuDeCriteres, jeu).rules.length, 4);
  assert.throws(() => C.valider(C.JeuDeCriteres, { rules: [{ ...jeu.rules[0], fact: 'prix_fai' }] }), /soit fact, soit metric/);
  assert.throws(() => C.valider(C.JeuDeCriteres, { rules: [jeu.rules[0], jeu.rules[0]] }), /en double/);
  assert.throws(() => C.valider(C.JeuDeCriteres, { rules: [{ id: 'r', label: 'r', type: 'range', fact: 'prix_fai', severity: 'warning' }] }), /min ou max/);
});

test('regle de recoupement', () => {
  const r = C.valider(C.RegleRecoupement, { key: 'loyer_bail_vs_quittances', label: 'Loyer', left: { metric: 'loyer_indexe_theorique' }, right: { fact: 'loyer_quitte_annualise' }, compare: 'relative_diff', tolerance: '0.02', severity: 'warning', message: '{left} vs {right}', impact_metric: 'rendement_aem' });
  assert.equal(r.tolerance, '0.02');
  assert.throws(() => C.valider(C.RegleRecoupement, { ...r, compare: 'autre' }), C.ErreurValidation);
});

test('types de fichiers : l\'extension decide', () => {
  assert.deepEqual(C.typeDeFichier('Bail.PDF'), { extension: 'pdf', mime: 'application/pdf' });
  assert.equal(C.typeDeFichier('virus.exe'), null);
  assert.equal(C.typeDeFichier('sans-extension'), null);
  assert.equal(C.typeDeFichier('mail.eml').mime, 'message/rfc822');
});

test('constantes : conformites et cles canoniques', () => {
  assert.deepEqual(C.CONFORMITES.slice(0, 4), ['conforme', 'a_discuter', 'incomplet', 'non_conforme']);
  assert.ok(C.TOUTES_LES_CLES.includes('loyer_contractuel_actuel'));
  assert.equal(new Set(C.TOUTES_LES_CLES).size, C.TOUTES_LES_CLES.length);
  const reglages = C.valider(C.ReglagesOrganisation, { acquisition_fee_rate: '0.08' });
  assert.equal(reglages.acquisition_fee_rate, '0.08');
  assert.throws(() => C.valider(C.ReglagesOrganisation, { acquisition_fee_rate: 0.08 }), C.ErreurValidation);
});
