// Les sources ouvertes de la Prospection cession-bail, chacune lue a sa
// source officielle et gardee en cache disque (data/prospection/cache) :
//   - fichier des locaux des personnes morales (DGFiP, millesime 2025) ;
//   - cadastre Etalab (parcelles et batiments, par commune) ;
//   - DVF geolocalise (Etalab, par departement et par annee) ;
//   - API Recherche d'entreprises (SIRENE + RNE : etablissements, dirigeants, comptes) ;
//   - BODACC (DILA, annonces commerciales).
// Aucune cle n'est necessaire. Chaque fonction rend aussi la source et la
// date de lecture, que le pipeline recopie sur chaque donnee.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { isUtf8 } = require('buffer');
const { entrees, fluxEntree } = require('./zip');

const RACINE = process.env.PROSPECTION_DIR || path.join(__dirname, '..', '..', 'data', 'prospection');
const CACHE = path.join(RACINE, 'cache');
fs.mkdirSync(CACHE, { recursive: true });

const SOURCES = {
  dgfip: { nom: 'DGFiP · fichier des locaux des personnes morales', millesime: '2025', url: 'https://data.economie.gouv.fr/api/v2/catalog/datasets/fichiers-des-locaux-et-des-parcelles-des-personnes-morales/attachments/fichier_des_locaux_situation_2025_zip' },
  cadastre: { nom: 'Cadastre Etalab', url: 'https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes' },
  dvf: { nom: 'DVF (Etalab, geo-dvf)', url: 'https://files.data.gouv.fr/geo-dvf/latest/csv' },
  annuaire: { nom: "API Recherche d'entreprises (SIRENE, RNE)", url: 'https://recherche-entreprises.api.gouv.fr' },
  bodacc: { nom: 'BODACC (DILA)', url: 'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records' },
};

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/** Telecharge une URL vers un fichier (ecriture atomique), sauf s'il est deja la. */
async function telecharger(url, chemin, { gz = false } = {}) {
  if (fs.existsSync(chemin)) return chemin;
  for (let essai = 0; essai < 4; essai += 1) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${url} a repondu ${r.status}`);
      let buf = Buffer.from(await r.arrayBuffer());
      if (gz) buf = zlib.gzipSync(buf, { level: 1 });
      fs.writeFileSync(`${chemin}.part`, buf);
      fs.renameSync(`${chemin}.part`, chemin);
      return chemin;
    } catch (e) {
      if (essai === 3) throw e;
      await attendre(2000 * (essai + 1));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// DGFiP : les locaux des personnes morales d'un departement
// ---------------------------------------------------------------------------

/** Pure : le departement d'un fichier de l'archive (« PM_25_B_060.csv » → 06, « 2A0 » → 2A, « 971 » → 971). */
function departementDuFichier(nom) {
  const m = String(nom).match(/P[MB]_\d{2}_B[_-]([0-9AB]{3})/);
  if (!m) return null;
  return m[1].startsWith('97') ? m[1] : m[1].slice(0, 2);
}

/** Pure : le code INSEE de la commune (« 06 » + « 088 » → 06088 ; « 971 » + « 101 » → 97101). */
const inseeDe = (dept, commune3) => `${dept.length === 3 ? dept.slice(0, 2) : dept}${String(commune3).padStart(3, '0')}`;

const COL = { commune: 2, nomCommune: 3, prefixe: 4, section: 5, plan: 6, niveau: 9, numero: 11, indice: 12, natureVoie: 15, nomVoie: 16, droit: 17, siren: 19, groupe: 20, forme: 21, formeAbregee: 22, nom: 23 };
const propre = (v) => String(v ?? '').replace(/^"|"$/g, '').trim();

/**
 * Les lignes (une par local) du departement, en flux. L'encodage change
 * selon les millesimes (latin1 jusqu'en 2023, UTF-8 en 2025) : on le
 * detecte sur le premier bloc.
 */
async function* lignesDgfip(dept, { journal = () => {} } = {}) {
  const zip = path.join(CACHE, 'locaux-2025.zip');
  if (!fs.existsSync(zip)) {
    journal('Telechargement du fichier DGFiP des personnes morales (~200 Mo, une seule fois)…');
    await telecharger(SOURCES.dgfip.url, zip);
  }
  const fichiers = entrees(zip).filter((e) => departementDuFichier(e.nom) === dept && /\.csv$/i.test(e.nom));
  if (!fichiers.length) throw new Error(`Aucun fichier DGFiP pour le departement ${dept}.`);
  for (const e of fichiers) {
    const flux = fluxEntree(zip, e);
    let decodeur = null;
    let reste = '';
    let entete = true;
    for await (const morceau of flux) {
      if (!decodeur) decodeur = new TextDecoder(isUtf8(morceau.subarray(0, Math.min(morceau.length, 65536 - 8))) ? 'utf-8' : 'latin1');
      const texte = reste + decodeur.decode(morceau, { stream: true });
      const lignes = texte.split(/\r?\n/);
      reste = lignes.pop();
      for (const l of lignes) {
        if (entete) { entete = false; continue; }
        if (/^"?D.partement/i.test(l)) continue; // un departement en plusieurs fichiers repete son en-tete
        if (l.trim()) yield l.split(';').map(propre);
      }
    }
    if (reste.trim() && !entete) yield reste.split(';').map(propre);
  }
}

// ---------------------------------------------------------------------------
// Cadastre Etalab : parcelles et batiments d'une commune
// ---------------------------------------------------------------------------

async function cadastreCommune(insee, couche) {
  const chemin = path.join(CACHE, 'cadastre', `${insee}-${couche}.json.gz`);
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  const ok = await telecharger(`${SOURCES.cadastre.url}/${insee}/geojson/${couche}`, chemin, { gz: true });
  if (!ok) return [];
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(chemin)).toString('utf8')).features || [];
}

// ---------------------------------------------------------------------------
// DVF : toutes les mutations d'un departement sur les millesimes publies
// ---------------------------------------------------------------------------

/** Les millesimes DVF publies (les cinq derniers, plus l'annee en cours partielle). */
function anneesDvf(maintenant = new Date()) {
  const a = maintenant.getFullYear();
  return [a - 5, a - 4, a - 3, a - 2, a - 1, a];
}

/** Pure : decoupe une ligne CSV a virgules (champs entre guillemets geres). */
function decouperCsv(ligne) {
  if (!ligne.includes('"')) return ligne.split(',');
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < ligne.length; i += 1) {
    const c = ligne[i];
    if (c === '"') { if (q && ligne[i + 1] === '"') { cur += '"'; i += 1; } else q = !q; } else if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Les lignes DVF du departement, en objets, annee par annee. */
async function* lignesDvf(dept, { journal = () => {} } = {}) {
  for (const annee of anneesDvf()) {
    const chemin = path.join(CACHE, 'dvf', `${annee}-${dept}.csv.gz`);
    fs.mkdirSync(path.dirname(chemin), { recursive: true });
    if (!fs.existsSync(chemin)) journal(`DVF ${annee} : telechargement…`);
    // L'URL redirige (302) vers le fichier : fetch suit. Un millesime pas encore publie rend 404.
    const ok = await telecharger(`${SOURCES.dvf.url}/${annee}/departements/${dept}.csv.gz`, chemin).catch(() => null);
    if (!ok) continue;
    const rl = readline.createInterface({ input: fs.createReadStream(chemin).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    let cols = null;
    for await (const l of rl) {
      if (!cols) { cols = l.split(','); continue; }
      const v = decouperCsv(l);
      const o = {};
      for (let i = 0; i < cols.length; i += 1) o[cols[i]] = v[i];
      yield o;
    }
  }
}

// ---------------------------------------------------------------------------
// API Recherche d'entreprises (limite publique : 7 appels par seconde)
// ---------------------------------------------------------------------------

let prochainAppel = 0;
const INTERVALLE_MS = 180; // ~5,5 appels par seconde, sous la limite
async function annuaire(chemin, params) {
  const url = `${SOURCES.annuaire.url}${chemin}?${new URLSearchParams(params)}`;
  for (let essai = 0; essai < 5; essai += 1) {
    const attente = prochainAppel - Date.now();
    prochainAppel = Math.max(Date.now(), prochainAppel) + INTERVALLE_MS;
    if (attente > 0) await attendre(attente);
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (r.status === 429) { await attendre(2000 * (essai + 1)); continue; }
      if (r.status === 404) return { results: [] };
      if (!r.ok) throw new Error(`Recherche d'entreprises a repondu ${r.status}`);
      return await r.json();
    } catch (e) {
      if (essai === 4) throw e;
      await attendre(1000 * (essai + 1));
    }
  }
  return { results: [] };
}

