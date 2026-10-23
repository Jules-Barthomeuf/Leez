#!/usr/bin/env node
// Benchmark des parseurs (docs/SPEC.md, phase 1 ; protocole : eval/fixtures/benchmark-v1/README.md).
//   npm run bench:parse -- [--parseurs=pdfjs,tesseract,docling,mistral,azure,claude] [--docs=T01,B03] [--force] [--sans-reels]
// Seul le dossier documents/ de chaque jeu est donne aux parseurs ; reference/ et attendu/ servent a noter.
// Les sorties brutes vont dans eval/results/raw/ (hors git) et servent de cache ; --force les ignore.
// Rapport : eval/results/parse-benchmark-<date>.md (+ .json).
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../../packages/parsing');
const N = require('./notation');
const { ecrireRapport } = require('./rapport');

const RACINE = path.join(__dirname, '..');
const RAW = path.join(RACINE, 'results', 'raw');
const CAPTURES = path.join(RACINE, 'results', 'captures');
const TABLEAUX = new Set(['T04', 'T05', 'E02', 'Q01', 'Q02', 'Q03']);

function lireArgs() {
  const args = { parseurs: null, docs: null, force: false, sansReels: false };
  for (const a of process.argv.slice(2)) {
    const [k, v] = a.replace(/^--/, '').split('=');
    if (k === 'parseurs') args.parseurs = v.split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === 'docs') args.docs = new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
    else if (k === 'force') args.force = true;
    else if (k === 'sans-reels') args.sansReels = true;
    else { console.error(`Option inconnue : ${a}`); process.exit(2); }
  }
  return args;
}

const lireJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const ecrireJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); };

