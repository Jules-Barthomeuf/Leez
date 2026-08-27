// Resolution geographique pour le critere de localisation du mandat.
//
// Le test etait une simple recherche de sous-chaine : un mandat "Europe"
// confronte a "Coslada, Communaute de Madrid" concluait a un ECHEC, alors
// qu'il ne savait simplement pas relier les deux libelles.
//
// Principe directeur, coherent avec le reste de l'app : on ne declare un
// echec que si on peut POSITIVEMENT etablir la non-appartenance. Dans le
// doute, 'indetermine' -- un "je ne sais pas" honnete vaut mieux qu'un
// "hors mandat" faux, qui ferait rejeter un dossier a tort.

// Presentation : "espagne" -> "Espagne", "royaume-uni" -> "Royaume-Uni".
function majuscule(s) {
  return String(s || '').replace(/(^|[\s-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire les accents
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pays d'Europe (nom francais, et variantes locales usuelles). La valeur
// est la chaine d'ancetres, du plus proche au plus large.
const PAYS_EUROPE = [
  'france', 'espagne', 'spain', 'espana', 'portugal', 'italie', 'italia', 'italy',
  'allemagne', 'deutschland', 'germany', 'belgique', 'belgium', 'belgie',
  'pays-bas', 'pays bas', 'nederland', 'netherlands', 'hollande',
  'luxembourg', 'suisse', 'switzerland', 'schweiz', 'autriche', 'austria',
  'royaume-uni', 'royaume uni', 'united kingdom', 'angleterre', 'england',
  'ecosse', 'scotland', 'pays de galles', 'wales', 'irlande', 'ireland',
  'danemark', 'denmark', 'suede', 'sweden', 'norvege', 'norway', 'finlande', 'finland',
  'pologne', 'poland', 'polska', 'republique tcheque', 'tchequie', 'czechia',
  'slovaquie', 'slovakia', 'hongrie', 'hungary', 'roumanie', 'romania',
  'bulgarie', 'bulgaria', 'grece', 'greece', 'croatie', 'croatia', 'slovenie', 'slovenia',
  'serbie', 'serbia', 'estonie', 'estonia', 'lettonie', 'latvia', 'lituanie', 'lithuania',
  'islande', 'iceland', 'malte', 'malta', 'chypre', 'cyprus', 'monaco', 'andorre',
];

// Subdivisions et villes -> pays. Volontairement cible sur les marches
// immobiliers europeens courants, pas une base geographique exhaustive :
// tout ce qui n'est pas connu retombe sur 'indetermine', jamais sur un
// echec invente.
const VERS_PAYS = {
  // Espagne
  'madrid': 'espagne', 'communaute de madrid': 'espagne', 'comunidad de madrid': 'espagne',
  'coslada': 'espagne', 'barcelone': 'espagne', 'barcelona': 'espagne', 'catalogne': 'espagne',
  'cataluna': 'espagne', 'valence': 'espagne', 'valencia': 'espagne', 'seville': 'espagne',
  'sevilla': 'espagne', 'bilbao': 'espagne', 'malaga': 'espagne', 'saragosse': 'espagne',
  'zaragoza': 'espagne', 'andalousie': 'espagne', 'andalucia': 'espagne',
  // France (regions et grandes villes)
  'ile-de-france': 'france', 'ile de france': 'france', 'paris': 'france',
  'hauts-de-seine': 'france', 'seine-saint-denis': 'france', 'val-de-marne': 'france',
  'seine-et-marne': 'france', 'yvelines': 'france', 'essonne': 'france', "val-d oise": 'france',
  'lyon': 'france', 'marseille': 'france', 'lille': 'france', 'bordeaux': 'france',
  'toulouse': 'france', 'nantes': 'france', 'strasbourg': 'france', 'montpellier': 'france',
  'rennes': 'france', 'nice': 'france', 'grenoble': 'france', 'meaux': 'france',
  'auvergne-rhone-alpes': 'france', 'nouvelle-aquitaine': 'france', 'occitanie': 'france',
  'hauts-de-france': 'france', 'grand est': 'france', 'bretagne': 'france',
  'pays de la loire': 'france', 'normandie': 'france', 'centre-val de loire': 'france',
  "provence-alpes-cote d azur": 'france', 'bourgogne-franche-comte': 'france', 'corse': 'france',
  // Royaume-Uni
  'londres': 'royaume-uni', 'london': 'royaume-uni', 'manchester': 'royaume-uni',
  'birmingham': 'royaume-uni', 'leeds': 'royaume-uni', 'hull': 'royaume-uni',
  'kingston upon hull': 'royaume-uni', 'yorkshire': 'royaume-uni', 'east riding of yorkshire': 'royaume-uni',
  'peterborough': 'royaume-uni', 'chingford': 'royaume-uni', 'cwmbran': 'royaume-uni',
  // Autres marches courants
  'amsterdam': 'pays-bas', 'rotterdam': 'pays-bas', 'la haye': 'pays-bas', 'utrecht': 'pays-bas',
  'panningen': 'pays-bas', 'rhoon': 'pays-bas', 'limbourg': 'pays-bas',
  'bruxelles': 'belgique', 'anvers': 'belgique', 'gand': 'belgique',
  'berlin': 'allemagne', 'munich': 'allemagne', 'francfort': 'allemagne', 'hambourg': 'allemagne',
  'cologne': 'allemagne', 'dusseldorf': 'allemagne', 'baviere': 'allemagne',
  'milan': 'italie', 'rome': 'italie', 'turin': 'italie', 'naples': 'italie', 'lombardie': 'italie',
  'lisbonne': 'portugal', 'porto': 'portugal',
  'varsovie': 'pologne', 'cracovie': 'pologne',
  'vienne': 'autriche', 'zurich': 'suisse', 'geneve': 'suisse', 'bale': 'suisse',
  'dublin': 'irlande', 'copenhague': 'danemark', 'stockholm': 'suede', 'oslo': 'norvege',
  'helsinki': 'finlande', 'tampere': 'finlande', 'prague': 'republique tcheque',
  'budapest': 'hongrie', 'athenes': 'grece', 'bucarest': 'roumanie',
};

// Un code postal francais a 5 chiffres implique la France (et l'Europe).
const CODE_POSTAL_FR = /\b\d{5}\b/;

// Tous les lieux que ce module sait situer -- sert a distinguer "je connais
// ce lieu et il n'est pas dans la cible" (echec) de "je ne le connais pas"
// (indetermine).
function estLieuConnu(terme) {
  const t = normalize(terme);
  if (t === 'europe') return true;
  if (PAYS_EUROPE.includes(t)) return true;
  return Object.prototype.hasOwnProperty.call(VERS_PAYS, t);
}

// Ensemble des lieux impliques par un texte : les termes qu'on y reconnait,
// plus leurs ancetres (pays, puis continent).
function ancetres(texte) {
  const t = normalize(texte);
  const out = new Set();
  const ajouterPays = pays => {
    out.add(pays);
    if (PAYS_EUROPE.includes(pays)) out.add('europe');
  };

  for (const [lieu, pays] of Object.entries(VERS_PAYS)) {
    if (t.includes(lieu)) { out.add(lieu); ajouterPays(pays); }
  }
  for (const pays of PAYS_EUROPE) {
    if (t.includes(pays)) ajouterPays(pays);
  }
  if (t.includes('europe')) out.add('europe');
  if (CODE_POSTAL_FR.test(t)) ajouterPays('france');
  return out;
}

// Verdict du critere de localisation.
//   'ok'          : appartenance etablie (texte ou hierarchie)
//   'echec'       : non-appartenance ETABLIE (les deux lieux sont connus et
//                   le bien n'est pas dans la cible)
//   'indetermine' : impossible de conclure -- jamais un echec par defaut
function evaluerLocalisation(cible, observe) {
  const c = normalize(cible);
  const o = normalize(observe);
  if (!c || !o) return { status: 'indetermine', motif: 'Localisation du bien non extraite.' };

  // 1. Correspondance textuelle directe (ex. cible "Paris" / "75013 Paris").
  if (o.includes(c)) return { status: 'ok', motif: `« ${observe} » correspond textuellement à « ${cible} ».` };

  // 2. Hierarchie : la cible est-elle un ancetre du lieu observe ?
  const anc = ancetres(o);
  if (anc.has(c)) return { status: 'ok', motif: `« ${observe} » se situe en ${cible}.` };

  // 3. Non-appartenance etablie : on connait les deux cotes.
  if (estLieuConnu(c) && anc.size > 0) {
    // On nomme le PAYS (le niveau qui parle a un analyste), pas la liste
    // brute de tous les niveaux reconnus.
    const pays = [...anc].find(x => PAYS_EUROPE.includes(x));
    const situe = pays ? majuscule(pays) : [...anc].map(majuscule).join(', ');
    return { status: 'echec', motif: `« ${observe} » se situe en ${situe} — hors de la cible « ${cible} ».` };
  }

  // 4. Sinon : on ne sait pas relier les deux libelles.
  return {
    status: 'indetermine',
    motif: estLieuConnu(c)
      ? `Localisation du bien non reconnue — impossible de vérifier l'appartenance à « ${cible} ».`
      : `Cible « ${cible} » non reconnue comme zone géographique — vérification manuelle nécessaire.`,
  };
}

module.exports = { evaluerLocalisation, ancetres, normalize, estLieuConnu, majuscule };
