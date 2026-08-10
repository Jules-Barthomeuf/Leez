// Indicateurs calcules cote serveur, jamais redemandes au modele : la seule
// source de verite pour ces chiffres est l'arithmetique appliquee aux champs
// deja verifies (etatLocatif, ficheIdentite, t12).
//
// parseDateFr/moisAvant vivent ici (et non dans interpretation.js, qui les
// reutilise) car indicators.js est le module de base sans dependance --
// evite une dependance circulaire avec interpretation.js qui importe deja
// parseFrenchNumber d'ici.

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

// Les champs numeriques de la fiche d'identite arrivent en texte formate
// (ex: "255 000 000 €", "6,60 %") -- on les reduit a un nombre exploitable.
function parseFrenchNumber(v) {
  if (typeof v === 'number') return v;
  if (!v) return null;
  const cleaned = String(v).replace(/[€%\s  ]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Parseur de date tres conservateur (mois francais + annee, MM/AAAA, ou AAAA
// seuls) : utilise uniquement pour des calculs best-effort ("dans N mois",
// WALT/WALB). En cas de doute, retourne null -- jamais une estimation
// approximative. Repris tel quel par interpretation.js (carte "echeance
// locative").
const MOIS_FR = { janv: 0, jan: 0, févr: 1, fev: 1, fevr: 1, mars: 2, avr: 3, mai: 4, juin: 5, juil: 6, août: 7, aout: 7, sept: 8, oct: 9, nov: 10, déc: 11, dec: 11 };
function parseDateFr(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase().replace(/\.$/, '');
  let m = s.match(/^([a-zéû]+)\.?\s+(\d{4})$/);
  if (m) {
    const key = Object.keys(MOIS_FR).find(k => m[1].startsWith(k));
    if (key != null) return new Date(parseInt(m[2], 10), MOIS_FR[key], 1);
  }
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(parseInt(m[2], 10), parseInt(m[1], 10) - 1, 1);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  m = s.match(/^(\d{4})$/);
  if (m) return new Date(parseInt(m[1], 10), 0, 1);
  return null;
}
function moisAvant(dateStr, from = new Date()) {
  const d = parseDateFr(dateStr);
  if (!d) return null;
  return (d.getFullYear() - from.getFullYear()) * 12 + (d.getMonth() - from.getMonth());
}

// Postes de revenus : liste fermee (le sens du signe depend d'etre revenu
// ou charge). Les postes de CHARGES, eux, ne sont plus une liste fermee a
// tenir manuellement en synchronisation avec T12_LINE_ITEMS (extraction.js)
// -- ce sont TOUS les postes du t12 qui ne sont pas un revenu. Plus robuste
// aux categories de charges ajoutees/scindees au fil du temps (ex:
// "Honoraires de gestion" scinde en property/asset management) : un
// dossier deja extrait AVANT un tel changement continue de calculer un NOI
// correct, sans migration necessaire.
const REVENUE_ITEMS = ['Revenus locatifs de base', 'Refacturations de charges', 'Autres revenus', 'Vacance et pertes de créances'];

function computeT12Totals(t12) {
  const val = (name) => t12.find(l => l.lineItem === name)?.montant?.value ?? null;
  const revenueVals = REVENUE_ITEMS.map(val);
  if (revenueVals.some(v => v === null)) {
    return { egi: null, noi: null, tauxChargesPct: null, chargesTotal: null };
  }
  const egi = revenueVals.reduce((a, v) => a + v, 0);
  const chargeVals = t12.filter(l => !REVENUE_ITEMS.includes(l.lineItem)).map(l => l.montant?.value ?? 0);
  const chargesTotal = chargeVals.reduce((a, v) => a + v, 0); // attendu negatif
  const noi = egi + chargesTotal;
  const tauxChargesPct = egi ? round((Math.abs(chargesTotal) / egi) * 100, 2) : null;
  return { egi: round(egi, 0), noi: round(noi, 0), tauxChargesPct, chargesTotal: round(chargesTotal, 0) };
}

// WALT (duree moyenne ponderee jusqu'a fin de bail) / WALB (jusqu'a la
// prochaine echeance reelle -- break si mentionne, sinon fin de bail) :
// ponderes par loyer annuel (convention de marche), sur les seules lignes
// dont une date reelle a pu etre parsee -- jamais une estimation sur les
// lignes sans date. Le taux de couverture (part du loyer total effectivement
// prise en compte) est renvoye a cote du chiffre pour que l'affichage puisse
// le disclose plutot que de laisser croire a un WALT calcule sur 100% du parc.
function computeWaltWalb(etatLocatif, from = new Date()) {
  const rows = (etatLocatif || []).filter(r => r.loyerAnnuel?.value != null && r.loyerAnnuel.value > 0);
  const totalLoyer = sum(rows, r => r.loyerAnnuel.value);
  if (!totalLoyer) return { walt: null, walb: null, waltCoveragePct: null, walbCoveragePct: null };

  function weightedYears(dateOf) {
    const withDate = rows
      .map(r => ({ r, months: (() => { const raw = dateOf(r); return raw ? moisAvant(raw, from) : null; })() }))
      .filter(x => x.months != null && x.months >= 0);
    if (withDate.length === 0) return { years: null, loyerCouvert: 0 };
    const loyerCouvert = sum(withDate, x => x.r.loyerAnnuel.value);
    const weightedMonths = sum(withDate, x => x.months * x.r.loyerAnnuel.value);
    return { years: round(weightedMonths / loyerCouvert / 12, 1), loyerCouvert };
  }

  const walt = weightedYears(r => r.dateFinBail?.value || null);
  const walb = weightedYears(r => r.prochaineOptionSortie?.value || r.dateFinBail?.value || null);
  return {
    walt: walt.years,
    walb: walb.years,
    waltCoveragePct: walt.years != null ? round((walt.loyerCouvert / totalLoyer) * 100, 1) : null,
    walbCoveragePct: walb.years != null ? round((walb.loyerCouvert / totalLoyer) * 100, 1) : null,
  };
}

function computeIndicateurs({ ficheIdentite, etatLocatif, t12 }) {
  const rows = etatLocatif.filter(r => r.loyerAnnuel?.value != null);
  const totalLoyer = sum(rows, r => r.loyerAnnuel.value);
  const rowsAvecSurface = rows.filter(r => r.surfaceSf?.value != null);
  const totalSurface = sum(rowsAvecSurface, r => r.surfaceSf.value);

  const prix = parseFrenchNumber(ficheIdentite?.prixDemande?.value);
  const surfaceGLA = parseFrenchNumber(ficheIdentite?.surfaceLocativeGLA?.value);

  const prixM2 = prix && totalSurface ? round(prix / totalSurface, 0) : null;
  const capRateRecalcule = prix && totalLoyer ? round((totalLoyer / prix) * 100, 2) : null;
  const loyerMoyenM2 = totalSurface ? round(totalLoyer / totalSurface, 2) : null;
  const tauxOccupation = surfaceGLA && totalSurface ? round((totalSurface / surfaceGLA) * 100, 1) : null;
  const tauxVacance = tauxOccupation !== null ? round(100 - tauxOccupation, 1) : null;

  const sorted = [...rows].sort((a, b) => b.loyerAnnuel.value - a.loyerAnnuel.value);
  const concentrationTop1 = sorted[0] && totalLoyer ? round((sorted[0].loyerAnnuel.value / totalLoyer) * 100, 1) : null;
  const top3Sum = sum(sorted.slice(0, 3), r => r.loyerAnnuel.value);
  const concentrationTop3 = totalLoyer ? round((top3Sum / totalLoyer) * 100, 1) : null;

  const rowsAvecFranchise = rows.filter(r => r.loyerFacialPsf?.value != null && r.loyerEconomiquePsf?.value != null && r.surfaceSf?.value != null);
  let ecartFacialEconomique = null;
  if (rowsAvecFranchise.length > 0) {
    const surfacePonderee = sum(rowsAvecFranchise, r => r.surfaceSf.value);
    const ecartPondere = sum(rowsAvecFranchise, r =>
      ((r.loyerFacialPsf.value - r.loyerEconomiquePsf.value) / r.loyerFacialPsf.value) * r.surfaceSf.value);
    ecartFacialEconomique = surfacePonderee ? round((ecartPondere / surfacePonderee) * 100, 1) : null;
  }

  const t12Totals = computeT12Totals(t12 || []);
  const capRateStabilise = prix && t12Totals.noi ? round((t12Totals.noi / prix) * 100, 2) : null;
  const margeNOI = t12Totals.egi && t12Totals.noi != null ? round((t12Totals.noi / t12Totals.egi) * 100, 1) : null;

  const montantDette = parseFrenchNumber(ficheIdentite?.montantDette?.value);
  const fondsPropres = parseFrenchNumber(ficheIdentite?.fondsPropresProposes?.value);
  let ltvEstime = null;
  if (montantDette && fondsPropres) ltvEstime = round((montantDette / (montantDette + fondsPropres)) * 100, 1);
  else if (montantDette && prix) ltvEstime = round((montantDette / prix) * 100, 1);

  return {
    prixM2,
    capRateRecalcule,
    capRateStabilise,
    loyerMoyenM2,
    tauxOccupation,
    tauxVacance,
    concentrationTop1,
    concentrationTop3,
    ecartFacialEconomique,
    tauxChargesPct: t12Totals.tauxChargesPct,
    revenuBrutEffectif: t12Totals.egi,
    chargesTotal: t12Totals.chargesTotal,
    resultatNetExploitation: t12Totals.noi,
    margeNOI,
    ltvEstime,
    ...computeWaltWalb(etatLocatif),
  };
}

const BRACKETS = [
  { label: 'Moins de 230 m²', max: 230 },
  { label: '230–700 m²', max: 700 },
  { label: '700–1 400 m²', max: 1400 },
  { label: '1 400–2 300 m²', max: 2300 },
  { label: '2 300+ m²', max: Infinity },
];

function computeMix(etatLocatif) {
  const rows = etatLocatif.filter(r => r.surfaceSf?.value != null);
  const out = [];
  for (let i = 0; i < BRACKETS.length; i++) {
    const min = i === 0 ? 0 : BRACKETS[i - 1].max;
    const max = BRACKETS[i].max;
    const inBracket = rows.filter(r => r.surfaceSf.value > min && r.surfaceSf.value <= max);
    if (inBracket.length === 0) continue;
    const surface = sum(inBracket, r => r.surfaceSf.value);
    const withPsf = inBracket.filter(r => r.loyerFacialPsf?.value != null);
    const loyerMoyenM2 = withPsf.length
      ? round(sum(withPsf, r => r.loyerFacialPsf.value * r.surfaceSf.value) / sum(withPsf, r => r.surfaceSf.value), 2)
      : null;
    out.push({ tranche: BRACKETS[i].label, lots: inBracket.length, surfaceTotale: surface, loyerMoyenM2 });
  }
  return out;
}

module.exports = { computeIndicateurs, computeMix, computeT12Totals, parseFrenchNumber, parseDateFr, moisAvant };
