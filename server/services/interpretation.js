// Calculs purs et deterministes pour l'onglet Audit. Principe directeur :
// chaque carte repond a "qu'est-ce qui merite l'attention du decideur avant
// de dire oui ?" -- rien d'autre. Aucune fonction ici n'appelle le modele :
// elles combinent des champs deja extraits+verifies (ficheIdentite/
// etatLocatif/t12/redFlags), des indicateurs deja calcules (indicators.js),
// et une seule regle reglementaire stable (calendrier DPE, loi Climat et
// Resilience). Trois regles non negociables, reprises telles quelles :
// 1. L'Audit signale, il ne tranche pas -- jamais de "rejetez ce deal".
// 2. Chaque alerte est tracable : donnee sourcee (page+citation) ou regle
//    reglementaire explicite, jamais une intuition de LLM. La phrase de
//    synthese du bandeau est elle-meme un gabarit deterministe construit a
//    partir des titres de cartes deja calculees -- pas un texte genere.
// 3. Un manque de donnee reste un manque : jamais transforme en "absence"
//    (ex: "clause plancher non mentionnee", jamais "clause plancher absente").
//    Ce qui manque va dans les "points a creuser", pas dans une carte a tort.
const { parseFrenchNumber, parseDateFr, moisAvant } = require('./indicators');

