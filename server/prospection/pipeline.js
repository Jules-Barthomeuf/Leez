// Prospection cession-bail : le pipeline d'un departement (V2, 21 oct. 2026).
//
// Ordre des etapes (les filtres gratuits d'abord, les appels d'API ensuite,
// sur les seuls candidats qui restent) :
//   1. DGFiP : les parcelles detenues en pleine propriete par une personne
//      morale privee (groupes « 0 » et « 8 », droit « P »), hors formes
//      publiques (4xxx, 7xxx), bailleurs sociaux, foncieres, credit-bailleurs,
//      SCPI/OPCI reconnus a leur nom, et hors liste noire.
//   2. Cadastre : contour, contenance et emprise batie de chaque parcelle ;
//      surface estimee = emprise x niveaux distincts du fichier DGFiP x part
//      des locaux detenue.
//   3. DVF : prix au m2 des ventes de locaux d'activite autour de la parcelle,
//      rayon croissant 2, 5, 10, 20 km, 5 ans ; fourchette 1er quartile /
//      mediane / 3e quartile ; moins de 5 comparables : pas de valeur (« — »).
//   4. Occupation : les etablissements actifs sur la parcelle (SIRENE) et leur
//      lien avec le proprietaire, chacun avec un niveau de confiance.
//   5. Regroupement : une cible = une entreprise occupante et tous ses murs.
//   6. Enrichissement : comptes, dirigeants, fonds probables, BODACC 24 mois,
//      derniere vente DVF de chaque parcelle.
// Les scores ne sont PAS figes ici : ils dependent du mandat et se calculent
// a la lecture (public/js/prospection-scores.js), au serveur comme au navigateur.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const S = require('./sources');
const geo = require('./geo');
const Scores = require('../../public/js/prospection-scores');

const SORTIE = path.join(S.RACINE, 'out');
fs.mkdirSync(SORTIE, { recursive: true });
const VERSION = 2;

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const quantile = (xs, q) => { const t = [...xs].sort((a, b) => a - b); return t.length ? t[Math.min(t.length - 1, Math.floor(q * (t.length - 1)))] : null; };

// Bailleurs, foncieres, credit-bailleurs et organismes qui ne vendent pas leurs murs en cession-bail
// (ou qui sont deja bailleurs). Reconnus a leur denomination, en plus des groupes publics de la DGFiP.
const EXCLUS_NOM = /\b(SCPI|OPCI|SIIC|FONCIERE|HABITAT|LOGEMENTS?|HLM|SYNDICAT|SYNDIC|COPROPRIETE|COPROPRIETAIRES|ASL|AFUL|ASSOCIATION SYNDICALE|DIOCESAINE|LEASE|LEASING|CREDIT BAIL|CREDIT-BAIL|SOGEFIMUR|FINAMUR|GENEFIM|BATIMAP|NATIOCREDIMURS|FRUCTICOMI|SLIBAIL|ICADE|GECINA|KLEPIERRE|UNIBAIL|CARMILA|MERCIALYS|ARGAN|PATRIMOINE ET COMMERCE|SNCF|RESEAU FERRE|ENEDIS|GRDF|AUTOROUTES?)\b/;
// Activites de l'occupant qui ne font pas un locataire d'exploitation : immobilier, holdings, fonds.
const OCCUPANT_EXCLU = /^(68\.|64\.20|64\.30)/;

function lireListeNoire() {
  try {
    const l = JSON.parse(fs.readFileSync(path.join(__dirname, 'liste-noire.json'), 'utf8'));
    return { sirens: new Set(l.sirens || []), noms: (l.noms || []).map(norm).filter(Boolean) };
  } catch { return { sirens: new Set(), noms: [] }; }
}
const enListeNoire = (ln, siren, nom) => ln.sirens.has(siren) || ln.noms.some((n) => norm(nom).includes(n));

