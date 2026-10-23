const test = require('node:test');
const assert = require('node:assert');
const N = require('./notation');

test('normalisation : espaces insecables, apostrophes, tirets, casse, cesures', () => {
  assert.equal(N.normaliser('Loyer annuel de 84 000 € – HT\nHC'), 'loyer annuel de 84 000 € - ht hc');
  assert.equal(N.normaliser('l’indice « ILC »'), 'l\'indice " ilc "');
  assert.equal(N.normaliser('le loca-\ntaire'), 'le locataire');
  const { texte, carte } = N.normaliserAvecCarte('AB   cd\nE');
  assert.equal(texte, 'ab cd e');
  assert.deepEqual(carte, [0, 1, 2, 5, 6, 7, 8]);
});

test('recherche : exacte, approchee au seuil 0,90, absente', () => {
  const page = N.normaliser('Le présent bail est consenti et accepté moyennant un loyer annuel de 84 000 € (quatre-vingt-quatre mille euros) hors taxes et hors charges, que le Preneur s\'oblige à payer.');
  const exact = N.chercher(N.normaliser('loyer annuel de 84 000 € (quatre-vingt-quatre mille euros) hors taxes et hors charges'), page);
  assert.equal(exact.score, 1);
  // Deux fautes d'OCR sur 85 caracteres : au-dessus de 0,90.
  const ocr = N.chercher(N.normaliser('loyer annuel de 84 000 € (quatre-vingt-quatre mille euros) hors taxes et hors charges'), page.replace('quatre-vingt', 'qnatre-vlngt'));
  assert.ok(ocr && ocr.score >= 0.9, JSON.stringify(ocr));
  assert.equal(N.chercher(N.normaliser('dépôt de garantie de 21 000 €'), page), null);
  const court = N.chercher('640', N.normaliser('RDC + 1er Altitude Conseil Conseil 640 262 880 €'));
  assert.equal(court.score, 1);
});

test('distances : CER et WER', () => {
  assert.equal(N.levenshtein('bail', 'bai1'), 1);
  assert.equal(N.levenshteinTableaux(['a', 'b', 'c'], ['a', 'c']), 1);
});

test('noterDocument : citations, pages, coordonnees, tableaux', () => {
  const attendu = {
    id: 'X', doc_type: 'teaser', nombre_pages: 2,
    champs: {
      prix: { valeur: '5450000.00', type: 'montant', citation: '5 450 000 € acte en main', page: 1 },
      mandataire: { valeur: 'Agence', type: 'texte', citation: 'Provence Retail Advisory', page: 2 },
      absent: { valeur: null, absent: true },
    },
    lignes: [{ lot: { valeur: 'A', type: 'texte', citation: 'A', page: 1 }, locataire: { valeur: 'Brico Sud', type: 'texte', citation: 'Brico Sud Distribution', page: 1 }, loyer: { valeur: '185000.00', type: 'montant', citation: '185 000 €', page: 1 } }],
  };
  const parsed = { parser: 'x', pages: [
    { page_number: 1, width: 100, height: 100, ocr: false, text: 'Prix 5 450 000 € acte en main\n\nA | Brico Sud Distribution | 185 000 €', blocks: [
      { id: 'b1', type: 'text', bbox: [0.1, 0.1, 0.5, 0.15], char_start: 0, char_end: 29, text: 'Prix 5 450 000 € acte en main' },
      { id: 't1', type: 'table', bbox: [0.1, 0.3, 0.9, 0.5], char_start: 31, char_end: 70, text: 'A | Brico Sud Distribution | 185 000 €', table: { rows: [['A', 'Brico Sud Distribution', '185 000 €']] } },
    ] },
    { page_number: 2, width: 100, height: 100, ocr: false, text: 'Contact : Provence Retail Advisory', blocks: [{ id: 'b2', type: 'text', bbox: null, char_start: 0, char_end: 34, text: 'Contact : Provence Retail Advisory' }] },
  ], mesure: { ms: 10, cout_eur: 0, pages: 2 } };
  const reference = { pages: [{ page_number: 1, text: 'Prix 5 450 000 € acte en main', blocks: [{ id: 'r', type: 'text', bbox: [0.1, 0.1, 0.5, 0.15], char_start: 0, char_end: 29, text: 'Prix 5 450 000 € acte en main' }] }, { page_number: 2, text: '', blocks: [] }] };
  const n = N.noterDocument(attendu, parsed, { referenceNatif: reference, texteNatif: { pages: [{ page: 1, texte: 'Prix 5 450 000 € acte en main\nA Brico Sud Distribution 185 000 €' }] } });
  assert.equal(n.resume.citations, 5);
  assert.equal(n.resume.bonne_page, 5);
  const prix = n.citations.find((c) => c.cle === 'prix');
  assert.equal(prix.coordonnees.correcte, true);
  assert.equal(n.citations.find((c) => c.cle === 'mandataire').coordonnees.presente, false);
  assert.equal(n.tableaux.structure.lignes_completes, 1);
  assert.equal(n.tableaux.texte.cellules_trouvees, 3);
  assert.ok(n.fidelite.cer < 0.2);
  // Mauvaise page.
  const parsed2 = { ...parsed, pages: [parsed.pages[1], { ...parsed.pages[0], page_number: 2 }].map((p, i) => ({ ...p, page_number: i + 1 })) };
  const n2 = N.noterDocument(attendu, parsed2);
  assert.equal(n2.citations.find((c) => c.cle === 'prix').statut, 'autre_page');
});

test('noterExcel et noterEmail', () => {
  const attendu = { champs: { total: { valeur: '380400.00', type: 'montant', cellule: 'F!E10' }, date: { valeur: '2026-09-30', type: 'date', cellule: 'F!A3' } }, lignes: [{ tf: { valeur: true, type: 'booleen', cellule: 'F!J6' } }] };
  const parsed = { pages: [{ blocks: [{ id: 'F!E10', text: '380400' }, { id: 'F!A3', text: '2026-09-30' }, { id: 'F!J6', text: 'Oui' }] }] };
  assert.equal(N.noterExcel(attendu, parsed).resume.corrects, 3);
  const mail = N.noterEmail({ champs: { prix: { valeur: '980000.00', citation: 'Prix : 980 000 €', partie: 'text/plain' } } }, { pages: [{ text: 'Bonjour,\nPrix : 980 000 € net vendeur' }] });
  assert.equal(mail.resume.trouvees, 1);
});
