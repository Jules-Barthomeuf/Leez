// Parseur Docling (open source, IBM) : mise en page, OCR (RapidOCR) et
// structure des tableaux, en local, via un sous-processus Python
// (docling_run.py). L'interpreteur vient de DOCLING_PYTHON (un venv ou
// `pip install docling` a ete fait). Les modeles sont charges une fois par
// lot de documents : le temps mesure par document exclut ce chargement.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PYTHON = process.env.DOCLING_PYTHON || 'python3';

async function disponible() {
  return new Promise((resolve) => {
    const p = spawn(PYTHON, ['-c', 'import docling, docling.document_converter; print(getattr(docling, "__version__", "ok"))'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    p.stdout.on('data', (d) => { sortie += d; });
    p.on('error', (e) => resolve({ ok: false, raison: `DOCLING_PYTHON introuvable (${PYTHON}) : ${e.message}` }));
    p.on('exit', (code) => resolve(code === 0 ? { ok: true, version: sortie.trim() } : { ok: false, raison: `Docling non installé pour ${PYTHON} : pip install docling, puis DOCLING_PYTHON=<venv>/bin/python` }));
  });
}

/** Lance docling_run.py sur plusieurs fichiers d'un coup. Rend { id: { document, ms, erreur } }. */
async function convertirLot(chemins) {
  const sortie = fs.mkdtempSync(path.join(os.tmpdir(), 'leez-docling-'));
  await new Promise((resolve, reject) => {
    const p = spawn(PYTHON, [path.join(__dirname, 'docling_run.py'), sortie, ...chemins], { stdio: ['ignore', 'inherit', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`docling_run.py a échoué (${code}) : ${err.slice(-2000)}`))));
  });
  const resultats = {};
  for (const chemin of chemins) {
    const id = path.basename(chemin).replace(/\.[^.]+$/, '');
    const timing = JSON.parse(fs.readFileSync(path.join(sortie, `${id}.timing.json`), 'utf8'));
    const fichier = path.join(sortie, `${id}.json`);
    resultats[id] = { ms: timing.ms, erreur: timing.erreur, document: fs.existsSync(fichier) ? JSON.parse(fs.readFileSync(fichier, 'utf8')) : null };
  }
  fs.rmSync(sortie, { recursive: true, force: true });
  return resultats;
}

/** Document Docling (export_to_dict) → pages normalisees. */
function normaliser(document) {
  const tailles = {};
  for (const [n, p] of Object.entries(document.pages || {})) tailles[Number(n)] = p.size || { width: 1, height: 1 };
  const index = { texts: document.texts || [], tables: document.tables || [], groups: document.groups || [], pictures: document.pictures || [] };
  const resoudre = (ref) => { const m = /^#\/(texts|tables|groups|pictures)\/(\d+)$/.exec(ref); return m ? index[m[1]][Number(m[2])] : null; };
  // Ordre de lecture : parcours de l'arbre body (en-tetes et pieds dans furniture, ignores).
  const ordre = [];
  const visiter = (noeud) => {
    for (const enfant of (noeud && noeud.children) || []) {
      const item = resoudre(enfant.$ref);
      if (!item) continue;
      if (item.self_ref.startsWith('#/groups/')) visiter(item);
      else ordre.push(item);
    }
  };
  visiter(document.body);
  const pages = {};
  const pageDe = (n) => {
    if (!pages[n]) pages[n] = { page_number: n, width: (tailles[n] || {}).width || null, height: (tailles[n] || {}).height || null, text: '', blocks: [], ocr: false };
    return pages[n];
  };
  const bboxNorme = (prov, n) => {
    const t = tailles[n];
    if (!prov || !prov.bbox || !t) return null;
    const { l, t: top, r, b } = prov.bbox;
    const bas = prov.bbox.coord_origin === 'BOTTOMLEFT';
    const y0 = bas ? 1 - top / t.height : top / t.height;
    const y1 = bas ? 1 - b / t.height : b / t.height;
    return [Math.max(0, l / t.width), Math.max(0, Math.min(y0, y1)), Math.min(1, r / t.width), Math.min(1, Math.max(y0, y1))];
  };
  for (const item of ordre) {
    const prov = (item.prov || [])[0];
    if (!prov) continue;
    const n = prov.page_no;
    const page = pageDe(n);
    let texte = item.text || '';
    let table;
    let type = 'text';
    if (item.self_ref.startsWith('#/tables/')) {
      type = 'table';
      const grille = ((item.data || {}).grid || []).map((ligne) => ligne.map((c) => (c && c.text) || ''));
      table = { rows: grille, bbox: bboxNorme(prov, n) };
      texte = grille.map((ligne) => ligne.join(' | ')).join('\n');
    } else if (item.self_ref.startsWith('#/pictures/')) {
      type = 'figure';
      texte = '';
    } else if (/section_header|title/.test(item.label || '')) type = 'title';
    if (!texte && type !== 'figure') continue;
    const char_start = page.text.length + (page.text ? 2 : 0);
    page.text += (page.text ? '\n\n' : '') + texte;
    page.blocks.push({ id: `p${n}-b${page.blocks.length + 1}`, type, bbox: bboxNorme(prov, n), char_start, char_end: char_start + texte.length, text: texte, ...(table ? { table } : {}) });
  }
  for (const n of Object.keys(tailles)) pageDe(Number(n));
  return Object.values(pages).sort((a, b) => a.page_number - b.page_number);
}

/**
 * Convertit un fichier. Pour un lot, preferer parseLot (modeles charges une seule fois).
 * @param {{ chemin: string }} entree
 */
async function parse({ chemin }) {
  const r = (await convertirLot([chemin]))[path.basename(chemin).replace(/\.[^.]+$/, '')];
  if (r.erreur || !r.document) throw new Error(r.erreur || 'Docling : pas de sortie');
  const pages = normaliser(r.document);
  return { parser: 'docling', pages, mesure: { ms: r.ms, cout_eur: 0, pages: pages.length } };
}

/** Plusieurs fichiers en un seul sous-processus. Rend { id: ParsedDocument | { erreur } }. */
async function parseLot(chemins) {
  const brut = await convertirLot(chemins);
  const sortie = {};
  for (const [id, r] of Object.entries(brut)) {
    if (r.erreur || !r.document) { sortie[id] = { erreur: r.erreur || 'Docling : pas de sortie' }; continue; }
    const pages = normaliser(r.document);
    sortie[id] = { parser: 'docling', pages, mesure: { ms: r.ms, cout_eur: 0, pages: pages.length } };
  }
  return sortie;
}

module.exports = { nom: 'docling', description: 'Docling (IBM, open source) : mise en page, OCR RapidOCR fr, tableaux structurés, en local via Python', parse, parseLot, disponible, normaliser };