/** Pure : l'adresse lisible d'un local DGFiP. */
function adresseDgfip(c) {
  const num = String(c[S.COL.numero] || '').replace(/^0+/, '');
  return [num ? `${num}${c[S.COL.indice] || ''}` : '', c[S.COL.natureVoie], c[S.COL.nomVoie]].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Pure : l'adresse d'un etablissement SIRENE correspond-elle au numero et au nom de voie DGFiP ? */
function memeAdresse(adresseSirene, numero, voie) {
  const a = ` ${norm(adresseSirene)} `;
  const n = String(numero || '').replace(/^0+/, '');
  const v = norm(voie);
  if (!n || v.length < 4) return false;
  return a.includes(` ${n} `) && a.includes(v);
}

// Les commissaires aux comptes figurent parmi les « dirigeants » du registre : un meme cabinet
// relierait a tort des societes sans rapport, et l'age d'un commissaire n'est pas celui d'un
// dirigeant. On ne retire que les vrais controleurs (audit du 21 oct. 2026 sur le 06) :
//   - toute personne dont la QUALITE est commissaire, controleur ou auditeur ;
//   - une SOCIETE au nom de cabinet d'audit sans fonction de direction (« Autre », vide...).
// Une personne physique qui s'appelle Ernst ou Mazars, ou la holding d'un groupe comptable qui
// preside sa SCI, restent des dirigeants.
const CONTROLEUR_QUALITE = /commissaire|contr[oô]leur|auditeur/i;
const CONTROLEUR_NOM = /\b(AUDIT|COMMISSAIRES? AUX COMPTES|KPMG|DELOITTE|ERNST|PRICEWATERHOUSE|PWC|MAZARS|GRANT THORNTON|BDO|RSM|EXCO|FIDUCIAIRE|EXPERTISE COMPTABLE|EXPERTS? COMPTABLES?)\b/;
const FONCTION_DIRECTION = /pr[ée]sident|g[ée]rant|directeur|associ[ée] ind[ée]finiment|liquidateur/i;
function estControleur(d) {
  if (CONTROLEUR_QUALITE.test(d.qualite || '')) return true;
  const pm = d.type_dirigeant === 'personne morale';
  return pm && CONTROLEUR_NOM.test(norm(d.denomination || d.nom)) && !FONCTION_DIRECTION.test(d.qualite || '');
}
const vraisDirigeants = (liste) => (liste || []).filter((d) => !estControleur(d));

// Un fonds d'investissement au conseil ou a la presidence : signal fort de cession (sortie a preparer).
// Repere au nom du dirigeant personne morale, jamais certain : affiche « probable ».
const FONDS_NOMS = /\b(CAPITAL|EQUITY|PARTNERS|FUND|FONDS|PRIVATE|LBO|MEZZANINE|ARDIAN|EURAZEO|WENDEL|TIKEHAU|IDI|SIPAREX|BPIFRANCE|CAPZA|ANDERA|NAXICAP|IRDI|UNIGRAINS|AZULIS|ACTIVA|EMZ|KEENSIGHT|APAX|CINVEN|KKR|CVC|ARGOS|ABENEX|CEREA|SOCADIF|IXO|TURENNE|EXTENS|PARQUEST|MONTEFIORE|SAGARD|NAXICAP|CREADEV|ESFIN|GARIBALDI|INITIATIVE ET FINANCE|SOFIMAC|SIGMA GESTION)\b/;
function fondsProbables(dirigeants, noms) {
  const premiers = new Set(noms.map((n) => norm(n).split(' ').find((m) => m.length > 3)).filter(Boolean));
  return vraisDirigeants(dirigeants).filter((d) => d.type_dirigeant === 'personne morale' && FONDS_NOMS.test(norm(d.denomination || d.nom))
    // La holding du groupe (meme premier mot que la societe) n'est pas un fonds tiers.
    && !premiers.has(norm(d.denomination || d.nom).split(' ').find((m) => m.length > 3)));
}

const cleDirigeant = (d) => `${norm(d.nom)}|${norm(String(d.prenoms || '').split(/[ ,]/)[0])}`;

/**
 * Pure : le lien entre le proprietaire des murs et une societe installee sur
 * la parcelle, du plus fort au plus faible. Rend null s'il n'y en a pas.
 * `structurel` : le lien passe par les SIREN (meme societe, ou l'une dirige l'autre).
 */
function lienOccupation(proprietaire, occupant) {
  if (!proprietaire || !occupant) return null;
  if (proprietaire.siren === occupant.siren) return { type: 'meme_siren', structurel: true, motif: 'Le propriétaire exploite lui-même le site (même SIREN)' };
  const dP = vraisDirigeants(proprietaire.dirigeants);
  const dO = vraisDirigeants(occupant.dirigeants);
  if (dP.some((d) => d.siren && d.siren === occupant.siren)) return { type: 'gerant_sci', structurel: true, motif: `${occupant.nom_complet} dirige la société propriétaire` };
  if (dO.some((d) => d.siren && d.siren === proprietaire.siren)) return { type: 'proprietaire_dirige', structurel: true, motif: `La société propriétaire dirige ${occupant.nom_complet}` };
  const holding = dP.find((d) => d.siren && dO.some((x) => x.siren === d.siren));
  if (holding) return { type: 'holding_commune', structurel: false, motif: `Même société dirigeante : ${holding.denomination || holding.siren}`, preuve: holding.siren };
  // Personne commune : meme nom et premier prenom. Deux annees de naissance publiees et differentes : homonymes, pas de lien.
  const pp = new Map(dP.filter((d) => d.type_dirigeant !== 'personne morale' && d.nom).map((d) => [cleDirigeant(d), d]));
  let faible = null;
  for (const d of dO.filter((x) => x.type_dirigeant !== 'personne morale' && x.nom)) {
    const autre = pp.get(cleDirigeant(d));
    if (!autre) continue;
    const nom = [String(d.prenoms || '').split(/[ ,]/)[0], d.nom].filter(Boolean).join(' ');
    if (d.annee_de_naissance && autre.annee_de_naissance) {
      if (String(d.annee_de_naissance) === String(autre.annee_de_naissance)) return { type: 'dirigeant_commun', structurel: false, annee_verifiee: true, motif: `Dirigeant commun : ${nom}, né en ${d.annee_de_naissance}` };
      continue;
    }
    faible = faible || { type: 'dirigeant_commun', structurel: false, annee_verifiee: false, motif: `Dirigeant commun : ${nom} (même nom, année de naissance non publiée)` };
  }
  return faible;
}

/**
 * Pure : le niveau de confiance d'un lien d'occupation (spec V2).
 *   fort  : lien structurel et etablissement dans la parcelle (ou a son adresse) ;
 *   moyen : lien structurel a proximite, ou holding / dirigeant verifie dans la parcelle ;
 *   faible: le reste (dirigeant sans annee de naissance, ou etablissement seulement proche).
 */
function confianceDe(lien, dansLaParcelle) {
  if (lien.structurel && dansLaParcelle) return 'fort';
  if (lien.structurel) return 'moyen';
  if (dansLaParcelle && (lien.type === 'holding_commune' || lien.annee_verifiee)) return 'moyen';
  return 'faible';
}
const RANG_CONFIANCE = { fort: 3, moyen: 2, faible: 1 };

/** Pure : un dirigeant de l'API en ligne de sortie (age calcule depuis l'annee de naissance publiee). */
function dirigeantDe(d, annee = new Date().getFullYear()) {
  const pm = d.type_dirigeant === 'personne morale';
  const an = parseInt(d.annee_de_naissance, 10);
  return {
    nom: pm ? (d.denomination || d.nom || null) : [d.prenoms ? String(d.prenoms).split(/[ ,]/)[0] : null, d.nom].filter(Boolean).join(' '),
    qualite: d.qualite || null,
    personne_morale: pm,
    siren: d.siren || null,
    annee_naissance: Number.isFinite(an) ? an : null,
    age: Number.isFinite(an) ? annee - an : null,
    source: "RNE (API Recherche d'entreprises)",
  };
}

/** Pure : une annonce BODACC en evenement type. */
function evenementBodacc(r, sur) {
  const famille = String(r.familleavis_lib || '');
  let nature = 'autre';
  let texte = famille;
  if (/proc.dures? (collectives?|de r.tablissement)/i.test(famille)) {
    nature = 'procedure';
    try { const j = JSON.parse(r.jugement || 'null'); if (j && j.nature) texte = j.nature; } catch { /* texte par defaut */ }
  } else if (/ventes? et cessions?/i.test(famille)) nature = 'cession';
  else if (/radiation/i.test(famille)) nature = 'radiation';
  else if (/modifications/i.test(famille)) {
    let desc = '';
    try { const j = JSON.parse(r.modificationsgenerales || 'null'); desc = (j && j.descriptif) || ''; } catch { desc = String(r.modificationsgenerales || ''); }
    texte = desc ? desc.slice(0, 200) : famille;
    if (/dirigeant|g.rant|pr.sident|administrateur|directeur g.n.ral/i.test(desc)) nature = 'dirigeant';
    else if (/capital/i.test(desc)) nature = 'capital';
    else nature = 'modification';
  } else if (/d.p.ts? des comptes/i.test(famille)) nature = 'comptes';
  else if (/immatriculation/i.test(famille)) nature = 'immatriculation';
  return { date: r.dateparution, famille, nature, texte, sur, url: r.id ? `https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:${r.id}` : null, source: 'BODACC (DILA)' };
}

/** Pure : les comptes publies de l'API en liste triee (le plus recent d'abord). */
const financesDe = (f) => Object.entries(f || {}).map(([annee, v]) => ({ annee, ca: v && v.ca != null ? v.ca : null, resultat_net: v && v.resultat_net != null ? v.resultat_net : null })).sort((a, b) => b.annee.localeCompare(a.annee));

/** Pure : un contour GeoJSON allege (6 decimales, ~10 cm) pour la carte de la fiche. */
const contourDe = (g) => {
  const a = g && (g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : null);
  return a ? a.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]) : null;
};