/** Les entreprises ayant un etablissement actif dans un rayon (km) autour d'un point. */
async function entreprisesAutour(lat, lon, rayonKm, { pagesMax = 4 } = {}) {
  const out = [];
  for (let page = 1; page <= pagesMax; page += 1) {
    const j = await annuaire('/near_point', { lat: String(lat), long: String(lon), radius: String(rayonKm), etat_administratif: 'A', per_page: '25', page: String(page) });
    out.push(...(j.results || []));
    if (page >= (j.total_pages || 1)) break;
  }
  return out;
}

/** Une entreprise par son SIREN (null si inconnue ou non diffusible). */
async function entreprise(siren) {
  const j = await annuaire('/search', { q: siren, per_page: '1' });
  return (j.results || []).find((r) => r.siren === siren) || null;
}

// ---------------------------------------------------------------------------
// BODACC : les annonces d'un SIREN depuis une date
// ---------------------------------------------------------------------------

async function annoncesBodacc(siren, depuis) {
  const where = `registre like "${siren}" and dateparution >= date'${depuis}'`;
  const url = `${SOURCES.bodacc.url}?${new URLSearchParams({ where, order_by: 'dateparution desc', limit: '50' })}`;
  for (let essai = 0; essai < 3; essai += 1) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (r.status === 429) { await attendre(3000); continue; }
      if (!r.ok) throw new Error(`BODACC a repondu ${r.status}`);
      return (await r.json()).results || [];
    } catch (e) {
      if (essai === 2) throw e;
      await attendre(1500);
    }
  }
  return [];
}

module.exports = {
  RACINE, CACHE, SOURCES, aujourdhui, departementDuFichier, inseeDe, COL, lignesDgfip, cadastreCommune,
  anneesDvf, decouperCsv, lignesDvf, entreprisesAutour, entreprise, annoncesBodacc,
};