/** Un jeu : son manifest (ou, a defaut, ses attendus), les chemins des documents, les references. */
function chargerJeu(nom, dossier) {
  const attendus = fs.existsSync(path.join(dossier, 'attendu')) ? fs.readdirSync(path.join(dossier, 'attendu')).filter((f) => f.endsWith('.json')) : [];
  if (!attendus.length) return null;
  const manifest = fs.existsSync(path.join(dossier, 'manifest.json')) ? lireJson(path.join(dossier, 'manifest.json')) : { documents: [] };
  const parId = Object.fromEntries((manifest.documents || []).map((d) => [d.id, d]));
  const docs = [];
  for (const f of attendus) {
    const attendu = lireJson(path.join(dossier, 'attendu', f));
    const id = attendu.id || f.replace(/\.json$/, '');
    const m = parId[id] || {};
    const fichier = attendu.fichier || m.fichier;
    if (!fichier || !/^documents\//.test(fichier)) { console.warn(`[${nom}] ${id} : fichier absent ou hors de documents/, ignoré`); continue; }
    const chemin = path.join(dossier, fichier);
    if (!fs.existsSync(chemin)) { console.warn(`[${nom}] ${id} : ${fichier} introuvable, ignoré`); continue; }
    const format = m.format || attendu.format || (/\.pdf$/i.test(fichier) ? 'pdf_natif' : /\.xlsx?$/i.test(fichier) ? 'xlsx' : /\.eml$/i.test(fichier) ? 'eml' : 'autre');
    const defauts = m.defauts || [];
    let type = format === 'pdf_mixte' ? 'mixte' : format === 'pdf_scan' ? (defauts.some((d) => /dégrad|degrad|90°|tourn/i.test(d)) || ['B03', 'T06'].includes(id) ? 'scan_degrade' : 'scan_correct') : format === 'pdf_natif' ? 'natif' : format;
    const texteNatif = fs.existsSync(path.join(dossier, 'reference', 'texte_natif', `${id}.json`)) ? lireJson(path.join(dossier, 'reference', 'texte_natif', `${id}.json`)) : null;
    const natifReference = m.natif_reference && fs.existsSync(path.join(dossier, m.natif_reference)) ? path.join(dossier, m.natif_reference) : null;
    docs.push({ jeu: nom, id, fichier, chemin, doc_type: attendu.doc_type || m.doc_type, format, type, tableau: TABLEAUX.has(id) || !!(attendu.lignes && attendu.lignes.length), defauts, attendu, texteNatif, natifReference, pdf: /\.pdf$/i.test(fichier) });
  }
  return { nom, dossier, docs: docs.sort((a, b) => a.id.localeCompare(b.id)) };
}

async function avecCache(fichier, force, calcul) {
  if (!force && fs.existsSync(fichier)) return { ...lireJson(fichier), cache: true };
  const v = await calcul();
  ecrireJson(fichier, v);
  return v;
}

async function main() {
  const args = lireArgs();
  const debutTotal = Date.now();
  const jeux = [];
  const b1 = chargerJeu('benchmark-v1', path.join(RACINE, 'fixtures', 'benchmark-v1'));
  if (b1) jeux.push(b1);
  if (!args.sansReels) { const r = chargerJeu('reels', path.join(RACINE, 'fixtures', 'reels')); if (r) jeux.push(r); }
  if (!jeux.length) { console.error('Aucun jeu : décompressez leez-benchmark-v1.zip dans eval/fixtures/benchmark-v1/'); process.exit(1); }

  const noms = args.parseurs || P.PARSEURS_PDF;
  const parseurs = {};
  for (const nom of noms) {
    const p = P.parseur(nom);
    const dispo = await p.disponible();
    parseurs[nom] = { nom, description: p.description, module: p, statut: dispo.ok ? 'testé' : `non testé, ${dispo.raison}`, ok: dispo.ok, version: dispo.version || null };
    console.log(`[parseur] ${nom} : ${parseurs[nom].statut}`);
  }

  const resultats = { date: new Date().toISOString(), commande: process.argv.slice(2).join(' '), machine: { cpu: os.cpus()[0] && os.cpus()[0].model, coeurs: os.cpus().length, memoire_go: Math.round(os.totalmem() / 1e9), node: process.version, plateforme: `${os.platform()} ${os.arch()}` }, parseurs: {}, jeux: [], lecteurs: { excel: [], email: [] }, prix: prixConfigures() };
  for (const [nom, p] of Object.entries(parseurs)) resultats.parseurs[nom] = { description: p.description, statut: p.statut, ok: p.ok, version: p.version };

  for (const jeu of jeux) {
    const docs = jeu.docs.filter((d) => !args.docs || args.docs.has(d.id));
    const pdfs = docs.filter((d) => d.pdf);
    console.log(`\n[jeu ${jeu.nom}] ${docs.length} document(s), ${pdfs.length} PDF`);
    const parDoc = {};
    for (const d of docs) parDoc[d.id] = { id: d.id, doc_type: d.doc_type, format: d.format, type: d.type, tableau: d.tableau, defauts: d.defauts, pages_attendues: d.attendu.nombre_pages || null, couches_texte: null, parseurs: {} };

    // Couche texte native par page (pdfjs), et references de boites : pdfjs sur le natif (ou le document lui-meme).
    const refs = {};
    for (const d of pdfs) {
      const buffer = fs.readFileSync(d.chemin);
      const pdfjs = await avecCache(path.join(RAW, jeu.nom, 'pdfjs', `${d.id}.json`), args.force, () => P.parseur('pdfjs').parse({ buffer }));
      parDoc[d.id].couches_texte = pdfjs.pages.map((p) => ({ page: p.page_number, caracteres: p.text.replace(/\s/g, '').length }));
      refs[d.id] = d.natifReference
        ? await avecCache(path.join(RAW, jeu.nom, 'reference-natif', `${d.id}.json`), args.force, () => P.parseur('pdfjs').parse({ buffer: fs.readFileSync(d.natifReference) }))
        : pdfjs;
    }

    for (const [nom, p] of Object.entries(parseurs)) {
      if (!p.ok) continue;
      const manquants = pdfs.filter((d) => args.force || !fs.existsSync(path.join(RAW, jeu.nom, nom, `${d.id}.json`)));
      // Docling charge ses modeles une fois : tout le lot en un sous-processus.
      if (nom === 'docling' && manquants.length) {
        console.log(`[docling] ${manquants.length} document(s) à convertir…`);
        try {
          const lot = await p.module.parseLot(manquants.map((d) => d.chemin));
          for (const d of manquants) { const id = path.basename(d.chemin).replace(/\.[^.]+$/, ''); ecrireJson(path.join(RAW, jeu.nom, nom, `${d.id}.json`), lot[id] || { erreur: 'absent du lot' }); }
        } catch (e) {
          for (const d of manquants) ecrireJson(path.join(RAW, jeu.nom, nom, `${d.id}.json`), { erreur: e.message });
        }
      }
      for (const d of pdfs) {
        const fichier = path.join(RAW, jeu.nom, nom, `${d.id}.json`);
        let brut;
        try {
          brut = await avecCache(fichier, args.force && nom !== 'docling', async () => {
            process.stdout.write(`[${nom}] ${d.id}… `);
            const t0 = Date.now();
            const r = await p.module.parse({ buffer: fs.readFileSync(d.chemin), chemin: d.chemin, nom: path.basename(d.chemin) });
            console.log(`${Date.now() - t0} ms`);
            return r;
          });
        } catch (e) {
          brut = { erreur: e.message };
          ecrireJson(fichier, brut);
          console.log(`[${nom}] ${d.id} : ERREUR ${e.message}`);
        }
        if (brut.erreur) { parDoc[d.id].parseurs[nom] = { erreur: brut.erreur }; continue; }
        const note = N.noterDocument(d.attendu, brut, { referenceNatif: refs[d.id], texteNatif: d.texteNatif });
        parDoc[d.id].parseurs[nom] = { ...note, mesure: brut.mesure, cache: !!brut.cache, rotations: brut.pages.map((pg) => pg.rotation).filter((r) => r) };
      }
      if (p.module.fermer) await p.module.fermer();
    }

    // Lecteurs Excel et mail : hors comparaison, mais toutes les valeurs attendues doivent etre retrouvees.
    for (const d of docs.filter((x) => !x.pdf)) {
      const lecteur = P.lecteurPour(d.fichier);
      if (!lecteur) { parDoc[d.id].lecteur = { erreur: 'aucun lecteur pour ce format' }; continue; }
      const brut = await lecteur.parse({ buffer: fs.readFileSync(d.chemin), chemin: d.chemin, nom: path.basename(d.chemin) });
      ecrireJson(path.join(RAW, jeu.nom, lecteur.nom, `${d.id}.json`), brut);
      if (lecteur.nom === 'excel') { const n = N.noterExcel(d.attendu, brut); parDoc[d.id].lecteur = { nom: 'excel', ...n, mesure: brut.mesure }; resultats.lecteurs.excel.push({ jeu: jeu.nom, id: d.id, ...n.resume }); }
      if (lecteur.nom === 'email') {
        const n = N.noterEmail(d.attendu, brut);
        const texte = N.normaliser(brut.pages[0].text);
        const piege = { ancien_prix_present: texte.includes('1 050 000'), prix_attendu_present: texte.includes('980 000') };
        parDoc[d.id].lecteur = { nom: 'email', ...n, piege, mesure: brut.mesure };
        resultats.lecteurs.email.push({ jeu: jeu.nom, id: d.id, ...n.resume, piege });
      }
    }

    resultats.jeux.push({ nom: jeu.nom, documents: Object.values(parDoc), synthese: synthetiser(Object.values(parDoc), Object.keys(parseurs)), robustesse: robustesse(parDoc, Object.keys(parseurs)), sans_solution: await sansSolution(parDoc, docs, parseurs) });
  }
  resultats.duree_ms = Date.now() - debutTotal;
  resultats.projections = projections(resultats);

  const date = new Date().toISOString().slice(0, 10);
  const base = path.join(RACINE, 'results', `parse-benchmark-${date}`);
  ecrireJson(`${base}.json`, resultats);
  fs.writeFileSync(`${base}.md`, ecrireRapport(resultats, { recommandation: lireRecommandation() }));
  console.log(`\nRapport : ${base}.md`);
  console.log(`Données : ${base}.json`);
  afficherResume(resultats);
}

function prixConfigures() {
  const v = (k) => (process.env[k] ? Number(process.env[k]) : null);
  return { USD_EUR: v('USD_EUR'), MISTRAL_OCR_PRIX_USD_1000_PAGES: v('MISTRAL_OCR_PRIX_USD_1000_PAGES'), AZURE_DI_PRIX_USD_1000_PAGES: v('AZURE_DI_PRIX_USD_1000_PAGES'), CLAUDE_PRIX_ENTREE_USD_MTOK: v('CLAUDE_PRIX_ENTREE_USD_MTOK'), CLAUDE_PRIX_SORTIE_USD_MTOK: v('CLAUDE_PRIX_SORTIE_USD_MTOK'), CLAUDE_PARSE_MODEL: process.env.CLAUDE_PARSE_MODEL || 'claude-sonnet-5-5' };
}

/** Moyennes ponderees par type de document (natif, scan correct, scan degrade, mixte, tableau) et par parseur. */
function synthetiser(documents, noms) {
  const groupes = { tous: (d) => d.format && d.format.startsWith('pdf'), natif: (d) => d.type === 'natif', scan_correct: (d) => d.type === 'scan_correct', scan_degrade: (d) => d.type === 'scan_degrade', mixte: (d) => d.type === 'mixte', tableau: (d) => d.tableau && d.format.startsWith('pdf') };
  const sortie = {};
  for (const [groupe, filtre] of Object.entries(groupes)) {
    sortie[groupe] = { documents: documents.filter(filtre).map((d) => d.id), parseurs: {} };
    for (const nom of noms) {
      const notes = documents.filter(filtre).map((d) => d.parseurs[nom]).filter((n) => n && !n.erreur);
      const erreurs = documents.filter(filtre).map((d) => d.parseurs[nom]).filter((n) => n && n.erreur).length;
      const somme = (f) => notes.reduce((s, n) => s + (f(n) || 0), 0);
      const cit = somme((n) => n.resume.citations);
      const pages = somme((n) => n.mesure.pages);
      const avecCer = notes.filter((n) => n.resume.cer != null);
      const carRef = avecCer.reduce((s, n) => s + n.fidelite.pages.reduce((t, p) => t + p.caracteres_reference, 0), 0);
      const coordP = notes.flatMap((n) => n.citations.filter((c) => c.coordonnees));
      const coordC = coordP.filter((c) => c.coordonnees.correcte !== null);
      const tabS = notes.filter((n) => n.tableaux.structure.attendues);
      const tabT = notes.filter((n) => n.tableaux.texte.attendues);
      const couts = notes.map((n) => n.mesure.cout_eur).filter((c) => c != null);
      sortie[groupe].parseurs[nom] = {
        documents: notes.length, erreurs, citations: cit,
        bonne_page: cit ? somme((n) => n.resume.bonne_page) / cit : null,
        autre_page: cit ? somme((n) => n.resume.autre_page) / cit : null,
        cer: carRef ? avecCer.reduce((s, n) => s + n.fidelite.cer * n.fidelite.pages.reduce((t, p) => t + p.caracteres_reference, 0), 0) / carRef : null,
        wer: carRef ? avecCer.reduce((s, n) => s + n.fidelite.wer * n.fidelite.pages.reduce((t, p) => t + p.caracteres_reference, 0), 0) / carRef : null,
        coordonnees_presentes: coordP.length ? coordP.filter((c) => c.coordonnees.presente).length / coordP.length : null,
        coordonnees_correctes: coordC.length ? coordC.filter((c) => c.coordonnees.correcte).length / coordC.length : null,
        tableaux_structures: tabS.length ? tabS.reduce((s, n) => s + n.tableaux.structure.cellules_trouvees, 0) / tabS.reduce((s, n) => s + n.tableaux.structure.cellules_attendues, 0) : null,
        tableaux_lignes_texte: tabT.length ? tabT.reduce((s, n) => s + n.tableaux.texte.cellules_trouvees, 0) / tabT.reduce((s, n) => s + n.tableaux.texte.cellules_attendues, 0) : null,
        ms_par_page: pages ? somme((n) => n.mesure.ms) / pages : null,
        eur_par_page: couts.length && pages ? couts.reduce((s, c) => s + c, 0) / pages : null,
        pages,
      };
    }
  }
  return sortie;
}

function robustesse(parDoc, noms) {
  const r = {};
  for (const nom of noms) {
    const t06 = parDoc.T06 && parDoc.T06.parseurs[nom];
    const b03 = parDoc.B03 && parDoc.B03.parseurs[nom];
    const q03 = parDoc.Q03 && parDoc.Q03.parseurs[nom];
    const b04 = parDoc.B04 && parDoc.B04.parseurs[nom];
    const taux = (cits) => (cits.length ? cits.filter((c) => c.statut === 'bonne_page').length / cits.length : null);
    r[nom] = {
      t06_page_tournee: t06 && !t06.erreur ? { citations_p2: taux(t06.citations.filter((c) => c.page_attendue === 2)), cer_p2: (t06.fidelite && (t06.fidelite.pages.find((p) => p.page === 2) || {}).cer) ?? null, rotation_detectee: (t06.rotations || []).length > 0 } : null,
      t06_tampon_titre: t06 && !t06.erreur ? { citations_p1: taux(t06.citations.filter((c) => c.page_attendue === 1)) } : null,
      b03_scan_degrade: b03 && !b03.erreur ? { citations: taux(b03.citations), cer: b03.resume.cer, loyer_imprime_trouve: (b03.citations.find((c) => c.cle === 'loyer_annuel_ht_hc') || {}).statut === 'bonne_page' } : null,
      q03_deux_colonnes: q03 && !q03.erreur ? { wer: q03.resume.wer, citations: taux(q03.citations) } : null,
      b04_mixte: b04 && !b04.erreur ? { bail_natif_p1_3: taux(b04.citations.filter((c) => c.segment === 0)), avenant1_scan_p4: taux(b04.citations.filter((c) => c.segment === 1)), avenant2_natif_p5: taux(b04.citations.filter((c) => c.segment === 2)), cer_p4: (b04.fidelite && (b04.fidelite.pages.find((p) => p.page === 4) || {}).cer) ?? null } : null,
    };
  }
  return r;
}

/** Citations qu'aucun parseur teste ne retrouve a la bonne page, avec une capture de la page. */
async function sansSolution(parDoc, docs, parseurs) {
  const testes = Object.values(parseurs).filter((p) => p.ok).map((p) => p.nom);
  const sortie = [];
  for (const d of docs.filter((x) => x.pdf)) {
    const notes = testes.map((n) => parDoc[d.id].parseurs[n]).filter((n) => n && !n.erreur);
    if (!notes.length) continue;
    const cles = notes[0].citations.map((c) => c.chemin);
    for (const chemin of cles) {
      const partout = notes.every((n) => { const c = n.citations.find((x) => x.chemin === chemin); return c && c.statut !== 'bonne_page'; });
      if (!partout) continue;
      const c = notes[0].citations.find((x) => x.chemin === chemin);
      const champ = N.champsAttendus(d.attendu).find((x) => x.chemin === chemin);
      const capture = path.join(CAPTURES, `${d.id}-p${c.page_attendue}.png`);
      if (!fs.existsSync(capture)) {
        try { const { rasteriser } = require('../../packages/parsing/rasteriser'); const [img] = await rasteriser(fs.readFileSync(d.chemin), { dpi: 80, pages: [c.page_attendue] }); fs.mkdirSync(CAPTURES, { recursive: true }); fs.writeFileSync(capture, img.png); } catch { /* pas de capture */ }
      }
      sortie.push({ id: d.id, page: c.page_attendue, champ: chemin, citation: champ && champ.citation, meilleurs_scores: Object.fromEntries(notes.map((n) => [n.mesure && n.mesure.pages !== undefined ? testes[notes.indexOf(n)] : '?', (n.citations.find((x) => x.chemin === chemin) || {}).score])), capture: path.relative(RACINE, capture) });
    }
  }
  return sortie;
}

function projections(resultats) {
  const sortie = {};
  for (const nom of Object.keys(resultats.parseurs)) {
    const s = resultats.jeux[0] && resultats.jeux[0].synthese.tous.parseurs[nom];
    if (!s || !s.pages) continue;
    sortie[nom] = { eur_par_page: s.eur_par_page, ms_par_page: s.ms_par_page, cout_2000_pages_eur: s.eur_par_page != null ? s.eur_par_page * 2000 : null, cout_20000_pages_eur: s.eur_par_page != null ? s.eur_par_page * 20000 : null, heures_calcul_2000_pages: s.ms_par_page != null ? (s.ms_par_page * 2000) / 3.6e6 : null, heures_calcul_20000_pages: s.ms_par_page != null ? (s.ms_par_page * 20000) / 3.6e6 : null };
  }
  return sortie;
}

function lireRecommandation() {
  const f = path.join(__dirname, 'recommandation.md');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}

function afficherResume(resultats) {
  for (const jeu of resultats.jeux) {
    console.log(`\n[${jeu.nom}] citations à la bonne page, tous PDF :`);
    for (const [nom, s] of Object.entries(jeu.synthese.tous.parseurs)) {
      if (!s.documents) { console.log(`  ${nom.padEnd(10)} ${resultats.parseurs[nom].statut}`); continue; }
      console.log(`  ${nom.padEnd(10)} ${s.bonne_page == null ? '—' : `${(s.bonne_page * 100).toFixed(1)} %`}  CER (réf. texte natif) ${s.cer == null ? '—' : `${(s.cer * 100).toFixed(1)} %`}  ${s.ms_par_page == null ? '' : `${Math.round(s.ms_par_page)} ms/page`}  ${s.eur_par_page == null ? 'coût non mesuré' : `${s.eur_par_page.toFixed(4)} €/page`}${s.erreurs ? `  (${s.erreurs} erreur(s))` : ''}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