/**
 * Pure : la valeur d'un mur d'apres les ventes DVF comparables, rayon
 * croissant autour de la parcelle. Moins de 5 comparables a 20 km : null.
 */
const RAYONS_KM = [2, 5, 10, 20];
function evaluerMur(surface, centre, comparables, { min = 5, date = null } = {}) {
  if (!surface || !centre) return null;
  const avecDistance = comparables.filter((c) => c.pt).map((c) => ({ ...c, d: geo.distance(c.pt, centre) }));
  for (const rayon of RAYONS_KM) {
    const pool = avecDistance.filter((c) => c.d <= rayon * 1000);
    if (pool.length < min) continue;
    const pm2 = pool.map((c) => c.pm2);
    const q1 = quantile(pm2, 0.25); const med = quantile(pm2, 0.5); const q3 = quantile(pm2, 0.75);
    return {
      basse: Math.round(surface * q1), centrale: Math.round(surface * med), haute: Math.round(surface * q3),
      prix_m2: { q1: Math.round(q1), mediane: Math.round(med), q3: Math.round(q3) },
      n_comparables: pool.length, rayon_km: rayon,
      comparables: pool.sort((a, b) => a.d - b.d).slice(0, 8).map((c) => ({ date: c.date, prix: c.valeur, surface: c.surface, pm2: Math.round(c.pm2), adresse: c.adresse, distance_m: Math.round(c.d), lat: c.pt[1], lon: c.pt[0] })),
      methode: 'surface estimée × prix au m² des ventes DVF de locaux d\'activité (1er quartile, médiane, 3e quartile)',
      source: S.SOURCES.dvf.nom, date,
    };
  }
  return null;
}

/** Pure : les totaux d'une cible (somme de ses murs ; un mur sans valeur ne compte pas). */
function totauxDe(murs) {
  const v = murs.filter((m) => m.valeur);
  return {
    basse: v.reduce((t, m) => t + m.valeur.basse, 0) || null,
    centrale: v.reduce((t, m) => t + m.valeur.centrale, 0) || null,
    haute: v.reduce((t, m) => t + m.valeur.haute, 0) || null,
    murs: murs.length, murs_sans_valeur: murs.length - v.length,
    plus_grand: Math.max(0, ...v.map((m) => m.valeur.centrale)) || null,
  };
}

// Ne garder des reponses d'API que ce que le pipeline lit : la reponse brute de near_point
// (100 societes par parcelle, finances et dirigeants compris) faisait depasser 500 Mo au cache
// du 06, au-dela de la taille maximale d'une chaine JavaScript.
const garder = (o, champs) => { const r = {}; for (const c of champs) if (o[c] !== undefined && o[c] !== null) r[c] = o[c]; return r; };
const CHAMPS_ENTREPRISE = ['siren', 'nom_complet', 'nature_juridique', 'activite_principale', 'tranche_effectif_salarie', 'categorie_entreprise', 'date_creation', 'nombre_etablissements_ouverts', 'finances'];
const CHAMPS_DIRIGEANT = ['type_dirigeant', 'nom', 'prenoms', 'annee_de_naissance', 'qualite', 'siren', 'denomination'];
const CHAMPS_ETAB = ['siret', 'adresse', 'latitude', 'longitude', 'activite_principale', 'etat_administratif', 'est_siege', 'tranche_effectif_salarie', 'date_creation', 'date_debut_activite'];
const CHAMPS_BODACC = ['id', 'dateparution', 'familleavis_lib', 'jugement', 'modificationsgenerales'];
function compacterEntreprise(e) {
  if (!e) return e;
  return {
    ...garder(e, CHAMPS_ENTREPRISE),
    siege: e.siege ? { adresse: e.siege.adresse || null } : null,
    dirigeants: (e.dirigeants || []).map((d) => garder(d, CHAMPS_DIRIGEANT)),
    matching_etablissements: (e.matching_etablissements || []).filter((x) => x.etat_administratif === 'A').map((x) => garder(x, CHAMPS_ETAB)),
  };
}
function compacter(cle, v) {
  if (cle.startsWith('n:')) return (v || []).map(compacterEntreprise);
  if (cle.startsWith('e:')) return compacterEntreprise(v);
  if (cle.startsWith('b:')) return (v || []).map((r) => garder(r, CHAMPS_BODACC));
  return v;
}

