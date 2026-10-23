// Notation des parseurs (protocole du README du jeu de benchmark) :
// retrouvabilite des citations a la bonne page (similarite ≥ 0,90 apres
// normalisation), CER et WER contre le texte natif, coordonnees, cellules de
// tableaux, et quelques verifications de robustesse. Fonctions pures.

const SEUIL = 0.9;

// ---------- normalisation ----------
const APOSTROPHES = /[‘’‚‛′´`]/g;
const GUILLEMETS = /[“”„«»″]/g;
const TIRETS = /[‐‑‒–—―−]/g;
const ESPACES = /[\u00a0\u2007\u202f\u2009\u200a\u2002\u2003\u2004\u2005\u2006\u2008\t\f\v]/g;

/** Normalise un texte pour la comparaison : NFKC, espaces insecables et retours a la ligne → espace, apostrophes, guillemets et tirets unifies, minuscules, espaces reduits. */
function normaliser(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/­/g, '')
    .replace(/(\p{L})-\n(\p{L})/gu, '$1$2')
    .replace(ESPACES, ' ')
    .replace(APOSTROPHES, "'")
    .replace(GUILLEMETS, '"')
    .replace(TIRETS, '-')
    .replace(/\s*\n\s*/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Meme normalisation, mais sans NFKC et avec une carte : carte[i] = position, dans le texte d'origine,
 * du caractere i du texte normalise. Sert a retrouver les blocs (et leurs boites) d'une citation.
 */
function normaliserAvecCarte(s) {
  const src = String(s || '').replace(/­/g, '');
  let texte = '';
  const carte = [];
  let dernierEspace = true;
  for (let i = 0; i < src.length; i++) {
    let c = src[i];
    if (c === '-' && src[i + 1] === '\n' && i > 0 && /\p{L}/u.test(src[i - 1]) && /\p{L}/u.test(src[i + 2] || '')) { i++; continue; }
    if (/[\s\u00a0\u2007\u202f\u2009\u200a\u2002-\u2006\u2008]/.test(c)) { if (dernierEspace) continue; texte += ' '; carte.push(i); dernierEspace = true; continue; }
    c = c.normalize('NFKC').replace(APOSTROPHES, "'").replace(GUILLEMETS, '"').replace(TIRETS, '-').toLowerCase();
    texte += c;
    for (let k = 0; k < c.length; k++) carte.push(i);
    dernierEspace = false;
  }
  if (texte.endsWith(' ')) { texte = texte.slice(0, -1); carte.pop(); }
  return { texte, carte };
}

// ---------- distances ----------
function levenshtein(a, b, limite = Infinity) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > limite) return limite + 1;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let min = cur[0];
    const ca = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      const cout = ca === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cout);
      if (cur[j] < min) min = cur[j];
    }
    if (min > limite) return limite + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}
function levenshteinTableaux(a, b) {
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}
function bigrammes(s) { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; }
function dice(ma, mb) {
  let inter = 0; let na = 0; let nb = 0;
  for (const v of ma.values()) na += v;
  for (const v of mb.values()) nb += v;
  for (const [k, v] of ma) if (mb.has(k)) inter += Math.min(v, mb.get(k));
  return na + nb ? (2 * inter) / (na + nb) : 0;
}

/**
 * Cherche une citation dans un texte (tous deux deja normalises). Exact d'abord, puis approche :
 * fenetres glissantes autour des mots distinctifs de la citation, ratio de Levenshtein.
 * @returns {{ score: number, debut: number, fin: number } | null}  (null si rien n'atteint 0,5)
 */
function chercher(citation, texte) {
  if (!citation || !texte) return null;
  const exact = texte.indexOf(citation);
  if (exact >= 0) return { score: 1, debut: exact, fin: exact + citation.length };
  const L = citation.length;
  const mots = [...new Set(citation.split(' ').filter((w) => w.length >= 4))].sort((a, b) => b.length - a.length).slice(0, 6);
  const positions = new Set();
  for (const mot of mots) {
    let p = texte.indexOf(mot);
    let n = 0;
    while (p >= 0 && n < 40) { positions.add(p); p = texte.indexOf(mot, p + 1); n++; }
    if (mot.length >= 6 && n === 0) {
      // Mot absent tel quel (OCR) : on tente ses trigrammes de tete.
      const tete = mot.slice(0, 5);
      let q = texte.indexOf(tete); let k = 0;
      while (q >= 0 && k < 10) { positions.add(q); q = texte.indexOf(tete, q + 1); k++; }
    }
  }
  if (!positions.size) {
    // Rien de distinctif (citation courte, ex. « 640 ») : balayage grossier.
    for (let p = 0; p < texte.length; p += Math.max(1, Math.floor(L / 2))) positions.add(p);
  }
  const bigCit = bigrammes(citation);
  let meilleur = null;
  const pas = Math.max(1, Math.floor(L / 15));
  const longueurs = [...new Set([Math.round(L * 0.9), L, Math.round(L * 1.1)])];
  for (const p of positions) {
    for (let debut = Math.max(0, p - L - 2); debut <= Math.min(p + 2, texte.length - 1); debut += pas) {
      for (const longueur of longueurs) {
        const fenetre = texte.slice(debut, debut + longueur);
        if (fenetre.length < L * 0.5) continue;
        if (dice(bigCit, bigrammes(fenetre)) < 0.55) continue;
        const max = Math.max(L, fenetre.length);
        const d = levenshtein(citation, fenetre, Math.ceil(max * 0.5));
        const score = 1 - d / max;
        if (!meilleur || score > meilleur.score) meilleur = { score, debut, fin: debut + fenetre.length };
      }
    }
  }
  if (!meilleur || meilleur.score < 0.5) return null;
  // Affinage : on reduit la fenetre aux bornes qui maximisent le score (quelques caracteres).
  let { debut, fin, score } = meilleur;
  for (let iter = 0; iter < 6; iter++) {
    let ameliore = false;
    for (const [dd, df] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const d2 = Math.max(0, debut + dd); const f2 = Math.min(texte.length, fin + df);
      if (f2 - d2 < L * 0.5) continue;
      const fen = texte.slice(d2, f2);
      const s2 = 1 - levenshtein(citation, fen) / Math.max(L, fen.length);
      if (s2 > score) { score = s2; debut = d2; fin = f2; ameliore = true; }
    }
    if (!ameliore) break;
  }
  return { score, debut, fin };
}

// ---------- boites ----------
function unionBoites(boites) {
  const b = boites.filter(Boolean);
  if (!b.length) return null;
  return [Math.min(...b.map((x) => x[0])), Math.min(...b.map((x) => x[1])), Math.max(...b.map((x) => x[2])), Math.max(...b.map((x) => x[3]))];
}
function iou(a, b) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}
function aire(b) { return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]); }
function centreDans(a, b) { const cx = (a[0] + a[2]) / 2; const cy = (a[1] + a[3]) / 2; return cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]; }
/** La boite du parseur tombe sur la zone de reference : recouvrement net, ou centre de l'une dans l'autre, sans etre plus de 4 fois plus grande (une boite « toute la page » ne sert a rien). */
function boiteCorrecte(parseur, ref) {
  if (aire(parseur) > 4 * aire(ref) + 0.01) return false;
  return iou(parseur, ref) >= 0.25 || centreDans(parseur, ref) || centreDans(ref, parseur);
}
/** La boite (union des blocs) qui couvre un intervalle du texte normalise d'une page. */
function boiteDeSpan(page, carte, debut, fin) {
  const d = carte[debut]; const f = carte[Math.max(debut, fin - 1)];
  if (d == null || f == null) return null;
  const blocs = (page.blocks || []).filter((b) => b.bbox && b.char_end > d && b.char_start <= f && b.type !== 'table');
  return unionBoites(blocs.map((b) => b.bbox));
}

// ---------- champs attendus ----------
/** Aplatit les champs d'un fichier attendu : champs simples, lignes, segments. Chaque entree porte sa citation, sa page et son chemin. */
function champsAttendus(attendu) {
  const sortie = [];
  const pousser = (prefixe, champs, extra = {}) => {
    for (const [cle, v] of Object.entries(champs || {})) {
      if (!v || typeof v !== 'object') continue;
      sortie.push({ chemin: prefixe ? `${prefixe}.${cle}` : cle, cle, ...v, ...extra });
    }
  };
  pousser('', attendu.champs);
  (attendu.lignes || []).forEach((l, i) => pousser(`lignes[${i}]`, l, { ligne: i }));
  (attendu.segments || []).forEach((s, i) => {
    pousser(`segments[${i}]`, s.champs, { segment: i, segment_type: s.doc_type, segment_pages: s.pages });
    (s.lignes || []).forEach((l, j) => pousser(`segments[${i}].lignes[${j}]`, l, { segment: i, ligne: j }));
  });
  return sortie;
}

/**
 * Note un document PDF pour un parseur.
 * @param {object} attendu            attendu/<ID>.json
 * @param {object} parsed             ParsedDocument du parseur
 * @param {object} [options]
 * @param {object} [options.referenceNatif]   ParsedDocument pdfjs du PDF natif (boites de reference)
 * @param {object} [options.texteNatif]       reference/texte_natif/<ID>.json (CER, WER)
 */
function noterDocument(attendu, parsed, { referenceNatif, texteNatif } = {}) {
  const pages = (parsed.pages || []).map((p) => ({ ...p, norm: normaliserAvecCarte(p.text || '') }));
  const parNumero = Object.fromEntries(pages.map((p) => [p.page_number, p]));
  const refPages = referenceNatif ? Object.fromEntries(referenceNatif.pages.map((p) => [p.page_number, { ...p, norm: normaliserAvecCarte(p.text || '') }])) : null;

  const citations = [];
  for (const champ of champsAttendus(attendu)) {
    if (champ.absent || !champ.citation || !champ.page) continue;
    const cit = normaliser(champ.citation);
    const attendues = [champ.page, ...(champ.pages_autres_occurrences || [])];
    let resultat = { chemin: champ.chemin, cle: champ.cle, page_attendue: champ.page, statut: 'absente', score: 0, page_trouvee: null, segment: champ.segment ?? null, ligne: champ.ligne ?? null, coordonnees: null };
    const essayer = (numero) => { const p = parNumero[numero]; if (!p) return null; const r = chercher(cit, p.norm.texte); return r && r.score >= SEUIL ? { ...r, page: numero } : null; };
    let trouve = null;
    for (const n of attendues) { trouve = essayer(n); if (trouve) break; }
    if (trouve) resultat = { ...resultat, statut: 'bonne_page', score: trouve.score, page_trouvee: trouve.page };
    else {
      for (const p of pages) { if (attendues.includes(p.page_number)) continue; const r = chercher(cit, p.norm.texte); if (r && r.score >= SEUIL) { trouve = { ...r, page: p.page_number }; break; } }
      if (trouve) resultat = { ...resultat, statut: 'autre_page', score: trouve.score, page_trouvee: trouve.page };
      else {
        // Meilleur score partiel, pour le diagnostic.
        let best = 0;
        for (const n of attendues) { const p = parNumero[n]; if (!p) continue; const r = chercher(cit, p.norm.texte); if (r && r.score > best) best = r.score; }
        resultat.score = Math.round(best * 1000) / 1000;
      }
    }
    // Coordonnees : boite du parseur pour cette citation, comparee a la boite de reference (pdfjs sur le natif).
    if (trouve) {
      const page = parNumero[trouve.page];
      const boite = boiteDeSpan(page, page.norm.carte, trouve.debut, trouve.fin);
      let ref = null;
      if (refPages && refPages[trouve.page]) { const rp = refPages[trouve.page]; const rr = chercher(cit, rp.norm.texte); if (rr && rr.score >= SEUIL) ref = boiteDeSpan(rp, rp.norm.carte, rr.debut, rr.fin); }
      resultat.coordonnees = { presente: !!boite, reference: !!ref, correcte: boite && ref ? boiteCorrecte(boite, ref) : null, boite, boite_reference: ref };
    }
    citations.push(resultat);
  }

  // CER / WER contre le texte natif.
  let fidelite = null;
  if (texteNatif && texteNatif.pages) {
    const parPage = [];
    for (const rp of texteNatif.pages) {
      const ref = normaliser(rp.texte);
      const hyp = normaliser((parNumero[rp.page] || {}).text || '');
      const cer = ref.length ? levenshtein(ref, hyp) / ref.length : null;
      const rm = ref.split(' ').filter(Boolean); const hm = hyp.split(' ').filter(Boolean);
      const wer = rm.length ? levenshteinTableaux(rm, hm) / rm.length : null;
      parPage.push({ page: rp.page, cer, wer, caracteres_reference: ref.length });
    }
    const total = parPage.reduce((s, p) => s + p.caracteres_reference, 0);
    fidelite = {
      pages: parPage,
      cer: total ? parPage.reduce((s, p) => s + (p.cer || 0) * p.caracteres_reference, 0) / total : null,
      wer: total ? parPage.reduce((s, p) => s + (p.wer || 0) * p.caracteres_reference, 0) / total : null,
    };
  }

  // Tableaux : lignes attendues retrouvees dans une meme ligne de tableau (structure) ou de texte.
  const tableaux = noterTableaux(attendu, pages);

  const n = citations.length;
  const bonne = citations.filter((c) => c.statut === 'bonne_page').length;
  const autre = citations.filter((c) => c.statut === 'autre_page').length;
  const avecCoord = citations.filter((c) => c.coordonnees);
  return {
    pages_attendues: attendu.nombre_pages || null,
    pages_lues: pages.length,
    citations,
    resume: {
      citations: n, bonne_page: bonne, autre_page: autre, absentes: n - bonne - autre,
      taux_bonne_page: n ? bonne / n : null,
      coordonnees_presentes: avecCoord.length ? avecCoord.filter((c) => c.coordonnees.presente).length / avecCoord.length : null,
      coordonnees_correctes: (() => { const e = avecCoord.filter((c) => c.coordonnees.correcte !== null); return e.length ? e.filter((c) => c.coordonnees.correcte).length / e.length : null; })(),
      cer: fidelite ? fidelite.cer : null, wer: fidelite ? fidelite.wer : null,
      tableaux_structures: tableaux.structure.attendues ? tableaux.structure.cellules_trouvees / tableaux.structure.cellules_attendues : null,
      tableaux_lignes_texte: tableaux.texte.attendues ? tableaux.texte.cellules_trouvees / tableaux.texte.cellules_attendues : null,
      lignes_completes_structure: tableaux.structure.attendues ? tableaux.structure.lignes_completes / tableaux.structure.attendues : null,
    },
    fidelite,
    tableaux,
  };
}

const LIGNES_QUITTANCE = [
  { cle: 'loyer_ht', etiquette: /loyer/ },
  { cle: 'provisions_charges_ht', etiquette: /provision/ },
  { cle: 'taxe_fonciere_ht', etiquette: /taxe fonci/ },
  { cle: 'total_ttc', etiquette: /total/ },
];
/** Les lignes de tableau attendues d'un document : lignes du jeu (lots, locataires) ou lignes des quittances (etiquette + montant). */
function lignesAttendues(attendu) {
  const lignes = [];
  const toutes = [...(attendu.lignes || []), ...(attendu.segments || []).flatMap((s) => s.lignes || [])];
  for (const l of toutes) {
    const cellules = Object.values(l).filter((v) => v && v.citation && !v.absent).map((v) => normaliser(v.citation));
    const page = (Object.values(l).find((v) => v && v.page) || {}).page || 1;
    if (cellules.length) lignes.push({ page, cellules, cle: Object.values(l)[0] && Object.values(l)[0].valeur });
  }
  if (!lignes.length && attendu.doc_type === 'quittance') {
    for (const { cle, etiquette } of LIGNES_QUITTANCE) {
      const v = (attendu.champs || {})[cle];
      if (!v || v.absent || !v.citation) continue;
      lignes.push({ page: v.page || 1, cellules: [normaliser(v.citation)], etiquette, cle });
    }
  }
  return lignes;
}
function noterLignes(lignes, rangees) {
  let cellulesAttendues = 0; let cellulesTrouvees = 0; let lignesCompletes = 0;
  const detail = [];
  for (const l of lignes) {
    cellulesAttendues += l.cellules.length;
    let meilleur = { trouvees: 0, rangee: null };
    for (const r of rangees) {
      if (l.page && r.page && r.page !== l.page) continue;
      if (l.etiquette && !l.etiquette.test(r.texte)) continue;
      const trouvees = l.cellules.filter((c) => r.texte.includes(c)).length;
      if (trouvees > meilleur.trouvees) meilleur = { trouvees, rangee: r.texte.slice(0, 120) };
    }
    cellulesTrouvees += meilleur.trouvees;
    if (meilleur.trouvees === l.cellules.length) lignesCompletes++;
    detail.push({ cle: l.cle, attendues: l.cellules.length, trouvees: meilleur.trouvees, rangee: meilleur.rangee });
  }
  return { attendues: lignes.length, cellules_attendues: cellulesAttendues, cellules_trouvees: cellulesTrouvees, lignes_completes: lignesCompletes, detail };
}
function noterTableaux(attendu, pages) {
  const lignes = lignesAttendues(attendu);
  if (!lignes.length) return { structure: { attendues: 0 }, texte: { attendues: 0 } };
  const rangeesStructure = [];
  const rangeesTexte = [];
  for (const p of pages) {
    for (const b of p.blocks || []) if (b.type === 'table' && b.table) for (const r of b.table.rows) rangeesStructure.push({ page: p.page_number, texte: normaliser(r.join(' | ')) });
    for (const l of (p.text || '').split('\n')) if (l.trim()) rangeesTexte.push({ page: p.page_number, texte: normaliser(l) });
  }
  return { structure: noterLignes(lignes, rangeesStructure), texte: noterLignes(lignes, rangeesTexte) };
}

/** Note le lecteur Excel : chaque champ attendu designe une cellule (« Feuille!E6 ») dont la valeur doit correspondre. */
function noterExcel(attendu, parsed) {
  const blocs = {};
  for (const p of parsed.pages) for (const b of p.blocks) blocs[b.id] = b;
  const resultats = [];
  for (const champ of champsAttendus(attendu)) {
    if (!champ.cellule) continue;
    const bloc = blocs[champ.cellule];
    let ok = false;
    const lu = bloc ? bloc.text : null;
    if (bloc) {
      if (champ.absent) ok = ['', 'vacant', '-', '—'].includes(normaliser(lu));
      else if (champ.type === 'montant' || champ.type === 'surface' || champ.type === 'nombre' || champ.type === 'pourcentage') ok = Math.abs(Number(lu) - Number(champ.valeur)) < 1e-6;
      else if (champ.valeur == null) ok = ['', 'vacant', '-', '—'].includes(normaliser(lu));
      else if (champ.type === 'date') { const [a, m, j] = String(champ.valeur).split('-'); ok = lu === champ.valeur || normaliser(lu).includes(`${j}/${m}/${a}`) || normaliser(lu).includes(champ.valeur); }
      else if (champ.type === 'booleen') ok = (lu === 'Oui') === champ.valeur || String(lu).toLowerCase() === String(champ.valeur);
      else ok = normaliser(lu) === normaliser(String(champ.valeur)) || normaliser(lu).includes(normaliser(String(champ.valeur)));
    }
    resultats.push({ chemin: champ.chemin, cellule: champ.cellule, attendu: champ.valeur, lu, ok, formule: !!(champ.note && /formule/i.test(champ.note)) });
  }
  return { resultats, resume: { attendus: resultats.length, corrects: resultats.filter((r) => r.ok).length, formules_correctes: resultats.filter((r) => r.formule && r.ok).length, formules: resultats.filter((r) => r.formule).length } };
}

/** Note le lecteur de mail : chaque citation doit etre dans la partie text/plain. */
function noterEmail(attendu, parsed) {
  const texte = normaliser((parsed.pages[0] || {}).text || '');
  const resultats = [];
  for (const champ of champsAttendus(attendu)) {
    if (champ.absent || !champ.citation) continue;
    const r = chercher(normaliser(champ.citation), texte);
    resultats.push({ chemin: champ.chemin, citation: champ.citation, trouvee: !!(r && r.score >= SEUIL), score: r ? r.score : 0 });
  }
  return { resultats, resume: { attendues: resultats.length, trouvees: resultats.filter((r) => r.trouvee).length } };
}

module.exports = { SEUIL, normaliser, normaliserAvecCarte, levenshtein, levenshteinTableaux, chercher, champsAttendus, noterDocument, noterExcel, noterEmail, noterTableaux, iou, unionBoites };
