// Controles de coherence croises : une deuxieme garde-fou, independante de la
// verification par citation. Un champ peut etre individuellement bien cite
// et pourtant incoherent avec le reste du document (ex: chiffre d'un
// brouillon anterieur) -- ces controles servent a detecter cette classe
// d'erreur.
const { parseFrenchNumber } = require('./indicators');

function round(n, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function sum(arr, getter) {
  return arr.reduce((acc, item) => {
    const v = getter(item);
    return acc + (typeof v === 'number' ? v : 0);
  }, 0);
}

function checkRentRollVsT12(etatLocatif, t12) {
  const rentRollTotal = sum(etatLocatif, r => r.loyerAnnuel?.value);
  const t12Value = t12.find(l => l.lineItem === 'Revenus locatifs de base')?.montant?.value ?? null;
  if (t12Value === null || rentRollTotal === 0) {
    return { check: 'loyers_etat_locatif_vs_t12', status: 'indetermine' };
  }
  const deltaPct = round((Math.abs(rentRollTotal - t12Value) / t12Value) * 100, 1);
  return {
    check: 'loyers_etat_locatif_vs_t12',
    label: "Loyers de l'état locatif vs loyers de base du compte d'exploitation",
    expected: t12Value,
    actual: round(rentRollTotal, 0),
    deltaPct,
    tolerancePct: 5,
    status: deltaPct <= 5 ? 'ok' : 'warning',
  };
}

function checkSurfaceSums(etatLocatif, ficheIdentite) {
  const surfaceSum = sum(etatLocatif, r => r.surfaceSf?.value);
  const gla = parseFrenchNumber(ficheIdentite?.surfaceLocativeGLA?.value);
  if (gla === null || surfaceSum === 0) {
    return { check: 'surfaces_etat_locatif_vs_fiche', status: 'indetermine' };
  }
  return {
    check: 'surfaces_etat_locatif_vs_fiche',
    label: "Somme des surfaces des lots vs surface locative (GLA)",
    expected: gla,
    actual: round(surfaceSum, 0),
    status: surfaceSum > gla * 1.02 ? 'warning' : 'ok',
  };
}

function checkYield(etatLocatif, ficheIdentite) {
  const rentRollTotal = sum(etatLocatif, r => r.loyerAnnuel?.value);
  const prix = parseFrenchNumber(ficheIdentite?.prixDemande?.value);
  const rendementAffiche = parseFrenchNumber(ficheIdentite?.rendementAffiche?.value);
  if (!prix || rendementAffiche === null || rentRollTotal === 0) {
    return { check: 'rendement_recalcule_vs_affiche', status: 'indetermine' };
  }
  const recalcule = round((rentRollTotal / prix) * 100, 2);
  const deltaPt = round(Math.abs(recalcule - rendementAffiche), 2);
  return {
    check: 'rendement_recalcule_vs_affiche',
    label: "Rendement recalculé vs rendement affiché",
    expected: rendementAffiche,
    actual: recalcule,
    deltaPt,
    tolerancePt: 0.5,
    status: deltaPt <= 0.5 ? 'ok' : 'warning',
  };
}

function runConsistencyChecks({ ficheIdentite, etatLocatif, t12 }) {
  return [
    checkRentRollVsT12(etatLocatif || [], t12 || []),
    checkSurfaceSums(etatLocatif || [], ficheIdentite || {}),
    checkYield(etatLocatif || [], ficheIdentite || {}),
  ];
}

module.exports = { runConsistencyChecks };
