// Moteur de reconciliation "invoque dans l'OM vs constate sur pieces"
// (Ecran 5 du cahier des charges "vertical AI"). Confronte les valeurs
// avancees par le memorandum de vente (citations extraites de la fiche
// d'identite) aux valeurs REELLEMENT calculees a partir de l'etat locatif
// et du compte d'exploitation (etatLocatif/t12, deja verifies par
// citation, indicateurs deja calcules par indicators.js).
//
// Regle absolue : chaque valeur "constatee" ici vient d'un calcul
// deterministe deja existant (computeIndicateurs) ou d'une somme de
// valeurs deja citees -- jamais un nouveau nombre invente pour ce module.
// Un ecart n'est affiche que si les DEUX cotes sont disponibles ; sinon la
// ligne est explicitement marquee "indetermine", jamais masquee ni
// remplie par une estimation.
const { parseFrenchNumber } = require('./indicators');

function round(n, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

// Seuils d'ecart au-dela desquels une ligne devient un signal (warning) ou
// une alerte (critical) -- mêmes ordres de grandeur que les controles de
// coherence existants (consistency.js, tolerance 5% / 0.5pt), doubles pour
// le palier "critique" plutot qu'invente une nouvelle echelle.
function classifyDelta(deltaPct, { warnAt = 5, criticalAt = 10 } = {}) {
  if (deltaPct == null) return 'indetermine';
  const abs = Math.abs(deltaPct);
  if (abs >= criticalAt) return 'critical';
  if (abs >= warnAt) return 'warning';
  return 'ok';
}

function buildRow({ id, label, invoqueValue, invoqueLabel, constateValue, constateLabel, unit, thresholds }) {
  if (invoqueValue == null || constateValue == null) {
    return { id, label, invoqueValue, invoqueLabel, constateValue, constateLabel, unit, deltaPct: null, signal: 'indetermine' };
  }
  const deltaPct = invoqueValue !== 0 ? round(((constateValue - invoqueValue) / Math.abs(invoqueValue)) * 100, 1) : null;
  return { id, label, invoqueValue, invoqueLabel, constateValue, constateLabel, unit, deltaPct, signal: classifyDelta(deltaPct, thresholds) };
}

function computeReconciliation(doc) {
  const fi = doc.ficheIdentite || {};
  const ind = doc.indicateurs || {};
  const prix = parseFrenchNumber(fi.prixDemande?.value);
  const rendementAffiche = parseFrenchNumber(fi.rendementAffiche?.value);
  const tauxOccupationOM = parseFrenchNumber(fi.tauxOccupation?.value);
  const taxeFonciere = parseFrenchNumber(fi.taxeFonciere?.value);
  const chargesCopro = parseFrenchNumber(fi.chargesCoproPropriete?.value);

  const rows = [];

  // Taux d'occupation : declare dans l'OM vs calcule a partir des lots
  // reellement loues de l'etat locatif (indicateurs.tauxOccupation,
  // computeIndicateurs -- surface occupee reelle / GLA).
  rows.push(buildRow({
    id: 'occupation',
    label: "Taux d'occupation",
    invoqueValue: tauxOccupationOM,
    invoqueLabel: tauxOccupationOM != null ? `${tauxOccupationOM} %` : null,
    constateValue: ind.tauxOccupation ?? null,
    constateLabel: ind.tauxOccupation != null ? `${ind.tauxOccupation} % (état locatif)` : null,
    unit: 'pt',
    thresholds: { warnAt: 5, criticalAt: 10 },
  }));

  // Rendement : affiche par le vendeur vs recalcule sur les loyers reels
  // de l'etat locatif (indicateurs.capRateRecalcule).
  rows.push(buildRow({
    id: 'rendement',
    label: 'Taux de rendement',
    invoqueValue: rendementAffiche,
    invoqueLabel: rendementAffiche != null ? `${rendementAffiche} %` : null,
    constateValue: ind.capRateRecalcule ?? null,
    constateLabel: ind.capRateRecalcule != null ? `${ind.capRateRecalcule} % (loyers état locatif)` : null,
    unit: 'pt',
    thresholds: { warnAt: 0.5, criticalAt: 1 },
  }));

  // Revenus locatifs : aucune ligne "revenu total" n'est directement citee
  // par l'OM -- le revenu QU'IMPLIQUE le rendement affiche (prix x
  // rendement, calcul deterministe a partir de deux valeurs deja citees)
  // sert de repere "invoque", confronte au revenu brut effectif REEL du
  // compte d'exploitation (indicateurs.revenuBrutEffectif, EGI).
  const revenuImplicite = (prix != null && rendementAffiche != null) ? round(prix * rendementAffiche / 100, 0) : null;
  rows.push(buildRow({
    id: 'revenus',
    label: 'Revenus locatifs',
    invoqueValue: revenuImplicite,
    invoqueLabel: revenuImplicite != null ? `${revenuImplicite.toLocaleString('fr-FR')} € (implicite : prix × rendement affiché)` : null,
    constateValue: ind.revenuBrutEffectif ?? null,
    constateLabel: ind.revenuBrutEffectif != null ? `${Math.round(ind.revenuBrutEffectif).toLocaleString('fr-FR')} € (compte d'exploitation)` : null,
    unit: 'eur',
    thresholds: { warnAt: 5, criticalAt: 10 },
  }));

  // Charges : taxe fonciere + charges de copropriete telles que citees
  // dans la fiche d'identite (deux valeurs isolees de l'OM, pas un total
  // "charges non recuperables" specifique) vs le total reel des charges du
  // compte d'exploitation (indicateurs.chargesTotal) -- comparaison
  // volontairement large (pas de pretention a isoler la part
  // "recuperable" que rien dans les donnees ne permet de determiner avec
  // certitude).
  const chargesOM = (taxeFonciere != null || chargesCopro != null) ? (taxeFonciere ?? 0) + (chargesCopro ?? 0) : null;
  // indicateurs.chargesTotal est neguatif par convention (sortie d'argent,
  // voir computeT12Totals#"attendu negatif") -- on compare des MAGNITUDES
  // de charges ici, jamais un signe, donc valeur absolue des deux cotes.
  const chargesReelles = ind.chargesTotal != null ? Math.abs(ind.chargesTotal) : null;
  rows.push(buildRow({
    id: 'charges',
    label: 'Charges (taxe foncière + copropriété)',
    invoqueValue: chargesOM,
    invoqueLabel: chargesOM != null ? `${chargesOM.toLocaleString('fr-FR')} € (fiche d'identité)` : null,
    constateValue: chargesReelles,
    constateLabel: chargesReelles != null ? `${Math.round(chargesReelles).toLocaleString('fr-FR')} € (total charges, compte d'exploitation)` : null,
    unit: 'eur',
    thresholds: { warnAt: 15, criticalAt: 30 },
  }));

  return rows;
}

module.exports = { computeReconciliation };
