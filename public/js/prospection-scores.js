// Prospection cession-bail : les trois scores sur 100 (Fit, Motivation,
// Locataire) d'une cible pour un mandat SCPI, en regles deterministes et
// additives plafonnees (spec V2 du 21 oct. 2026). Chaque point garde sa raison,
// sa source et, quand il y en a une, son lien. Une cible = une entreprise
// occupante et tous ses murs (server/prospection/pipeline.js).
//
// Un seul fichier pour le serveur (require) et le navigateur (<script>) : le
// changement de mandat recalcule tout dans le navigateur, sans relancer
// d'analyse, avec exactement les memes regles que l'export.
//
// Les points sont un point de depart, a recaler avec KV Capital sur 20 cibles
// qu'ils jugent eux-memes. Ils se changent ICI, avec leur raison.

(function (racine, fabrique) {
  if (typeof module === 'object' && module.exports) module.exports = fabrique();
  else racine.ProspectionScores = fabrique();
}(typeof self !== 'undefined' ? self : this, () => {
  const TYPES_ACTIF = {
    logistique: 'Logistique / entrepôt',
    activite: 'Activité / industriel',
    commerce: 'Commerce',
    sante: 'Santé / médico-social',
    hotellerie: 'Hôtellerie / restauration',
    bureaux: 'Bureaux',
    autre: 'Autre',
  };

  /** Pure : le type d'actif d'apres l'activite de l'etablissement occupant (code NAF « 52.10B »). */
  function typeActif(ape) {
    const n = parseInt(String(ape || '').slice(0, 2), 10);
    const n4 = String(ape || '').slice(0, 5);
    if (!Number.isFinite(n)) return 'autre';
    if (n === 52 || n === 53 || n4 === '49.41' || n === 46) return 'logistique';
    if ((n >= 5 && n <= 39) || (n >= 41 && n <= 43)) return 'activite';
    if (n === 45 || n === 47) return 'commerce';
    if (n === 55 || n === 56) return 'hotellerie';
    if (n >= 86 && n <= 88) return 'sante';
    if ((n >= 58 && n <= 75) || (n >= 77 && n <= 82) || n === 84 || n === 94) return 'bureaux';
    return 'autre';
  }

  const TRANCHES_EFFECTIF = { '00': [0, '0 salarié'], '01': [1, '1 à 2'], '02': [3, '3 à 5'], '03': [6, '6 à 9'], 11: [10, '10 à 19'], 12: [20, '20 à 49'], 21: [50, '50 à 99'], 22: [100, '100 à 199'], 31: [200, '200 à 249'], 32: [250, '250 à 499'], 41: [500, '500 à 999'], 42: [1000, '1 000 à 1 999'], 51: [2000, '2 000 à 4 999'], 52: [5000, '5 000 à 9 999'], 53: [10000, '10 000 et plus'] };
  const effectifMin = (t) => (TRANCHES_EFFECTIF[t] ? TRANCHES_EFFECTIF[t][0] : null);
  const effectifLibelle = (t) => (TRANCHES_EFFECTIF[t] ? `${TRANCHES_EFFECTIF[t][1]} salariés` : 'non diffusé');

  const POIDS_DEFAUT = { fit: 40, motivation: 35, locataire: 25 };
  /** Le mandat par defaut : celui qu'on applique tant qu'aucun mandat n'est actif. */
  const MANDAT_DEFAUT = { ticketMin: 5e6, ticketMax: 50e6, types: ['logistique', 'activite', 'commerce', 'sante', 'hotellerie', 'bureaux'], departements: [], bailMinAns: 9, rendement: 6.5, exclusionsNaf: [], poids: POIDS_DEFAUT };
  const completer = (m) => ({ ...MANDAT_DEFAUT, ...(m || {}), poids: { ...POIDS_DEFAUT, ...((m && m.poids) || {}) } });

  const M = (v) => `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€`;
  const mois = (d) => new Date(d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const anneesDepuis = (date, maintenant) => (date ? (maintenant - Date.parse(date)) / (365.25 * 86400000) : null);
  const borne = (x) => Math.max(0, Math.min(100, Math.round(x)));
  const total = (raisons) => borne(raisons.reduce((t, r) => t + r.points, 0));
  const EXECUTIF = /pr[ée]sident|g[ée]rant|directeur g[ée]n[ée]ral|PDG|associ[ée] ind[ée]finiment/i;

  /** Le dirigeant executif personne physique le plus age, parmi l'occupant et les proprietaires. */
  function doyen(c) {
    const tous = [...(c.occupant.dirigeants || []), ...c.murs.flatMap((m) => m.proprietaire.dirigeants || [])];
    return tous.filter((d) => !d.personne_morale && d.age != null && EXECUTIF.test(d.qualite || '')).sort((a, b) => b.age - a.age)[0] || null;
  }

  // -------------------------------------------------------------------------
  // Fit : la cible correspond-elle au mandat ?
  // -------------------------------------------------------------------------
  function scoreFit(c, mandat) {
    const m = completer(mandat);
    const exclu = m.exclusionsNaf.find((p) => p && String(c.occupant.ape || '').startsWith(p));
    if (exclu) return { score: 0, exclu: true, raisons: [{ points: 0, texte: `Secteur exclu par les critères (NAF ${exclu})`, source: 'SIRENE' }] };
    const raisons = [];
    const v = c.totaux.centrale;
    if (v == null) raisons.push({ points: 0, texte: 'Valeur non estimée : moins de 5 ventes comparables à 20 km', source: 'DVF' });
    else if (v >= m.ticketMin && v <= m.ticketMax) raisons.push({ points: 35, texte: `Valeur centrale ${M(v)} dans le ticket ${M(m.ticketMin)} à ${M(m.ticketMax)}`, source: 'DVF' });
    else if (v >= m.ticketMin * 0.8 && v <= m.ticketMax * 1.2) raisons.push({ points: 15, texte: `Valeur centrale ${M(v)} à moins de 20 % du ticket`, source: 'DVF' });
    else raisons.push({ points: 0, texte: `Valeur centrale ${M(v)} hors ticket`, source: 'DVF' });

    const t = c.type_actif || 'autre';
    raisons.push(m.types.includes(t) ? { points: 25, texte: `Type d'actif visé : ${TYPES_ACTIF[t]}`, source: 'Activité de l\'occupant (SIRENE)' } : { points: 0, texte: `Type d'actif hors critères : ${TYPES_ACTIF[t]}`, source: 'Activité de l\'occupant (SIRENE)' });

    const depts = c.departements || [];
    if (!m.departements.length) raisons.push({ points: 20, texte: 'Aucune restriction de zone', source: null });
    else if (depts.some((d) => m.departements.includes(d))) raisons.push({ points: 20, texte: `Zone visée (département ${depts.filter((d) => m.departements.includes(d)).join(', ')})`, source: null });
    else raisons.push({ points: 0, texte: `Hors zone des critères (département ${depts.join(', ')})`, source: null });

    if (c.confiance === 'fort') raisons.push({ points: 20, texte: 'Lien occupant fort : même société ou SCI dirigée, établissement dans la parcelle', source: 'DGFiP · RNE · SIRENE' });
    else if (c.confiance === 'moyen') raisons.push({ points: 10, texte: 'Lien occupant moyen : à confirmer sur place', source: 'DGFiP · RNE · SIRENE' });
    else raisons.push({ points: 0, texte: 'Lien occupant faible : à vérifier avant tout contact', source: 'DGFiP · RNE · SIRENE' });

    const partMin = Math.min(...c.murs.map((x) => (x.parcelle.part_detenue == null ? 1 : x.parcelle.part_detenue)));
    if (partMin < 0.9) raisons.push({ points: -15, texte: `Copropriété probable : ${Math.round(partMin * 100)} % des locaux d'une parcelle seulement`, source: 'DGFiP' });
    return { score: total(raisons), exclu: false, raisons };
  }

  // -------------------------------------------------------------------------
  // Motivation : pourquoi elle vendrait ses murs maintenant
  // -------------------------------------------------------------------------
  function scoreMotivation(c, { maintenant = Date.now() } = {}) {
    const raisons = [];
    if (c.fonds && c.fonds.length) {
      const f = c.fonds[0];
      raisons.push({ cle: 'fonds', points: 30, texte: `Fonds d'investissement probable au capital : ${f.nom}${f.qualite ? ` (${String(f.qualite).toLowerCase()})` : ''}`, court: `un fonds probable au capital (${f.nom})`, source: 'RNE', lien: f.siren ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${f.siren}` : null });
    }
    const ev = c.bodacc || [];
    const recent = (e, nbMois) => anneesDepuis(e.date, maintenant) <= nbMois / 12;
    const dirig = ev.find((e) => e.nature === 'dirigeant' && recent(e, 18));
    if (dirig) raisons.push({ cle: 'changement_dirigeant', points: 20, texte: `Changement de dirigeant publié le ${dirig.date}`, court: `un changement de dirigeant en ${mois(dirig.date)}`, source: 'BODACC', lien: dirig.url, date: dirig.date });
    const d = doyen(c);
    if (d && d.age >= 60) raisons.push({ cle: 'dirigeant_60', points: 15, texte: `Dirigeant de ${d.age} ans (${d.nom}, ${String(d.qualite || '').toLowerCase()})`, court: `un dirigeant de ${d.age} ans`, source: 'RNE' });

    // Achat ancien : DVF ne remonte qu'a 5 ans. Un proprietaire cree avant 2005 dont aucun mur ne s'est vendu
    // depuis 5 ans detient tres probablement ses murs depuis longtemps.
    // « 1900-01-01 » est la date de creation par defaut de l'INSEE quand la vraie est inconnue : ignoree.
    const anciens = c.murs.filter((m) => !m.achat && m.proprietaire.creation && !String(m.proprietaire.creation).startsWith('1900-01-01') && new Date(m.proprietaire.creation).getFullYear() < 2005);
    if (anciens.length) {
      const an = Math.min(...anciens.map((m) => new Date(m.proprietaire.creation).getFullYear()));
      raisons.push({ cle: 'achat_ancien', points: 15, texte: `Propriétaire créé en ${an}, aucune vente des murs depuis 5 ans : achat probablement antérieur à 2005`, court: `des murs probablement détenus de longue date (propriétaire créé en ${an})`, source: 'SIRENE · DVF' });
    }
    const pv = c.murs.find((m) => m.achat && m.achat.prix && m.valeur && m.valeur.centrale / m.achat.prix >= 1.5);
    if (pv) raisons.push({ cle: 'plus_value', points: 10, texte: `Plus-value latente forte : acheté ${M(pv.achat.prix)} en ${String(pv.achat.date).slice(0, 4)}, estimé ${M(pv.valeur.centrale)}`, court: 'une plus-value latente forte', source: 'DVF' });
    const capital = ev.find((e) => e.nature === 'capital' && recent(e, 24));
    if (capital) raisons.push({ cle: 'capital', points: 10, texte: `Modification du capital publiée le ${capital.date}`, court: `une modification du capital en ${mois(capital.date)}`, source: 'BODACC', lien: capital.url, date: capital.date });
    const cession = ev.find((e) => e.nature === 'cession' && recent(e, 24));
    if (cession) raisons.push({ cle: 'operation', points: 10, texte: `Opération de cession ou d'acquisition publiée le ${cession.date}`, court: `une opération de cession ou d'acquisition en ${mois(cession.date)}`, source: 'BODACC', lien: cession.url, date: cession.date });
    // Signal sans source branchee : affiche pour qu'on sache qu'il ne compte pas encore.
    raisons.push({ cle: 'daf', points: 0, texte: 'Recrutement de DAF : non mesuré (offres d\'emploi non branchées)', source: null });
    const signes = raisons.filter((r) => r.points > 0).sort((a, b) => b.points - a.points);
    return { score: total(raisons), raisons, signaux: signes.map((r) => r.cle) };
  }

  // -------------------------------------------------------------------------
  // Locataire : l'occupant sera-t-il un bon locataire pour la SCPI ?
  // -------------------------------------------------------------------------
  function scoreLocataire(c, mandat, { maintenant = Date.now() } = {}) {
    const m = completer(mandat);
    const o = c.occupant;
    const procedure = (c.bodacc || []).find((e) => e.nature === 'procedure' && e.sur === 'occupant');
    if (procedure) return { score: 0, exclu: true, partiel: false, raisons: [{ points: 0, texte: `Procédure collective publiée le ${procedure.date} : locataire exclu`, source: 'BODACC', lien: procedure.url }] };
    const raisons = [{ points: 0, texte: 'Aucune procédure collective au BODACC sur 24 mois', source: 'BODACC' }];
    const age = anneesDepuis(o.creation, maintenant);
    if (age != null) {
      if (age >= 10) raisons.push({ points: 20, texte: `Société créée il y a ${Math.floor(age)} ans`, source: 'SIRENE' });
      else if (age >= 5) raisons.push({ points: 10, texte: `Société créée il y a ${Math.floor(age)} ans`, source: 'SIRENE' });
      if (age < m.bailMinAns) raisons.push({ points: -10, texte: `Ancienneté inférieure à la durée ferme des critères (${m.bailMinAns} ans)`, source: 'SIRENE' });
    }
    const f = o.finances || [];
    const partiel = f.length === 0;
    if (partiel) raisons.push({ points: 0, texte: 'Comptes non publiés (confidentiels ou non déposés) : score sur données partielles', source: 'RNE' });
    else {
      const trois = f.slice(0, 3).filter((x) => x.resultat_net != null);
      if (trois.length >= 3 && trois.every((x) => x.resultat_net > 0)) raisons.push({ points: 30, texte: `Résultat net positif sur 3 exercices (${trois.map((x) => x.annee).reverse().join(', ')})`, source: 'Comptes publiés (RNE)' });
      else if (f[0].resultat_net != null && f[0].resultat_net > 0) raisons.push({ points: 15, texte: `Résultat net positif en ${f[0].annee} (${M(f[0].resultat_net)})`, source: 'Comptes publiés (RNE)' });
      else if (f[0].resultat_net != null) raisons.push({ points: 0, texte: `Résultat net négatif en ${f[0].annee} (${M(f[0].resultat_net)})`, source: 'Comptes publiés (RNE)' });
      if (f[1] && f[0].ca && f[1].ca && f[0].ca > f[1].ca) raisons.push({ points: 15, texte: `CA en hausse : ${M(f[1].ca)} en ${f[1].annee}, ${M(f[0].ca)} en ${f[0].annee}`, source: 'Comptes publiés (RNE)' });
      if (f[0].ca >= 10e6) raisons.push({ points: 15, texte: `CA ${M(f[0].ca)} en ${f[0].annee}`, source: 'Comptes publiés (RNE)' });
      else if (f[0].ca >= 2e6) raisons.push({ points: 8, texte: `CA ${M(f[0].ca)} en ${f[0].annee}`, source: 'Comptes publiés (RNE)' });
    }
    const eff = effectifMin(o.effectif_tranche);
    if (eff >= 50) raisons.push({ points: 10, texte: `Effectif : ${effectifLibelle(o.effectif_tranche)}`, source: 'SIRENE' });
    else if (eff >= 10) raisons.push({ points: 5, texte: `Effectif : ${effectifLibelle(o.effectif_tranche)}`, source: 'SIRENE' });
    return { score: total(raisons), exclu: false, partiel, raisons };
  }

  /** Pure : « pourquoi elle vendrait » en une phrase, des signaux les plus forts aux plus faibles. */
  function phraseDe(motivation) {
    const s = motivation.raisons.filter((r) => r.points > 0 && r.court).sort((a, b) => b.points - a.points).slice(0, 3).map((r) => r.court);
    if (!s.length) return 'Aucun signal de vente détecté dans les sources ouvertes.';
    const liste = s.length === 1 ? s[0] : `${s.slice(0, -1).join(', ')} et ${s[s.length - 1]}`;
    return `${liste.charAt(0).toUpperCase()}${liste.slice(1)}.`;
  }

  /** Les trois scores, le global pondere par le mandat et la phrase. */
  function scorer(c, mandat, opts = {}) {
    const m = completer(mandat);
    const fit = scoreFit(c, m);
    const motivation = scoreMotivation(c, opts);
    const locataire = scoreLocataire(c, m, opts);
    const p = m.poids;
    const somme = (p.fit + p.motivation + p.locataire) || 1;
    const exclu = fit.exclu || locataire.exclu;
    const global = exclu ? 0 : Math.round((p.fit * fit.score + p.motivation * motivation.score + p.locataire * locataire.score) / somme);
    return { fit, motivation, locataire, global, exclu, phrase: phraseDe(motivation), signaux: motivation.signaux };
  }

  /** Cash liberable pour un mandat : valeur des murs moins la dette connue, et loyer induit au rendement du mandat. */
  function cashDe(c, mandat) {
    const m = completer(mandat);
    const t = c.totaux;
    if (t.centrale == null) return null;
    // Aucune source ouverte de la dette garantie : « — », jamais deduite en silence.
    return { basse: t.basse, centrale: t.centrale, haute: t.haute, dette: null, loyer: Math.round(t.centrale * (m.rendement / 100)), rendement: m.rendement };
  }

  /**
   * Fusionne les cibles de plusieurs departements : une entreprise presente dans
   * deux departements devient une seule cible avec tous ses murs.
   */
  function fusionner(listes) {
    const rang = { fort: 3, moyen: 2, faible: 1 };
    const parId = new Map();
    for (const c of listes.flat()) {
      const deja = parId.get(c.id);
      if (!deja) { parId.set(c.id, { ...c, murs: [...c.murs], departements: [...c.departements], bodacc: [...c.bodacc] }); continue; }
      const ids = new Set(deja.murs.map((m) => m.id));
      deja.murs.push(...c.murs.filter((m) => !ids.has(m.id)));
      deja.departements = [...new Set([...deja.departements, ...c.departements])];
      const vus = new Set(deja.bodacc.map((e) => e.url || `${e.date}|${e.texte}`));
      deja.bodacc.push(...c.bodacc.filter((e) => !vus.has(e.url || `${e.date}|${e.texte}`)));
      if (rang[c.confiance] > rang[deja.confiance]) deja.confiance = c.confiance;
    }
    for (const c of parId.values()) {
      c.murs.sort((a, b) => ((b.valeur && b.valeur.centrale) || 0) - ((a.valeur && a.valeur.centrale) || 0));
      const v = c.murs.filter((m) => m.valeur);
      c.totaux = { basse: v.reduce((t, m) => t + m.valeur.basse, 0) || null, centrale: v.reduce((t, m) => t + m.valeur.centrale, 0) || null, haute: v.reduce((t, m) => t + m.valeur.haute, 0) || null, murs: c.murs.length, murs_sans_valeur: c.murs.length - v.length, plus_grand: Math.max(0, ...v.map((m) => m.valeur.centrale)) || null };
    }
    return [...parId.values()];
  }

  return { TYPES_ACTIF, POIDS_DEFAUT, MANDAT_DEFAUT, completer, typeActif, effectifMin, effectifLibelle, scoreFit, scoreMotivation, scoreLocataire, phraseDe, scorer, cashDe, fusionner };
}));