/**
 * Cache disque des reponses d'API (30 jours), en NDJSON : une ligne par reponse,
 * ajoutee au fil de l'eau (reprise apres interruption, jamais de reecriture
 * geante). Lu ligne a ligne au demarrage ; la derniere ligne d'une cle l'emporte.
 * L'ancien format (un seul objet JSON) est converti une fois.
 */
async function cacheApi(dept) {
  const chemin = path.join(S.CACHE, `api-${dept}.ndjson`);
  const ancien = path.join(S.CACHE, `api-${dept}.json`);
  const TTL = 30 * 86400000;
  const data = new Map();
  if (!fs.existsSync(chemin) && fs.existsSync(ancien)) {
    const o = JSON.parse(fs.readFileSync(ancien, 'utf8'));
    const out = fs.openSync(`${chemin}.part`, 'w');
    for (const [k, { le, v }] of Object.entries(o)) fs.writeSync(out, `${JSON.stringify({ k, le, v: compacter(k, v) })}\n`);
    fs.closeSync(out);
    fs.renameSync(`${chemin}.part`, chemin);
    fs.unlinkSync(ancien);
  }
  if (fs.existsSync(chemin)) {
    const rl = readline.createInterface({ input: fs.createReadStream(chemin), crlfDelay: Infinity });
    for await (const l of rl) {
      if (!l) continue;
      try { const { k, le, v } = JSON.parse(l); data.set(k, { le, v }); } catch { /* ligne tronquee par un arret brutal */ }
    }
  }
  const fd = fs.openSync(chemin, 'a');
  return {
    async lire(cle, travail) {
      const d = data.get(cle);
      if (d && Date.now() - Date.parse(d.le) < TTL) return d.v;
      const v = compacter(cle, await travail());
      const le = new Date().toISOString();
      data.set(cle, { le, v });
      fs.writeSync(fd, `${JSON.stringify({ k: cle, le, v })}\n`);
      return v;
    },
    fermer() { fs.closeSync(fd); },
  };
}

async function parLots(items, n, f) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await f(items[k], k); }
  }));
}

// ---------------------------------------------------------------------------
// Le pipeline
// ---------------------------------------------------------------------------

/**
 * @param {string} dept - « 06 », « 2A », « 971 »
 * @param {{murMin?:number, murMax?:number, maxCandidats?:number, progres?:Function, journal?:Function}} opts
 *   murMin / murMax : la plage de valeur d'un mur pour qu'on verifie son occupation (les
 *   mandats filtrent ensuite sur la valeur totale de l'entreprise). Par defaut 2,5 a 60 M€.
 */
