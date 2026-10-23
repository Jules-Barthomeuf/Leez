// Parseur Azure AI Document Intelligence, modele prebuilt-layout (texte, lignes
// avec polygones, paragraphes, tableaux avec cellules). Ressource a creer dans
// une region UE (France Central ou West Europe). Cles : AZURE_DI_ENDPOINT,
// AZURE_DI_KEY. Cout : pages × AZURE_DI_PRIX_USD_1000_PAGES (en configuration).
const { prixEnEuros } = require('./couts');

const ENDPOINT = (process.env.AZURE_DI_ENDPOINT || '').replace(/\/$/, '');
const CLE = process.env.AZURE_DI_KEY;
const VERSION = process.env.AZURE_DI_API_VERSION || '2024-11-30';

async function disponible() {
  const manque = [!ENDPOINT && 'AZURE_DI_ENDPOINT', !CLE && 'AZURE_DI_KEY'].filter(Boolean);
  if (manque.length) return { ok: false, raison: `clé manquante : ${manque.join(', ')}` };
  return { ok: true };
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polygone Azure [x1,y1,x2,y2,...] (unite de la page) → boite normalisee. */
function boite(polygone, page) {
  if (!polygone || !page.width || !page.height) return null;
  const xs = polygone.filter((_, i) => i % 2 === 0);
  const ys = polygone.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs) / page.width, Math.min(...ys) / page.height, Math.max(...xs) / page.width, Math.max(...ys) / page.height];
}

function normaliser(resultat) {
  const pagesAzure = resultat.pages || [];
  const paragraphes = resultat.paragraphs || [];
  const tables = resultat.tables || [];
  const contenu = resultat.content || '';
  const pages = pagesAzure.map((p) => ({ page_number: p.pageNumber, width: p.width || null, height: p.height || null, text: '', blocks: [], ocr: true, unite: p.unit, angle: p.angle }));
  const parNumero = Object.fromEntries(pages.map((p) => [p.page_number, p]));
  const pageAzure = Object.fromEntries(pagesAzure.map((p) => [p.pageNumber, p]));
  // Paragraphes dans l'ordre de lecture d'Azure ; les cellules de tableaux sont ajoutees en bloc table.
  for (const para of paragraphes) {
    const region = (para.boundingRegions || [])[0];
    if (!region) continue;
    const page = parNumero[region.pageNumber];
    if (!page) continue;
    const t = (para.content || '').trim();
    if (!t) continue;
    const char_start = page.text.length + (page.text ? 2 : 0);
    page.text += (page.text ? '\n\n' : '') + t;
    page.blocks.push({ id: `p${page.page_number}-b${page.blocks.length + 1}`, type: /title|sectionHeading/i.test(para.role || '') ? 'title' : 'text', bbox: boite(region.polygon, pageAzure[region.pageNumber]), char_start, char_end: char_start + t.length, text: t });
  }
  for (const t of tables) {
    const region = (t.boundingRegions || [])[0];
    const page = region && parNumero[region.pageNumber];
    if (!page) continue;
    const rows = Array.from({ length: t.rowCount }, () => Array.from({ length: t.columnCount }, () => ''));
    for (const c of t.cells || []) { const r = rows[c.rowIndex]; if (r) r[c.columnIndex] = (c.content || '').trim(); }
    const texte = rows.map((r) => r.join(' | ')).join('\n');
    page.blocks.push({ id: `p${page.page_number}-t${page.blocks.length + 1}`, type: 'table', bbox: boite(region.polygon, pageAzure[region.pageNumber]), char_start: 0, char_end: 0, text: texte, table: { rows } });
  }
  // Pages sans paragraphes (rare) : texte des lignes.
  for (const p of pagesAzure) {
    const page = parNumero[p.pageNumber];
    if (!page.text && p.lines && p.lines.length) {
      page.text = p.lines.map((l) => l.content).join('\n');
      page.blocks.push({ id: `p${page.page_number}-b1`, type: 'text', bbox: null, char_start: 0, char_end: page.text.length, text: page.text });
    }
  }
  void contenu;
  return pages;
}

/**
 * @param {{ buffer: Buffer }} entree
 */
async function parse({ buffer }) {
  if (!ENDPOINT || !CLE) throw new Error('AZURE_DI_ENDPOINT / AZURE_DI_KEY absentes');
  const debut = Date.now();
  const url = `${ENDPOINT}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=${VERSION}`;
  const r = await fetch(url, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': CLE, 'content-type': 'application/json' }, body: JSON.stringify({ base64Source: buffer.toString('base64') }) });
  if (r.status !== 202) throw new Error(`Azure DI ${r.status} : ${(await r.text()).slice(0, 500)}`);
  const operation = r.headers.get('operation-location');
  if (!operation) throw new Error('Azure DI : pas d\'Operation-Location');
  let resultat = null;
  for (let i = 0; i < 120; i++) {
    await dormir(1500);
    const s = await fetch(operation, { headers: { 'Ocp-Apim-Subscription-Key': CLE } });
    const j = await s.json();
    if (j.status === 'succeeded') { resultat = j.analyzeResult; break; }
    if (j.status === 'failed') throw new Error(`Azure DI : analyse échouée ${JSON.stringify(j.error || j).slice(0, 500)}`);
  }
  if (!resultat) throw new Error('Azure DI : délai dépassé');
  const pages = normaliser(resultat);
  return { parser: 'azure', pages, mesure: { ms: Date.now() - debut, cout_eur: prixEnEuros('AZURE_DI_PRIX_USD_1000_PAGES', pages.length / 1000), pages: pages.length, modele: `prebuilt-layout ${VERSION}` } };
}

module.exports = { nom: 'azure', description: `Azure AI Document Intelligence, prebuilt-layout (${VERSION}), région UE à choisir à la création de la ressource`, parse, disponible, normaliser };
