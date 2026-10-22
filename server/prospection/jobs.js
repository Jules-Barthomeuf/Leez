// Les analyses de departements tournent en tache de fond dans le serveur, une
// a la fois (l'API Recherche d'entreprises limite les appels pour tout le
// monde), dans une file d'attente : un mandat sur deux regions met ses
// departements manquants en file, et l'ecran suit la progression par sondage.
// Une analyse en erreur peut etre relancee : le cache disque reprend la ou
// elle s'etait arretee.

const fs = require('fs');
const path = require('path');
const { lancer } = require('./pipeline');
const { RACINE } = require('./sources');

// La file est gardee sur disque : un redemarrage du serveur (deploiement, nodemon) ne perd plus
// les departements en attente ni celui en cours, qui reprend grace au cache des reponses d'API.
const FICHIER = path.join(RACINE, 'file.json');
function sauver() {
  const attente = [...(courant && courant.etat === 'en_cours' ? [courant.dept] : []), ...file];
  try { fs.writeFileSync(FICHIER, JSON.stringify({ attente })); } catch { /* disque plein ou en lecture seule : la file reste en memoire */ }
}

const file = []; // departements en attente
let courant = null; // { dept, etat, etape, message, fait, total, debut, fin, erreur, journal[] }
const derniers = new Map(); // dernier etat connu par departement

function etat(dept) {
  if (courant && courant.dept === dept) return courant;
  if (file.includes(dept)) return { dept, etat: 'attente', position: file.indexOf(dept) + 1 };
  return derniers.get(dept) || null;
}

function vueFile() {
  return {
    en_cours: courant && courant.etat === 'en_cours' ? { dept: courant.dept, message: courant.message, fait: courant.fait, total: courant.total, etape: courant.etape } : null,
    attente: [...file],
    erreurs: [...derniers.values()].filter((j) => j.etat === 'erreur').map((j) => ({ dept: j.dept, erreur: j.erreur, fin: j.fin })),
  };
}

function suivant() {
  if (courant && courant.etat === 'en_cours') return;
  const dept = file.shift();
  if (!dept) { sauver(); return; }
  courant = { dept, etat: 'en_cours', etape: 'depart', message: 'Démarrage…', fait: null, total: null, debut: new Date().toISOString(), fin: null, erreur: null, journal: [] };
  const job = courant;
  const journal = (m) => { job.journal.push(`${new Date().toISOString().slice(11, 19)} ${m}`); if (job.journal.length > 200) job.journal.shift(); console.log(`[prospection ${dept}] ${m}`); };
  lancer(dept, { journal, progres: (p) => Object.assign(job, p) })
    .then((r) => Object.assign(job, { etat: 'fini', fin: new Date().toISOString(), cibles: r.cibles.length }))
    .catch((e) => { journal(`Erreur : ${e.message}`); Object.assign(job, { etat: 'erreur', erreur: e.message, fin: new Date().toISOString() }); })
    .finally(() => { derniers.set(dept, job); sauver(); setImmediate(suivant); });
  sauver();
}

/** Met des departements en file (ceux deja en cours ou en attente sont ignores). Rend la file. */
function ajouter(depts) {
  for (const d of depts) {
    if ((courant && courant.etat === 'en_cours' && courant.dept === d) || file.includes(d)) continue;
    file.push(d);
  }
  suivant();
  return vueFile();
}

// Au demarrage : reprendre la file laissee par le processus precedent.
try {
  const { attente } = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
  if (Array.isArray(attente) && attente.length && !process.env.NODE_TEST_CONTEXT) setTimeout(() => ajouter(attente.map(String)), 3000);
} catch { /* pas de file enregistree */ }

module.exports = { ajouter, etat, vueFile };
