// Geometrie minimale en coordonnees GPS : surfaces, centroides, point dans un
// polygone, distances. Projection equirectangulaire locale (erreur < 1 %
// a l'echelle d'une parcelle), suffisante pour estimer une emprise batie.

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

/** Distance en metres entre deux points [lon, lat]. */
function distance(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Les anneaux exterieurs d'un Polygon ou MultiPolygon GeoJSON. */
function anneauxExterieurs(geometrie) {
  if (!geometrie) return [];
  if (geometrie.type === 'Polygon') return [geometrie.coordinates[0]];
  if (geometrie.type === 'MultiPolygon') return geometrie.coordinates.map((p) => p[0]);
  return [];
}

/** Surface en m2 d'un anneau (formule du lacet, projection locale). */
function aireAnneau(anneau) {
  if (!anneau || anneau.length < 3) return 0;
  const lat0 = rad(anneau[0][1]);
  const kx = R * Math.cos(lat0) * (Math.PI / 180);
  const ky = R * (Math.PI / 180);
  let s = 0;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i, i += 1) {
    s += (anneau[j][0] * kx) * (anneau[i][1] * ky) - (anneau[i][0] * kx) * (anneau[j][1] * ky);
  }
  return Math.abs(s / 2);
}

/** Surface en m2 d'une geometrie (trous ignores : une cour interieure reste comptee, ordre de grandeur). */
const aire = (geometrie) => anneauxExterieurs(geometrie).reduce((t, a) => t + aireAnneau(a), 0);

/** Centroide approche (moyenne des sommets de l'anneau le plus grand). */
function centroide(geometrie) {
  const anneaux = anneauxExterieurs(geometrie);
  if (!anneaux.length) return null;
  const a = anneaux.reduce((m, x) => (aireAnneau(x) > aireAnneau(m) ? x : m), anneaux[0]);
  const pts = a.length > 1 && a[0][0] === a[a.length - 1][0] && a[0][1] === a[a.length - 1][1] ? a.slice(0, -1) : a;
  const s = pts.reduce((t, p) => [t[0] + p[0], t[1] + p[1]], [0, 0]);
  return [s[0] / pts.length, s[1] / pts.length];
}

function dansAnneau(pt, anneau) {
  let dedans = false;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i, i += 1) {
    const [xi, yi] = anneau[i];
    const [xj, yj] = anneau[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

/** Le point [lon, lat] tombe-t-il dans la geometrie ? */
const contient = (geometrie, pt) => anneauxExterieurs(geometrie).some((a) => dansAnneau(pt, a));

function boite(geometrie) {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const a of anneauxExterieurs(geometrie)) for (const [x, y] of a) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
  return b;
}

/**
 * Index spatial grossier par carreaux : rend les candidats dont la boite
 * contient le point, a confirmer par `contient`.
 */
function indexer(elements, geomDe, pas = 0.002) {
  const cases = new Map();
  const cle = (x, y) => `${Math.floor(x / pas)}|${Math.floor(y / pas)}`;
  for (const e of elements) {
    const b = boite(geomDe(e));
    if (!Number.isFinite(b[0])) continue;
    for (let x = Math.floor(b[0] / pas); x <= Math.floor(b[2] / pas); x += 1) {
      for (let y = Math.floor(b[1] / pas); y <= Math.floor(b[3] / pas); y += 1) {
        const k = `${x}|${y}`;
        if (!cases.has(k)) cases.set(k, []);
        cases.get(k).push(e);
      }
    }
  }
  return { candidats: (pt) => cases.get(cle(pt[0], pt[1])) || [] };
}

module.exports = { distance, aire, centroide, contient, indexer };
