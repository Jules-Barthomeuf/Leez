// Tests des parseurs et lecteurs qui ne demandent ni cle ni Python : pdfjs sur
// un PDF natif du jeu, lecteur Excel (formules), lecteur mail, normalisation des
// sorties Docling / Azure depuis des structures minimales.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('./index');

const JEU = path.join(__dirname, '..', '..', 'eval', 'fixtures', 'benchmark-v1', 'documents');
const jeuPresent = fs.existsSync(path.join(JEU, 'B01_bail_lyon_optique.pdf'));

test('pdfjs : texte natif, blocs avec coordonnees normalisees, pages sans couche texte', { skip: !jeuPresent && 'jeu benchmark-v1 absent' }, async () => {
  const d = await P.parseur('pdfjs').parse({ buffer: fs.readFileSync(path.join(JEU, 'B01_bail_lyon_optique.pdf')) });
  assert.equal(d.parser, 'pdfjs');
  assert.equal(d.pages.length, 3);
  assert.match(d.pages[1].text, /84 000 €/);
  const b = d.pages[0].blocks[0];
  assert.ok(b.bbox.every((v) => v >= 0 && v <= 1));
  assert.equal(d.pages[0].text.slice(b.char_start, b.char_end), b.text);
  const couches = await P.couchesTexte(fs.readFileSync(path.join(JEU, 'B04_bail_toulouse_avec_avenants_1-2.pdf')));
  assert.equal(couches[3].caracteres, 0, 'la page 4 (avenant scanné) n\'a pas de couche texte');
  assert.ok(couches[0].caracteres > 1000);
});

test('excel : une cellule par bloc, formules SUM evaluees', { skip: !jeuPresent && 'jeu benchmark-v1 absent' }, async () => {
  const d = await P.lecteurPour('x.xlsx').parse({ buffer: fs.readFileSync(path.join(JEU, 'E01_etat_locatif_marseille.xlsx')) });
  const bloc = (id) => d.pages[0].blocks.find((b) => b.id === id);
  assert.equal(bloc('Etat locatif!D10').text, '4050');
  assert.equal(bloc('Etat locatif!E10').text, '380400');
  assert.equal(bloc('Etat locatif!F6').text, '2022-01-01');
  assert.equal(d.pages.length, 2);
  const { evaluerFormule } = require('./excel');
  assert.equal(evaluerFormule('=SUM(A1:A3)+B1*2', (c, r) => ({ '1,1': 1, '1,2': 2, '1,3': 3, '2,1': 10 })[`${c},${r}`]), 26);
});

test('email : corps text/plain en page 1', { skip: !jeuPresent && 'jeu benchmark-v1 absent' }, async () => {
  const d = await P.lecteurPour('x.eml').parse({ buffer: fs.readFileSync(path.join(JEU, 'T03_teaser_bordeaux_email.eml')) });
  assert.equal(d.pages[0].partie, 'text/plain');
  assert.match(d.pages[0].text, /Pharmacie du Port de la Lune/);
});

test('docling : normalisation d\'un document minimal', () => {
  const { normaliser } = require('./docling');
  const doc = {
    body: { children: [{ $ref: '#/texts/0' }, { $ref: '#/tables/0' }] },
    pages: { 1: { size: { width: 100, height: 200 } } },
    texts: [{ self_ref: '#/texts/0', label: 'section_header', text: 'Titre', prov: [{ page_no: 1, bbox: { l: 10, t: 190, r: 50, b: 180, coord_origin: 'BOTTOMLEFT' } }] }],
    tables: [{ self_ref: '#/tables/0', prov: [{ page_no: 1, bbox: { l: 0, t: 100, r: 100, b: 50, coord_origin: 'BOTTOMLEFT' } }], data: { grid: [[{ text: 'a' }, { text: 'b' }]] } }],
  };
  const pages = normaliser(doc);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].blocks[0].type, 'title');
  pages[0].blocks[0].bbox.forEach((v, i) => assert.ok(Math.abs(v - [0.1, 0.05, 0.5, 0.1][i]) < 1e-9, `bbox[${i}] = ${v}`));
  assert.deepEqual(pages[0].blocks[1].table.rows, [['a', 'b']]);
  assert.equal(pages[0].text, 'Titre\n\na | b');
});

test('azure : normalisation d\'un resultat minimal', () => {
  const { normaliser } = require('./azure');
  const pages = normaliser({ pages: [{ pageNumber: 1, width: 8.5, height: 11, unit: 'inch', lines: [] }], paragraphs: [{ content: 'Bonjour', role: 'title', boundingRegions: [{ pageNumber: 1, polygon: [1, 1, 4, 1, 4, 2, 1, 2] }] }], tables: [{ rowCount: 1, columnCount: 2, boundingRegions: [{ pageNumber: 1, polygon: [0, 0, 8.5, 0, 8.5, 11, 0, 11] }], cells: [{ rowIndex: 0, columnIndex: 0, content: 'x' }, { rowIndex: 0, columnIndex: 1, content: 'y' }] }] });
  assert.equal(pages[0].blocks[0].type, 'title');
  assert.ok(Math.abs(pages[0].blocks[0].bbox[0] - 1 / 8.5) < 1e-9);
  assert.deepEqual(pages[0].blocks[1].table.rows, [['x', 'y']]);
});

test('claude : decoupage des pages transcrites ; mistral : tableaux markdown', () => {
  const { decouperPages } = require('./claude');
  assert.deepEqual(decouperPages('<page n="1">A</page>\n<page n="2">B\n| x | y |\n|---|---|\n| 1 | 2 |</page>').map((p) => p.numero), [1, 2]);
  const { lignesDeTableauMarkdown } = require('./mistral');
  assert.deepEqual(lignesDeTableauMarkdown('| a | b |\n|---|---|\n| 1 | 2 |'), [['a', 'b'], ['1', '2']]);
});

test('rasteriser (MuPDF) : PNG par page, rotation', { skip: !jeuPresent && 'jeu benchmark-v1 absent' }, async () => {
  const { rasteriser, nombreDePages } = require('./rasteriser');
  const buffer = fs.readFileSync(path.join(JEU, 'T06_teaser_toulouse_scan.pdf'));
  assert.equal(await nombreDePages(buffer), 2);
  const [p2] = await rasteriser(buffer, { dpi: 50, pages: [2] });
  assert.equal(p2.page_number, 2);
  assert.ok(p2.png.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'signature PNG');
  assert.ok(p2.width > p2.height, 'la page 2 est scannée en paysage');
  const [tournee] = await rasteriser(buffer, { dpi: 50, pages: [2], rotation: 90 });
  assert.ok(tournee.height > tournee.width, 'tournée de 90°, elle redevient portrait');
});