async function lancer(dept, { murMin = 2.5e6, murMax = 60e6, maxCandidats = 4000, progres = () => {}, journal = () => {} } = {}) {
  const t0 = Date.now();
  const lu = S.aujourdhui();
  const stats = { version: VERSION, departement: dept, lance_le: new Date().toISOString(), plage_mur: [murMin, murMax] };
  const etape = (cle, message, fait = null, totalEtape = null) => { progres({ etape: cle, message, fait, total: totalEtape }); journal(message); };
  const listeNoire = lireListeNoire();

  // --- 1. DGFiP -------------------------------------------------------------
  etape('dgfip', 'Lecture du fichier DGFiP des personnes morales…');
  const parcelles = new Map();
  const portefeuille = new Map();
  let lignes = 0;
  for await (const c of S.lignesDgfip(dept, { journal })) {
    lignes += 1;
    if (lignes % 50000 === 0) etape('dgfip', `DGFiP : ${lignes.toLocaleString('fr-FR')} locaux lus…`);
    const commune = c[S.COL.commune];
    const section = String(c[S.COL.section] || '').padStart(2, '0');
    const plan = String(c[S.COL.plan] || '').padStart(4, '0');
    if (!commune || !section.trim() || !plan) continue;
    const insee = S.inseeDe(dept, commune);
    const id = `${insee}${(c[S.COL.prefixe] || '000').padStart(3, '0')}${section.replace(/ /g, '0')}${plan}`;
    let p = parcelles.get(id);
    if (!p) {
      p = { id, insee, commune: c[S.COL.nomCommune], adresse: adresseDgfip(c), numero: c[S.COL.numero], voie: c[S.COL.nomVoie], locaux: 0, niveaux: new Set(), proprietaires: new Map() };
      parcelles.set(id, p);
    }
    p.locaux += 1;
    if (c[S.COL.niveau]) p.niveaux.add(c[S.COL.niveau]);
    const siren = c[S.COL.siren];
    const groupe = String(c[S.COL.groupe] || '').trim()[0];
    const droit = String(c[S.COL.droit] || '').trim()[0];
    if (!siren || !/^\d{9}$/.test(siren)) continue;
    const o = p.proprietaires.get(siren) || { siren, nom: c[S.COL.nom], forme: c[S.COL.formeAbregee], forme_code: c[S.COL.forme], groupe: c[S.COL.groupe], droit: c[S.COL.droit], locaux: 0, prive: (groupe === '0' || groupe === '8') && droit === 'P' };
    o.locaux += 1;
    p.proprietaires.set(siren, o);
  }
  for (const p of parcelles.values()) for (const s of p.proprietaires.keys()) portefeuille.set(s, (portefeuille.get(s) || 0) + 1);
  const retenues = [];
  const exclus = { public_ou_bailleur: 0, liste_noire: 0 };
  for (const p of parcelles.values()) {
    for (const o of p.proprietaires.values()) {
      if (!o.prive) continue;
      // Formes 4xxx et 7xxx : personnes morales de droit public, parfois classees en groupe « 0 ».
      if (/^[47]/.test(o.forme_code || '') || EXCLUS_NOM.test(norm(o.nom))) { exclus.public_ou_bailleur += 1; continue; }
      if (enListeNoire(listeNoire, o.siren, o.nom)) { exclus.liste_noire += 1; continue; }
      retenues.push({ parcelle: p, proprietaire: { ...o, part: o.locaux / p.locaux, parcelles_departement: portefeuille.get(o.siren) } });
    }
  }
  stats.dgfip = { locaux_lus: lignes, parcelles: parcelles.size, couples_prives: retenues.length, exclus, source: S.SOURCES.dgfip.nom, millesime: S.SOURCES.dgfip.millesime };
  etape('dgfip', `DGFiP : ${lignes.toLocaleString('fr-FR')} locaux, ${retenues.length.toLocaleString('fr-FR')} couples parcelle × propriétaire privé.`);

  // --- 2. Cadastre ------------------------------------------------------------
  const parCommune = new Map();
  for (const r of retenues) {
    if (!parCommune.has(r.parcelle.insee)) parCommune.set(r.parcelle.insee, new Set());
    parCommune.get(r.parcelle.insee).add(r.parcelle.id);
  }
  const communes = [...parCommune.keys()];
  let faites = 0;
  let sansGeo = 0;
  await parLots(communes, 3, async (insee) => {
    const ids = parCommune.get(insee);
    try {
      const feats = (await S.cadastreCommune(insee, 'parcelles')).filter((f) => ids.has(f.id));
      const geom = new Map();
      for (const f of feats) {
        geom.set(f.id, { geometrie: f.geometry, contenance: f.properties && f.properties.contenance ? Number(f.properties.contenance) : Math.round(geo.aire(f.geometry)), centre: geo.centroide(f.geometry), emprise: 0, batiments: 0 });
      }
      if (geom.size) {
        const index = geo.indexer([...geom.entries()], ([, g]) => g.geometrie);
        for (const b of await S.cadastreCommune(insee, 'batiments')) {
          const c = geo.centroide(b.geometry);
          if (!c) continue;
          const hit = index.candidats(c).find(([, g]) => geo.contient(g.geometrie, c));
          if (hit) { hit[1].emprise += geo.aire(b.geometry); hit[1].batiments += 1; }
        }
      }
      for (const id of ids) {
        const p = parcelles.get(id);
        const g = geom.get(id);
        if (g) p.geo = g; else sansGeo += 1;
      }
    } catch (e) {
      journal(`Cadastre ${insee} : ${e.message}`);
    }
    faites += 1;
    if (faites % 5 === 0 || faites === communes.length) etape('cadastre', `Cadastre : ${faites}/${communes.length} communes`, faites, communes.length);
  });
  stats.cadastre = { communes: communes.length, parcelles_sans_geometrie: sansGeo, source: S.SOURCES.cadastre.nom, lu_le: lu };

  const avecSurface = [];
  for (const r of retenues) {
    const g = r.parcelle.geo;
    if (!g || g.emprise < 50) continue;
    const niveaux = Math.max(1, Math.min(10, r.parcelle.niveaux.size));
    const surface = Math.round(g.emprise * niveaux * Math.min(1, r.proprietaire.part));
    avecSurface.push({ ...r, surface, niveaux });
  }
  etape('cadastre', `Cadastre : ${avecSurface.length.toLocaleString('fr-FR')} parcelles bâties détenues par une société privée.`);

  // --- 3. DVF -----------------------------------------------------------------
  etape('dvf', 'DVF : lecture des ventes du département…');
  const voulues = new Set(avecSurface.map((r) => r.parcelle.id));
  const mutations = new Map();
  const achats = new Map();
  let lignesDvf = 0;
  for await (const l of S.lignesDvf(dept, { journal })) {
    lignesDvf += 1;
    if (l.id_parcelle && voulues.has(l.id_parcelle) && l.nature_mutation === 'Vente') {
      const a = achats.get(l.id_parcelle) || new Map();
      a.set(l.id_mutation, { date: l.date_mutation, prix: Number(l.valeur_fonciere) || null, type: l.type_local || l.nature_culture || null, id_mutation: l.id_mutation });
      achats.set(l.id_parcelle, a);
    }
    let m = mutations.get(l.id_mutation);
    if (!m) {
      m = { date: l.date_mutation, nature: l.nature_mutation, valeur: Number(l.valeur_fonciere) || 0, lon: Number(l.longitude), lat: Number(l.latitude), surface: 0, locaux: 0, autres: false,
        adresse: [l.adresse_numero, l.adresse_suffixe, l.adresse_nom_voie].filter(Boolean).join(' ') + (l.nom_commune ? `, ${l.nom_commune}` : '') };
      mutations.set(l.id_mutation, m);
    }
    if (l.type_local === 'Local industriel. commercial ou assimilé') { m.surface += Number(l.surface_reelle_bati) || 0; m.locaux += 1; } else if (l.type_local === 'Appartement' || l.type_local === 'Maison') m.autres = true;
  }
  const comparables = [];
  for (const m of mutations.values()) {
    if (m.nature !== 'Vente' || !m.locaux || m.autres || m.surface < 100 || !m.valeur) continue;
    const pm2 = m.valeur / m.surface;
    if (pm2 < 150 || pm2 > 15000) continue;
    comparables.push({ pm2, valeur: m.valeur, surface: m.surface, date: m.date, adresse: m.adresse, pt: Number.isFinite(m.lon) && Number.isFinite(m.lat) && m.lon ? [m.lon, m.lat] : null });
  }
  mutations.clear();
  const annees = S.anneesDvf();
  stats.dvf = { lignes: lignesDvf, ventes_comparables: comparables.length, mediane_departement: Math.round(quantile(comparables.map((c) => c.pm2), 0.5) || 0), annees: `${annees[0]}-${annees[annees.length - 1]}`, source: S.SOURCES.dvf.nom };
  etape('dvf', `DVF : ${comparables.length} ventes de locaux d'activité comparables, médiane ${stats.dvf.mediane_departement} €/m².`);
  if (!comparables.length) throw new Error(`Aucune vente DVF de local d'activité exploitable pour le département ${dept} (DVF ne couvre pas l'Alsace-Moselle ni Mayotte).`);

  let sansValeur = 0;
  let candidats = [];
  for (const r of avecSurface) {
    const valeur = evaluerMur(r.surface, r.parcelle.geo.centre, comparables, { date: lu });
    if (!valeur) { sansValeur += 1; continue; }
    if (valeur.centrale >= murMin && valeur.centrale <= murMax) candidats.push({ ...r, valeur });
  }
  candidats.sort((a, b) => b.valeur.centrale - a.valeur.centrale);
  stats.valeur = { dans_la_plage: candidats.length, sans_comparables: sansValeur };
  if (candidats.length > maxCandidats) { stats.valeur.tronques = candidats.length - maxCandidats; candidats = candidats.slice(0, maxCandidats); }
  etape('valeur', `Valeur : ${candidats.length} murs entre ${murMin / 1e6} et ${murMax / 1e6} M€ (${sansValeur} sans 5 comparables à 20 km).`);

  // --- 4. Occupation (API) ----------------------------------------------------
  const cache = await cacheApi(dept);
  const entreprise = (siren) => cache.lire(`e:${siren}`, () => S.entreprise(siren));
  const murs = [];
  const rejets = { pas_d_occupant_lie: 0, occupant_immobilier: 0, fonciere: 0, liste_noire: 0, erreur: 0 };
  let fait = 0;
  await parLots(candidats, 3, async (r) => {
    try {
      const g = r.parcelle.geo;
      const rayon = Math.max(0.05, Math.min(0.35, Math.sqrt(g.contenance || 1000) / 1000 * 0.7 + 0.04));
      const autour = await cache.lire(`n:${r.parcelle.id}`, () => S.entreprisesAutour(g.centre[1], g.centre[0], Number(rayon.toFixed(3))));
      const surPlace = [];
      for (const ent of autour) {
        for (const e of ent.matching_etablissements || []) {
          if (e.etat_administratif !== 'A') continue;
          const pt = e.longitude && e.latitude ? [Number(e.longitude), Number(e.latitude)] : null;
          const dans = (pt && geo.contient(g.geometrie, pt)) || memeAdresse(e.adresse, r.parcelle.numero, r.parcelle.voie);
          const proche = pt && geo.distance(pt, g.centre) <= Math.max(50, Math.sqrt(g.contenance || 0) / 2);
          if (dans || proche) surPlace.push({ ent, etab: e, dans: !!dans });
        }
      }
      const proprio = autour.find((x) => x.siren === r.proprietaire.siren) || await entreprise(r.proprietaire.siren);
      let meilleur = null;
      for (const s of surPlace) {
        if (OCCUPANT_EXCLU.test(s.etab.activite_principale || s.ent.activite_principale || '') || String(s.ent.nature_juridique) === '6540' || /^[47]/.test(String(s.ent.nature_juridique || ''))) continue;
        const lien = lienOccupation(proprio || { siren: r.proprietaire.siren, dirigeants: [] }, s.ent);
        if (!lien) continue;
        const confiance = confianceDe(lien, s.dans);
        const rang = RANG_CONFIANCE[confiance] * 1e6 + (lien.structurel ? 1e5 : 0) + (Scores.effectifMin(s.etab.tranche_effectif_salarie || s.ent.tranche_effectif_salarie) || 0);
        if (!meilleur || rang > meilleur.rang) meilleur = { ...s, lien, confiance, rang };
      }
      if (!meilleur) {
        if (surPlace.some((s) => s.ent.siren === r.proprietaire.siren)) rejets.occupant_immobilier += 1; else rejets.pas_d_occupant_lie += 1;
        return;
      }
      if (enListeNoire(listeNoire, meilleur.ent.siren, meilleur.ent.nom_complet)) { rejets.liste_noire += 1; return; }
      const apeProprio = (proprio && proprio.activite_principale) || '';
      if (/^68\./.test(apeProprio) && r.proprietaire.parcelles_departement >= 25 && meilleur.lien.type !== 'meme_siren') { rejets.fonciere += 1; return; }

      const ach = [...(achats.get(r.parcelle.id) || new Map()).values()].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
      murs.push({ r, g, proprio, apeProprio, meilleur, ach });
    } catch (e) {
      rejets.erreur += 1;
      journal(`${r.parcelle.id} : ${e.message}`);
    } finally {
      fait += 1;
      if (fait % 10 === 0 || fait === candidats.length) etape('occupation', `Occupation : ${fait}/${candidats.length} murs vérifiés, ${murs.length} occupés par leur propriétaire`, fait, candidats.length);
    }
  });

  // --- 5. Regroupement par entreprise occupante, 6. enrichissement ------------
  const parEntreprise = new Map();
  for (const m of murs) {
    const k = m.meilleur.ent.siren;
    if (!parEntreprise.has(k)) parEntreprise.set(k, []);
    parEntreprise.get(k).push(m);
  }
  const depuis = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
  const groupes = [...parEntreprise.values()];
  const cibles = [];
  let enrichies = 0;
  await parLots(groupes, 3, async (liste) => {
    try {
      // Le mur principal (le plus grand) porte l'etablissement et la position de la cible.
      liste.sort((a, b) => b.r.valeur.centrale - a.r.valeur.centrale);
      const occ = liste[0].meilleur.ent;
      const sirensProprio = [...new Set(liste.map((m) => m.r.proprietaire.siren))];
      const bodacc = [];
      const evO = await cache.lire(`b:${occ.siren}:${depuis}`, () => S.annoncesBodacc(occ.siren, depuis));
      bodacc.push(...evO.map((x) => evenementBodacc(x, 'occupant')));
      for (const s of sirensProprio.filter((x) => x !== occ.siren)) {
        const evP = await cache.lire(`b:${s}:${depuis}`, () => S.annoncesBodacc(s, depuis));
        bodacc.push(...evP.map((x) => evenementBodacc(x, 'proprietaire')));
      }
      const vus = new Set();
      const bodaccUniques = bodacc.filter((e) => { const k = e.url || `${e.date}|${e.texte}`; if (vus.has(k)) return false; vus.add(k); return true; })
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));

      const mursSortie = liste.map(({ r, g, proprio, apeProprio, meilleur, ach }) => ({
        id: `${r.parcelle.id}-${r.proprietaire.siren}`,
        departement: dept,
        parcelle: {
          id: r.parcelle.id, insee: r.parcelle.insee, commune: r.parcelle.commune, adresse: r.parcelle.adresse,
          lat: g.centre[1], lon: g.centre[0], contour: contourDe(g.geometrie), contenance_m2: g.contenance, emprise_batie_m2: Math.round(g.emprise), batiments: g.batiments,
          niveaux: r.niveaux, locaux: r.parcelle.locaux, part_detenue: Number(r.proprietaire.part.toFixed(2)), surface_estimee_m2: r.surface,
          source: `${S.SOURCES.dgfip.nom} ${S.SOURCES.dgfip.millesime} ; ${S.SOURCES.cadastre.nom}`, date: lu,
        },
        proprietaire: {
          siren: r.proprietaire.siren, nom: (proprio && proprio.nom_complet) || r.proprietaire.nom, forme: r.proprietaire.forme, groupe: r.proprietaire.groupe,
          ape: apeProprio || null, creation: (proprio && proprio.date_creation) || null, parcelles_departement: r.proprietaire.parcelles_departement,
          siege: proprio && proprio.siege ? proprio.siege.adresse : null,
          dirigeants: vraisDirigeants(proprio && proprio.dirigeants).map((d) => dirigeantDe(d)),
          source: `${S.SOURCES.dgfip.nom} ; ${S.SOURCES.annuaire.nom}`, date: lu,
        },
        lien: { type: meilleur.lien.type, motif: meilleur.lien.motif, confiance: meilleur.confiance, dans_la_parcelle: meilleur.dans },
        etablissement: { siret: meilleur.etab.siret, adresse: meilleur.etab.adresse, ape: meilleur.etab.activite_principale || null, effectif_tranche: meilleur.etab.tranche_effectif_salarie || null, est_siege: !!meilleur.etab.est_siege, debut: meilleur.etab.date_debut_activite || meilleur.etab.date_creation || null },
        type_actif: Scores.typeActif(meilleur.etab.activite_principale || occ.activite_principale),
        valeur: r.valeur,
        achat: ach ? { date: ach.date, prix: ach.prix, type: ach.type, source: S.SOURCES.dvf.nom, note: 'Valeur foncière de la mutation entière (peut couvrir plusieurs parcelles)' } : null,
      }));
      const nomsGroupe = [occ.nom_complet, ...liste.map((m) => (m.proprio && m.proprio.nom_complet) || m.r.proprietaire.nom)];
      const fonds = [
        ...fondsProbables(occ.dirigeants, nomsGroupe).map((d) => ({ nom: d.denomination || d.nom, siren: d.siren || null, qualite: d.qualite || null, sur: 'occupant' })),
        ...liste.flatMap((m) => fondsProbables(m.proprio && m.proprio.dirigeants, nomsGroupe).map((d) => ({ nom: d.denomination || d.nom, siren: d.siren || null, qualite: d.qualite || null, sur: 'proprietaire' }))),
      ].filter((f, i, t) => t.findIndex((x) => x.nom === f.nom) === i);
      const principal = mursSortie[0];
      cibles.push({
        id: occ.siren,
        version: VERSION,
        departements: [dept],
        nom: occ.nom_complet,
        type_actif: principal.type_actif,
        lat: principal.parcelle.lat, lon: principal.parcelle.lon,
        confiance: mursSortie.reduce((m, x) => (RANG_CONFIANCE[x.lien.confiance] > RANG_CONFIANCE[m] ? x.lien.confiance : m), 'faible'),
        occupant: {
          siren: occ.siren, nom: occ.nom_complet, ape: principal.etablissement.ape || occ.activite_principale, categorie: occ.categorie_entreprise || null,
          effectif_tranche: occ.tranche_effectif_salarie || null, creation: occ.date_creation || null, nature_juridique: occ.nature_juridique,
          siege: occ.siege ? occ.siege.adresse : null, etablissements_ouverts: occ.nombre_etablissements_ouverts ?? null,
          finances: financesDe(occ.finances), dirigeants: vraisDirigeants(occ.dirigeants).map((d) => dirigeantDe(d)),
          source: S.SOURCES.annuaire.nom, date: lu,
        },
        murs: mursSortie,
        totaux: totauxDe(mursSortie),
        fonds,
        bodacc: bodaccUniques,
        bodacc_lu: { depuis, source: S.SOURCES.bodacc.nom, date: lu },
      });
    } catch (e) {
      rejets.erreur += 1;
      journal(`Enrichissement ${liste[0] && liste[0].meilleur.ent.siren} : ${e.message}`);
    } finally {
      enrichies += 1;
      if (enrichies % 10 === 0 || enrichies === groupes.length) etape('enrichissement', `Enrichissement : ${enrichies}/${groupes.length} entreprises`, enrichies, groupes.length);
    }
  });
  cache.fermer();
  for (const c of cibles) c.scores_defaut = Scores.scorer(c);
  cibles.sort((a, b) => b.scores_defaut.global - a.scores_defaut.global);
  const parConfiance = { fort: 0, moyen: 0, faible: 0 };
  for (const c of cibles) parConfiance[c.confiance] += 1;
  stats.occupation = { verifies: candidats.length, murs_occupes: murs.length, cibles: cibles.length, confiance: parConfiance, rejets };
  stats.duree_s = Math.round((Date.now() - t0) / 1000);
  stats.fini_le = new Date().toISOString();

  const resultat = { stats, cibles };
  fs.writeFileSync(path.join(SORTIE, `${dept}.json`), JSON.stringify(resultat));
  fs.writeFileSync(path.join(SORTIE, `${dept}.csv`), enCsv(cibles));
  etape('fini', `Terminé : ${cibles.length} entreprises (${murs.length} murs) en ${stats.duree_s < 90 ? `${stats.duree_s} s` : `${Math.round(stats.duree_s / 60)} min`}.`);
  return resultat;
}