function round(n, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
const fmtEur = n => Math.round(n).toLocaleString('fr-FR') + ' €';
const fmt2 = n => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt2pct = n => fmt2(n) + ' %';
function fmtRange(min, max) {
  if (min != null && max != null) return `${fmtEur(min)} – ${fmtEur(max)}`;
  if (min != null) return `≥ ${fmtEur(min)}`;
  if (max != null) return `≤ ${fmtEur(max)}`;
  return '—';
}

// ================= conformite aux criteres d'investissement (source d'alertes "Critères") ================= //
function computeMandateFit(doc, criteria) {
  if (!criteria || Object.keys(criteria).length === 0) return { configured: false, verdict: null, criteria: [] };
  const fi = doc.ficheIdentite || {};
  const ind = doc.indicateurs || {};
  const prix = parseFrenchNumber(fi.prixDemande?.value);
  const typeActif = fi.typeActif?.value;
  const capRate = ind.capRateRecalcule;
  const results = [];

  if (criteria.tailleMin != null || criteria.tailleMax != null) {
    let status = 'indetermine';
    if (prix != null) {
      const okMin = criteria.tailleMin == null || prix >= criteria.tailleMin;
      const okMax = criteria.tailleMax == null || prix <= criteria.tailleMax;
      status = okMin && okMax ? 'ok' : 'echec';
    }
    results.push({ id: 'taille', label: 'Taille du deal', detail: prix != null ? `${fmtEur(prix)} · cible ${fmtRange(criteria.tailleMin, criteria.tailleMax)}` : 'Prix demandé non extrait', status });
  }
  if (criteria.typologies && criteria.typologies.length) {
    let status = 'indetermine';
    if (typeActif) status = criteria.typologies.some(t => typeActif.toLowerCase().includes(t.toLowerCase())) ? 'ok' : 'echec';
    results.push({ id: 'typologie', label: 'Typologie', detail: typeActif ? `${typeActif} · cible [${criteria.typologies.join(', ')}]` : 'Typologie non extraite', status });
  }
  if (criteria.localisation) {
    let status = 'indetermine';
    const texteLoc = [fi.adresse?.value, fi.codePostalVille?.value, fi.sousMarche?.value].filter(Boolean).join(' ').toLowerCase();
    if (texteLoc) status = texteLoc.includes(criteria.localisation.toLowerCase()) ? 'ok' : 'echec';
    results.push({ id: 'localisation', label: 'Localisation (correspondance textuelle approximative)', detail: `Cible : ${criteria.localisation}`, status });
  }
  if (criteria.rendementCibleMin != null) {
    let status = 'indetermine';
    if (capRate != null) status = capRate >= criteria.rendementCibleMin ? 'ok' : 'echec';
    results.push({ id: 'rendement', label: 'Rendement cible', detail: capRate != null ? `${fmt2pct(capRate)} · cible ≥ ${fmt2pct(criteria.rendementCibleMin)}` : 'Rendement recalculé non disponible', status });
  }

  const echecCount = results.filter(r => r.status === 'echec').length;
  const verdict = echecCount >= 2 ? 'hors_mandat' : echecCount === 1 ? 'a_examiner' : 'conforme';
  return { configured: true, verdict, criteria: results };
}
function computeMandateCards(doc, criteria) {
  const fit = computeMandateFit(doc, criteria);
  if (!fit.configured) return [];
  return fit.criteria.filter(c => c.status === 'echec').map(c => ({
    id: `mandat_${c.id}`, famille: 'Critères', niveau: 'rouge',
    titre: `Hors critères : ${c.label}`,
    constat: c.detail,
    impact: 'Critère défini dans les réglages du fonds non respecté par ce dossier.',
    page: null, quote: null, actionType: null, actionLabel: null,
    critereId: c.id,
  }));
}

// ================= rendement recalcule (donnee de contexte, pas une carte) ================= //
function computeYieldWaterfall(doc) {
  const fi = doc.ficheIdentite || {};
  const ind = doc.indicateurs || {};
  const affiche = parseFrenchNumber(fi.rendementAffiche?.value);
  const recalcule = ind.capRateRecalcule ?? null;
  const stabilise = ind.capRateStabilise ?? null;
  const ecartLoyersReels = (affiche != null && recalcule != null) ? round(affiche - recalcule, 2) : null;
  const ecartCharges = (recalcule != null && stabilise != null) ? round(recalcule - stabilise, 2) : null;
  const ecartTotal = (affiche != null && stabilise != null) ? round(affiche - stabilise, 2) : null;
  return { affiche, recalcule, stabilise, ecartLoyersReels, ecartCharges, ecartTotal };
}

// parseDateFr/moisAvant vivent desormais dans indicators.js (reutilises tels
// quels ici) -- WALT/WALB en ont aussi besoin, evite une duplication.

// ================= Famille 1 : echeance locative ================= //
// % des loyers en place dont la prochaine echeance REELLE (break extrait, ou
// a defaut fin de bail extraite -- jamais une estimation) tombe dans les 24
// prochains mois. Fenetre fixe et documentee, pas ajustable par le modele.
const HORIZON_ECHEANCE_MOIS = 24;
function computeEcheanceCard(doc) {
  const rows = (doc.etatLocatif || []).filter(r => r.loyerAnnuel?.value != null && r.loyerAnnuel.value > 0);
  const totalLoyer = rows.reduce((s, r) => s + r.loyerAnnuel.value, 0);
  if (!totalLoyer) return null;
  const withDate = rows.map(r => {
    const source = r.prochaineOptionSortie?.value ? r.prochaineOptionSortie : (r.dateFinBail?.value ? r.dateFinBail : null);
    const months = source ? moisAvant(source.value) : null;
    return { row: r, source, months };
  }).filter(x => x.months != null && x.months >= 0 && x.months <= HORIZON_ECHEANCE_MOIS);
  if (withDate.length === 0) return null;
  const loyerConcerne = withDate.reduce((s, x) => s + x.row.loyerAnnuel.value, 0);
  const pct = round((loyerConcerne / totalLoyer) * 100, 1);
  const niveau = pct >= 50 ? 'rouge' : pct >= 25 ? 'orange' : null;
  if (!niveau) return null;
  const principal = [...withDate].sort((a, b) => b.row.loyerAnnuel.value - a.row.loyerAnnuel.value)[0];
  return {
    id: 'echeance_locative', famille: 'Échéance locative', niveau,
    titre: 'Échéances locatives rapprochées',
    constat: `${fmt2pct(pct)} des loyers en place (${fmtEur(loyerConcerne)} sur ${fmtEur(totalLoyer)}) arrivent à échéance ou en option de sortie d'ici ${HORIZON_ECHEANCE_MOIS} mois.`,
    impact: `Locataire le plus concerné : ${principal.row.locataire || principal.row.suite || 'non identifié'} (${fmtEur(principal.row.loyerAnnuel.value)}/an) — risque de perte de revenu locatif en l'absence de renouvellement.`,
    page: principal.source?.page ?? null, quote: principal.source?.quote ?? null,
    actionType: null, actionLabel: null,
  };
}

// ================= Famille 2 : loyer hors marche ================= //
// N'apparait QUE si le document lui-meme mentionne un loyer de marche de
// reference (fiche.loyerMarcheReference, cite) : Leez n'a aucune base de
// comparables externe et ne compare jamais a une donnee non fournie par le
// document source.
function computeLoyerMarcheCard(doc) {
  const fi = doc.ficheIdentite || {};
  const ind = doc.indicateurs || {};
  const marche = parseFrenchNumber(fi.loyerMarcheReference?.value);
  const courant = ind.loyerMoyenM2;
  if (marche == null || marche <= 0 || courant == null) return null;
  const ecartPct = round(((courant - marche) / marche) * 100, 1);
  if (Math.abs(ecartPct) < 10) return null;
  const overRented = ecartPct > 0;
  const niveau = overRented ? (ecartPct >= 25 ? 'rouge' : 'orange') : 'vert';
  return {
    id: 'loyer_marche', famille: 'Loyer vs marché', niveau,
    titre: overRented ? 'Loyer au-dessus du marché (over-rented)' : 'Loyer en dessous du marché (under-rented)',
    constat: `Loyer moyen actuel ${fmt2(courant)} €/m² vs ${fmt2(marche)} €/m² de marché mentionné dans le document (écart de ${fmt2(Math.abs(ecartPct))} %).`,
    impact: overRented
      ? 'Risque de baisse du loyer au renouvellement des baux, avec impact potentiel sur le rendement recalculé.'
      : "Potentiel de hausse de loyer aux prochains renouvellements, non reflété dans le rendement actuel.",
    page: fi.loyerMarcheReference.page, quote: fi.loyerMarcheReference.quote,
    actionType: null, actionLabel: null,
  };
}

// ================= Famille 3 : indexation & clause plancher ================= //
// "Non mentionne" reste "non mentionne" dans le texte de la carte -- jamais
// reformule en "absent" (on ne sait pas ce que le document ne dit pas).
function computeIndexationCard(doc) {
  const rows = (doc.etatLocatif || []).filter(r => r.typeIndexation?.value);
  if (rows.length === 0) return null;
  const sansPlancher = rows.filter(r => !r.clausePlancher?.value);
  if (sansPlancher.length === 0) return null;
  const totalLoyerConcerne = sansPlancher.reduce((s, r) => s + (r.loyerAnnuel?.value || 0), 0);
  const example = [...sansPlancher].sort((a, b) => (b.loyerAnnuel?.value || 0) - (a.loyerAnnuel?.value || 0))[0];
  const typesUniques = [...new Set(sansPlancher.map(r => r.typeIndexation.value))];
  return {
    id: 'indexation', famille: 'Indexation', niveau: 'orange',
    titre: 'Clause plancher non mentionnée',
    constat: `${sansPlancher.length} bail${sansPlancher.length > 1 ? 'x' : ''} indexé${sansPlancher.length > 1 ? 's' : ''} (${typesUniques.join(', ')}) sans mention de clause plancher dans le document${totalLoyerConcerne ? ` — ${fmtEur(totalLoyerConcerne)}/an de loyers concernés` : ''}.`,
    impact: "Aucune garantie contre une baisse de l'indice n'est mentionnée : à confirmer auprès du vendeur avant de modéliser une indexation systématiquement haussière.",
    page: example.typeIndexation.page, quote: example.typeIndexation.quote,
    actionType: null, actionLabel: null,
  };
}

// ================= Famille 4 : CapEx / ESG ================= //
// Calendrier reglementaire des passoires thermiques (loi Climat et
// Resilience) : regle fixe, pas une estimation du modele. Le montant des
// travaux n'est affiche QUE s'il est reellement mentionne dans le document
// (extrait via signaux/capexTechniques, jamais estime par Leez).
const DPE_BAN_YEAR = { G: 2025, F: 2028, E: 2034 };
const ENERGY_KEYWORDS = /isolation|chauffage|cvc|toiture|energ|dpe|thermique|chaudiere|chaudière|ventilation/i;
function computeCapexEsgCards(doc) {
  const fi = doc.ficheIdentite || {};
  const capexList = (doc.redFlags && Array.isArray(doc.redFlags.capexTechniques)) ? doc.redFlags.capexTechniques : [];
  const dpe = fi.classeDPE?.value ? String(fi.classeDPE.value).toUpperCase().trim() : null;
  const cards = [];
  const usedIdx = new Set();

  if (dpe && DPE_BAN_YEAR[dpe]) {
    const relevant = [];
    capexList.forEach((c, i) => {
      if (ENERGY_KEYWORDS.test(c.sujet || '') || ENERGY_KEYWORDS.test(c.mention?.value || '')) { relevant.push(c); usedIdx.add(i); }
    });
    const montantConnu = relevant.reduce((s, c) => s + (c.montantEstime?.value || 0), 0);
    cards.push({
      id: 'dpe', famille: 'CapEx / ESG', niveau: dpe === 'G' ? 'rouge' : 'orange',
      titre: `Performance énergétique — DPE ${dpe}`,
      constat: `Classe DPE ${dpe} — interdiction de location prévue à partir de ${DPE_BAN_YEAR[dpe]} (calendrier réglementaire, loi Climat et Résilience).`,
      impact: montantConnu > 0
        ? `Travaux identifiés dans le document pour un montant mentionné de ${fmtEur(montantConnu)} — à intégrer aux hypothèses du simulateur.`
        : "Montant des travaux de mise aux normes non communiqué dans le document — à budgétiser avant d'avancer.",
      page: fi.classeDPE.page, quote: fi.classeDPE.quote,
      actionType: montantConnu > 0 ? 'simulateur' : null,
      actionLabel: montantConnu > 0 ? 'Intégrer au simulateur' : null,
      capexMontant: montantConnu > 0 ? montantConnu : null,
    });
  }
  capexList.forEach((c, i) => {
    if (usedIdx.has(i) || c.mention?.value == null) return;
    cards.push({
      id: `capex_${i}`, famille: 'CapEx / ESG', niveau: 'orange',
      titre: `Travaux identifiés : ${c.sujet}`,
      constat: c.mention.value + (c.montantEstime?.value != null ? ` (montant mentionné : ${fmtEur(c.montantEstime.value)})` : ''),
      impact: 'Coût potentiel à intégrer aux hypothèses du simulateur avant de finaliser la valorisation.',
      page: c.mention.page, quote: c.mention.quote,
      actionType: c.montantEstime?.value != null ? 'simulateur' : null,
      actionLabel: c.montantEstime?.value != null ? 'Intégrer au simulateur' : null,
      capexMontant: c.montantEstime?.value ?? null,
    });
  });
  return cards;
}

// ================= Autres alertes reelles (locatif / financier) ================= //
const SEUILS = {
  concentration_top3: [[0, 30, 'vert'], [30, 50, 'orange'], [50, 101, 'rouge']],
  taux_charges: [[0, 25, 'orange'], [25, 35, 'vert'], [35, 45, 'vert'], [45, 101, 'rouge']],
};
function niveauSeuil(id, valeurPct) {
  const rules = SEUILS[id];
  if (!rules || typeof valeurPct !== 'number') return null;
  const r = rules.find(([min, max]) => valeurPct >= min && valeurPct < max);
  return r ? r[2] : null;
}
function computeAutresCards(doc) {
  const ind = doc.indicateurs || {};
  const checks = doc.consistencyChecks || [];
  const signaux = doc.redFlags;
  const cards = [];

  if (ind.concentrationTop3 != null) {
    const niveau = niveauSeuil('concentration_top3', ind.concentrationTop3);
    if (niveau && niveau !== 'vert') {
      cards.push({
        id: 'conc_top3', famille: 'Locatif', niveau,
        titre: 'Concentration locative',
        constat: `Les 3 principaux locataires représentent ${fmt2pct(ind.concentrationTop3)} des loyers en place.`,
        impact: "Une vacance ou un défaut sur l'un de ces locataires aurait un impact significatif sur le revenu.",
        page: null, quote: null, actionType: null, actionLabel: null,
      });
    }
  }
  if (signaux && Array.isArray(signaux.locatairesRisque)) {
    signaux.locatairesRisque.forEach((r, i) => {
      if (r.mention?.value != null) {
        cards.push({
          id: `risque_${i}`, famille: 'Locatif', niveau: 'rouge',
          titre: `Solvabilité locataire : ${r.locataire}`,
          constat: r.mention.value,
          impact: 'Risque de défaut de paiement ou de résiliation anticipée.',
          page: r.mention.page, quote: r.mention.quote, actionType: null, actionLabel: null,
        });
      }
    });
  }
  if (ind.tauxChargesPct != null) {
    const niveau = niveauSeuil('taux_charges', ind.tauxChargesPct);
    if (niveau === 'rouge') {
      cards.push({
        id: 'charges', famille: 'Financier', niveau,
        titre: "Charges d'exploitation non récupérables élevées",
        constat: `Taux de charges / revenu brut effectif de ${fmt2pct(ind.tauxChargesPct)}.`,
        impact: 'Pèse directement sur le NOI et le rendement recalculé.',
        page: null, quote: null, actionType: null, actionLabel: null,
      });
    }
  }
  checks.filter(c => c.status === 'warning').forEach((c, i) => {
    cards.push({
      id: `coherence_${i}`, famille: 'Financier', niveau: 'orange',
      titre: c.label || c.check,
      constat: `Écart de ${c.deltaPct != null ? c.deltaPct + ' %' : c.deltaPt + ' pt'} au-delà de la tolérance retenue.`,
      impact: 'Incohérence entre deux sources internes au dossier — à clarifier avant de trancher.',
      page: null, quote: null, actionType: null, actionLabel: null,
    });
  });
  return cards;
}

const NIVEAU_ORDER = { rouge: 0, orange: 1, vert: 2 };
function computeAuditCards(doc, criteria) {
  const all = [
    ...computeMandateCards(doc, criteria),
    computeEcheanceCard(doc),
    computeLoyerMarcheCard(doc),
    computeIndexationCard(doc),
    ...computeCapexEsgCards(doc),
    ...computeAutresCards(doc),
  ].filter(Boolean);
  return all.sort((a, b) => (NIVEAU_ORDER[a.niveau] ?? 3) - (NIVEAU_ORDER[b.niveau] ?? 3));
}

// ================= points a creuser (questions au vendeur) ================= //
function computePointsACreuser(doc) {
  const fi = doc.ficheIdentite || {};
  const rows = doc.etatLocatif || [];
  const t12 = doc.t12 || [];
  const points = [];

  if (!fi.classeDPE?.value) points.push({ titre: 'DPE non communiqué', detail: 'Aucune classe énergétique extraite du document — à demander avant de conclure sur le risque réglementaire ESG.' });
  if (!fi.loyerMarcheReference?.value) points.push({ titre: 'Loyer de marché non communiqué', detail: 'Le document ne mentionne pas de loyer de marché de référence — nécessaire pour évaluer un risque de sur/sous-location au renouvellement.' });

  if (rows.length > 0 && rows.every(r => !r.periodeFranchise?.value)) {
    points.push({ titre: 'Franchises non détaillées', detail: "Aucune période de franchise n'a été précisée dans le document pour les baux de l'état locatif." });
  }

  const sansEcheance = rows.filter(r => !r.prochaineOptionSortie?.value && !r.dateFinBail?.value);
  if (sansEcheance.length > 0) {
    const noms = sansEcheance.slice(0, 3).map(r => r.locataire || r.suite).filter(Boolean).join(', ');
    points.push({ titre: `Échéance non communiquée pour ${sansEcheance.length} lot${sansEcheance.length > 1 ? 's' : ''}`, detail: `${noms}${sansEcheance.length > 3 ? '…' : ''} — date de fin de bail ou de break non extraite du document.` });
  }

  if (t12.length === 0 || t12.every(r => r.montant?.value == null)) {
    points.push({ titre: 'Historique de charges réelles absent', detail: "Le compte d'exploitation sur 12 mois glissants (T-12) n'a pas pu être extrait ou est vide — vérifier si le vendeur peut fournir un historique réel." });
  }

  return points;
}

// ================= bandeau de synthese ================= //
// Phrase 100% deterministe : concatenation des titres des cartes deja
// calculees, jamais une generation libre par le modele.
function computeAuditSummary(cards) {
  const rouge = cards.filter(c => c.niveau === 'rouge');
  const orange = cards.filter(c => c.niveau === 'orange');
  const counts = { rouge: rouge.length, orange: orange.length, vert: cards.filter(c => c.niveau === 'vert').length };
  let niveauGlobal, verdictLabel, phrase;
  if (rouge.length > 0) {
    niveauGlobal = 'rouge';
    verdictLabel = 'À examiner attentivement';
    const titres = rouge.slice(0, 3).map(c => c.titre);
    phrase = `${rouge.length} alerte${rouge.length > 1 ? 's' : ''} critique${rouge.length > 1 ? 's' : ''} : ${titres.join(', ')}${rouge.length > 3 ? '…' : ''}.` +
      (orange.length ? ` ${orange.length} point${orange.length > 1 ? 's' : ''} de vigilance supplémentaire${orange.length > 1 ? 's' : ''}.` : '');
  } else if (orange.length > 0) {
    niveauGlobal = 'orange';
    verdictLabel = 'Exploitable sous conditions';
    const titres = orange.slice(0, 3).map(c => c.titre);
    phrase = `${orange.length} point${orange.length > 1 ? 's' : ''} de vigilance : ${titres.join(', ')}${orange.length > 3 ? '…' : ''}.`;
  } else {
    niveauGlobal = 'vert';
    verdictLabel = 'Aucune alerte majeure détectée';
    phrase = 'Aucun signal d\'alerte majeur détecté sur les critères vérifiés par Leez.';
  }
  return { niveauGlobal, verdictLabel, counts, phrase };
}

// ================= stress-test (module additionnel, inchange) ================= //
function computeStressTest(doc, params = {}) {
  const fi = doc.ficheIdentite || {};
  const prix = parseFrenchNumber(fi.prixDemande?.value);
  const rows = (doc.etatLocatif || []).filter(r => r.loyerAnnuel?.value != null);
  const totalLoyer = rows.reduce((s, r) => s + r.loyerAnnuel.value, 0);
  const sorted = [...rows].sort((a, b) => b.loyerAnnuel.value - a.loyerAnnuel.value);
  const top1 = sorted[0];

  let departLocataire = null;
  if (top1 && prix && totalLoyer) {
    const loyerSansTop1 = totalLoyer - top1.loyerAnnuel.value;
    departLocataire = {
      locataire: top1.locataire || top1.suite || 'Locataire principal',
      capRateAvant: round((totalLoyer / prix) * 100, 2),
      capRateApres: round((loyerSansTop1 / prix) * 100, 2),
    };
  }

  const pctBaisse = params.pctBaisse ?? 0;
  let baisseDePrix = null;
  if (prix && totalLoyer) {
    const prixApres = prix * (1 - pctBaisse / 100);
    baisseDePrix = { pct: pctBaisse, prixApres: Math.round(prixApres), capRateApres: prixApres ? round((totalLoyer / prixApres) * 100, 2) : null };
  }

  const pctCapex = params.pctCapex ?? 0;
  const capexList = (doc.redFlags && doc.redFlags.capexTechniques) || [];
  const capexTotal = capexList.reduce((s, c) => s + (c.montantEstime?.value || 0), 0);
  const capex = capexTotal > 0 ? { base: Math.round(capexTotal), apres: Math.round(capexTotal * (1 + pctCapex / 100)), pct: pctCapex } : null;

  return { departLocataire, baisseDePrix, capex };
}

module.exports = { computeMandateFit, computeYieldWaterfall, computeAuditCards, computePointsACreuser, computeAuditSummary, computeStressTest };
