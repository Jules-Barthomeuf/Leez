// Lecteur Excel (ExcelJS) : une feuille = une page, une cellule non vide = un
// bloc dont l'id est l'adresse (« Etat locatif!E6 »), et la feuille entiere en
// bloc table. Les formules sans resultat enregistre (fichiers produits par un
// script) sont evaluees ici pour SUM, les references et l'arithmetique simple.
const ExcelJS = require('exceljs');

function colonneEnIndice(lettres) { let n = 0; for (const c of lettres) n = n * 26 + (c.charCodeAt(0) - 64); return n; }

/** Petit evaluateur de formules : nombres, references, plages dans SUM, + - * /, parentheses. */
function evaluerFormule(formule, lire) {
  let i = 0;
  const s = formule.replace(/^=/, '').replace(/\s+/g, '').toUpperCase();
  const peek = () => s[i];
  const lireRef = () => { const m = /^\$?([A-Z]{1,3})\$?(\d+)/.exec(s.slice(i)); if (!m) return null; i += m[0].length; return { col: m[1], row: Number(m[2]) }; };
  function facteur() {
    if (peek() === '(') { i++; const v = expression(); if (peek() === ')') i++; return v; }
    if (peek() === '-') { i++; return -facteur(); }
    if (s.startsWith('SUM(', i)) {
      i += 4;
      let total = 0;
      while (peek() !== ')' && i < s.length) {
        const a = lireRef();
        if (!a) throw new Error(`Formule non prise en charge : ${formule}`);
        if (peek() === ':') { i++; const b = lireRef(); for (let r = a.row; r <= b.row; r++) for (let c = colonneEnIndice(a.col); c <= colonneEnIndice(b.col); c++) total += Number(lire(c, r)) || 0; }
        else total += Number(lire(colonneEnIndice(a.col), a.row)) || 0;
        if (peek() === ',' || peek() === ';') i++;
      }
      i++;
      return total;
    }
    const num = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (num) { i += num[0].length; return Number(num[0]); }
    const ref = lireRef();
    if (ref) return Number(lire(colonneEnIndice(ref.col), ref.row)) || 0;
    throw new Error(`Formule non prise en charge : ${formule}`);
  }
  function terme() { let v = facteur(); while (peek() === '*' || peek() === '/') { const op = s[i++]; const w = facteur(); v = op === '*' ? v * w : v / w; } return v; }
  function expression() { let v = terme(); while (peek() === '+' || peek() === '-') { const op = s[i++]; const w = terme(); v = op === '+' ? v + w : v - w; } return v; }
  return expression();
}

/** Valeur brute d'une cellule ExcelJS → valeur JS (nombre, chaine, Date, booleen), formules evaluees. */
function valeurDe(cellule, feuille, pile = new Set()) {
  const v = cellule.value;
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) {
      if (v.result != null) return v.result;
      const cle = cellule.address;
      if (pile.has(cle)) return null;
      pile.add(cle);
      try {
        return evaluerFormule(v.formula || '', (c, r) => { const cell = feuille.getRow(r).getCell(c); return valeurDe(cell, feuille, pile); });
      } catch { return null; }
    }
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return v.text;
    if ('error' in v) return null;
  }
  return v;
}

/** Texte d'affichage d'une valeur : dates en ISO, nombres sans separateur, booleens Oui/Non. */
function enTexte(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  return String(v);
}

/**
 * @param {{ buffer: Buffer }} entree
 * @returns {Promise<import('../core/types').ParsedDocument>}
 */
async function parse({ buffer }) {
  const debut = Date.now();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const pages = [];
  wb.eachSheet((feuille, id) => {
    const rows = [];
    const blocks = [];
    let texte = '';
    feuille.eachRow({ includeEmpty: false }, (ligne, numero) => {
      const cellules = [];
      ligne.eachCell({ includeEmpty: false }, (cellule) => {
        const t = enTexte(valeurDe(cellule, feuille));
        if (t === '') return;
        cellules.push(t);
        const char_start = texte.length;
        texte += (texte ? '\n' : '') + t;
        blocks.push({ id: `${feuille.name}!${cellule.address}`, type: 'text', bbox: null, char_start: texte.length - t.length, char_end: texte.length, text: t, cellule: { sheet: feuille.name, address: cellule.address, row: numero } });
        void char_start;
      });
      rows.push(cellules);
    });
    blocks.push({ id: `${feuille.name}!table`, type: 'table', bbox: null, char_start: 0, char_end: 0, text: rows.map((r) => r.join(' | ')).join('\n'), table: { rows } });
    pages.push({ page_number: pages.length + 1, width: null, height: null, text: texte, blocks, ocr: false, feuille: feuille.name, id_feuille: id });
  });
  return { parser: 'excel', pages, mesure: { ms: Date.now() - debut, cout_eur: 0, pages: pages.length } };
}

module.exports = { nom: 'excel', description: 'ExcelJS : une feuille par page, une cellule par bloc, formules SUM évaluées', parse, disponible: async () => ({ ok: true }), evaluerFormule, enTexte };