// ---------------------------------------------------------------------------
// CSV : une ligne par mur, chaque donnee avec sa source et sa date
// ---------------------------------------------------------------------------
function enCsv(cibles, mandat = null) {
  const lignes = [];
  for (const c of cibles) {
    const s = Scores.scorer(c, mandat || undefined);
    for (const m of c.murs) lignes.push({ c, m, s });
  }
  const col = [
    ['entreprise_siren', ({ c }) => c.id], ['entreprise', ({ c }) => c.nom], ['confiance_cible', ({ c }) => c.confiance],
    ['score_global', ({ s }) => s.global], ['score_fit', ({ s }) => s.fit.score], ['score_motivation', ({ s }) => s.motivation.score], ['score_locataire', ({ s }) => s.locataire.score],
    ['pourquoi_vendrait', ({ s }) => s.phrase],
    ['valeur_totale_basse', ({ c }) => c.totaux.basse], ['valeur_totale_centrale', ({ c }) => c.totaux.centrale], ['valeur_totale_haute', ({ c }) => c.totaux.haute],
    ['departement', ({ m }) => m.departement], ['commune', ({ m }) => m.parcelle.commune], ['adresse', ({ m }) => m.parcelle.adresse], ['parcelle', ({ m }) => m.parcelle.id],
    ['lat', ({ m }) => m.parcelle.lat], ['lon', ({ m }) => m.parcelle.lon], ['type_actif', ({ m }) => m.type_actif],
    ['contenance_m2', ({ m }) => m.parcelle.contenance_m2], ['emprise_batie_m2', ({ m }) => m.parcelle.emprise_batie_m2], ['niveaux', ({ m }) => m.parcelle.niveaux], ['part_detenue', ({ m }) => m.parcelle.part_detenue], ['surface_estimee_m2', ({ m }) => m.parcelle.surface_estimee_m2],
    ['parcelle_source', ({ m }) => m.parcelle.source], ['parcelle_date', ({ m }) => m.parcelle.date],
    ['valeur_basse', ({ m }) => m.valeur && m.valeur.basse], ['valeur_centrale', ({ m }) => m.valeur && m.valeur.centrale], ['valeur_haute', ({ m }) => m.valeur && m.valeur.haute],
    ['n_comparables', ({ m }) => m.valeur && m.valeur.n_comparables], ['rayon_comparables_km', ({ m }) => m.valeur && m.valeur.rayon_km], ['valeur_source', ({ m }) => m.valeur && m.valeur.source], ['valeur_date', ({ m }) => m.valeur && m.valeur.date],
    ['proprietaire_siren', ({ m }) => m.proprietaire.siren], ['proprietaire_nom', ({ m }) => m.proprietaire.nom], ['proprietaire_forme', ({ m }) => m.proprietaire.forme], ['proprietaire_creation', ({ m }) => m.proprietaire.creation],
    ['proprietaire_source', ({ m }) => m.proprietaire.source], ['proprietaire_date', ({ m }) => m.proprietaire.date],
    ['lien', ({ m }) => m.lien.type], ['lien_motif', ({ m }) => m.lien.motif], ['lien_confiance', ({ m }) => m.lien.confiance],
    ['occupant_ape', ({ c }) => c.occupant.ape], ['occupant_categorie', ({ c }) => c.occupant.categorie], ['occupant_effectif', ({ c }) => Scores.effectifLibelle(c.occupant.effectif_tranche)], ['occupant_creation', ({ c }) => c.occupant.creation],
    ['ca', ({ c }) => c.occupant.finances[0] && c.occupant.finances[0].ca], ['resultat_net', ({ c }) => c.occupant.finances[0] && c.occupant.finances[0].resultat_net], ['comptes_annee', ({ c }) => c.occupant.finances[0] && c.occupant.finances[0].annee],
    ['dirigeants', ({ c }) => c.occupant.dirigeants.filter((d) => !d.personne_morale).map((d) => `${d.nom}${d.age ? ` (${d.age} ans)` : ''} - ${d.qualite || ''}`).join(' | ')],
    ['fonds_probables', ({ c }) => c.fonds.map((f) => f.nom).join(' | ')],
    ['occupant_source', ({ c }) => c.occupant.source], ['occupant_date', ({ c }) => c.occupant.date],
    ['achat_date', ({ m }) => m.achat && m.achat.date], ['achat_prix', ({ m }) => m.achat && m.achat.prix], ['achat_source', ({ m }) => m.achat && m.achat.source],
    ['bodacc_24_mois', ({ c }) => c.bodacc.filter((e) => e.nature !== 'comptes').map((e) => `${e.date} ${e.sur} ${e.nature}`).join(' | ')], ['bodacc_source', ({ c }) => c.bodacc_lu.source], ['bodacc_date', ({ c }) => c.bodacc_lu.date],
    ['raisons_fit', ({ s }) => s.fit.raisons.map((x) => `${x.points >= 0 ? '+' : ''}${x.points} ${x.texte}`).join(' | ')],
    ['raisons_motivation', ({ s }) => s.motivation.raisons.filter((x) => x.points).map((x) => `+${x.points} ${x.texte}`).join(' | ')],
    ['raisons_locataire', ({ s }) => s.locataire.raisons.map((x) => `${x.points >= 0 ? '+' : ''}${x.points} ${x.texte}`).join(' | ')],
  ];
  const esc = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  // Point-virgule et BOM : s'ouvre tel quel dans Excel en francais.
  return `﻿${col.map(([k]) => k).join(';')}\n${lignes.map((l) => col.map(([, f]) => esc(f(l))).join(';')).join('\n')}\n`;
}

function lireResultat(dept) {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(SORTIE, `${dept}.json`), 'utf8'));
    // Un resultat V1 (une cible par parcelle) n'a pas le format attendu : a relancer.
    return r && r.stats && r.stats.version === VERSION ? r : null;
  } catch { return null; }
}
const cheminCsv = (dept) => path.join(SORTIE, `${dept}.csv`);

module.exports = {
  VERSION, vraisDirigeants, estControleur, fondsProbables, lancer, lireResultat, cheminCsv, enCsv, lienOccupation, confianceDe,
  memeAdresse, evenementBodacc, dirigeantDe, adresseDgfip, evaluerMur, totauxDe, contourDe, SORTIE,
};
