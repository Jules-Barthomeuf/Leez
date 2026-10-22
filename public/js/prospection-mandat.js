// Prospection cession-bail : les mandats SCPI. Regions et departements, et la
// lecture d'une phrase libre (« SCPI logistique et activite, 8 a 30 M€,
// Auvergne-Rhone-Alpes et PACA, bail ferme 9 ans minimum ») en criteres, que
// l'ecran affiche ensuite en formulaire a valider. Lecture deterministe : ce
// qui n'est pas reconnu reste vide, rien n'est invente. Serveur et navigateur.

(function (racine, fabrique) {
  if (typeof module === 'object' && module.exports) module.exports = fabrique();
  else racine.ProspectionMandat = fabrique();
}(typeof self !== 'undefined' ? self : this, () => {
  const DEPARTEMENTS = {
    '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence', '05': 'Hautes-Alpes', '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes', '09': 'Ariège', 10: 'Aube', 11: 'Aude', 12: 'Aveyron', 13: 'Bouches-du-Rhône', 14: 'Calvados', 15: 'Cantal', 16: 'Charente', 17: 'Charente-Maritime', 18: 'Cher', 19: 'Corrèze', '2A': 'Corse-du-Sud', '2B': 'Haute-Corse', 21: "Côte-d'Or", 22: "Côtes-d'Armor", 23: 'Creuse', 24: 'Dordogne', 25: 'Doubs', 26: 'Drôme', 27: 'Eure', 28: 'Eure-et-Loir', 29: 'Finistère', 30: 'Gard', 31: 'Haute-Garonne', 32: 'Gers', 33: 'Gironde', 34: 'Hérault', 35: 'Ille-et-Vilaine', 36: 'Indre', 37: 'Indre-et-Loire', 38: 'Isère', 39: 'Jura', 40: 'Landes', 41: 'Loir-et-Cher', 42: 'Loire', 43: 'Haute-Loire', 44: 'Loire-Atlantique', 45: 'Loiret', 46: 'Lot', 47: 'Lot-et-Garonne', 48: 'Lozère', 49: 'Maine-et-Loire', 50: 'Manche', 51: 'Marne', 52: 'Haute-Marne', 53: 'Mayenne', 54: 'Meurthe-et-Moselle', 55: 'Meuse', 56: 'Morbihan', 57: 'Moselle', 58: 'Nièvre', 59: 'Nord', 60: 'Oise', 61: 'Orne', 62: 'Pas-de-Calais', 63: 'Puy-de-Dôme', 64: 'Pyrénées-Atlantiques', 65: 'Hautes-Pyrénées', 66: 'Pyrénées-Orientales', 67: 'Bas-Rhin', 68: 'Haut-Rhin', 69: 'Rhône', 70: 'Haute-Saône', 71: 'Saône-et-Loire', 72: 'Sarthe', 73: 'Savoie', 74: 'Haute-Savoie', 75: 'Paris', 76: 'Seine-Maritime', 77: 'Seine-et-Marne', 78: 'Yvelines', 79: 'Deux-Sèvres', 80: 'Somme', 81: 'Tarn', 82: 'Tarn-et-Garonne', 83: 'Var', 84: 'Vaucluse', 85: 'Vendée', 86: 'Vienne', 87: 'Haute-Vienne', 88: 'Vosges', 89: 'Yonne', 90: 'Territoire de Belfort', 91: 'Essonne', 92: 'Hauts-de-Seine', 93: 'Seine-Saint-Denis', 94: 'Val-de-Marne', 95: "Val-d'Oise", 971: 'Guadeloupe', 972: 'Martinique', 973: 'Guyane', 974: 'La Réunion', 976: 'Mayotte',
  };
  const REGIONS = {
    'Auvergne-Rhône-Alpes': { alias: ['aura', 'auvergne rhone alpes', 'rhone alpes', 'auvergne'], depts: ['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74'] },
    'Bourgogne-Franche-Comté': { alias: ['bfc', 'bourgogne franche comte', 'bourgogne', 'franche comte'], depts: ['21', '25', '39', '58', '70', '71', '89', '90'] },
    Bretagne: { alias: ['bretagne'], depts: ['22', '29', '35', '56'] },
    'Centre-Val de Loire': { alias: ['centre val de loire', 'centre'], depts: ['18', '28', '36', '37', '41', '45'] },
    Corse: { alias: ['corse'], depts: ['2A', '2B'] },
    'Grand Est': { alias: ['grand est', 'alsace', 'lorraine', 'champagne'], depts: ['08', '10', '51', '52', '54', '55', '57', '67', '68', '88'] },
    'Hauts-de-France': { alias: ['hauts de france', 'hdf', 'nord pas de calais', 'picardie'], depts: ['02', '59', '60', '62', '80'] },
    'Île-de-France': { alias: ['ile de france', 'idf', 'region parisienne'], depts: ['75', '77', '78', '91', '92', '93', '94', '95'] },
    Normandie: { alias: ['normandie'], depts: ['14', '27', '50', '61', '76'] },
    'Nouvelle-Aquitaine': { alias: ['nouvelle aquitaine', 'aquitaine'], depts: ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'] },
    Occitanie: { alias: ['occitanie'], depts: ['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82'] },
    'Pays de la Loire': { alias: ['pays de la loire', 'pdl'], depts: ['44', '49', '53', '72', '85'] },
    "Provence-Alpes-Côte d'Azur": { alias: ['paca', 'provence alpes cote d azur', 'provence', 'cote d azur', 'sud'], depts: ['04', '05', '06', '13', '83', '84'] },
    'Outre-mer': { alias: ['outre mer', 'dom', 'drom'], depts: ['971', '972', '973', '974', '976'] },
  };
  const TYPES = [
    ['logistique', /logisti|entrep[oô]t|plateforme|messagerie/],
    ['activite', /activit|industri|usine|atelier|production|local d.activit/],
    ['commerce', /commerc|retail|magasin|boutique|galerie/],
    ['sante', /sant[eé]|clinique|ehpad|m[eé]dic|sanitaire/],
    ['hotellerie', /h[oô]tel|restaura|h[eé]bergement/],
    ['bureaux', /bureau|tertiaire|si[eè]ge/],
  ];

  const plat = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9%,.\s-]/g, ' ').replace(/[-']/g, ' ').replace(/\s+/g, ' ');
  const nombre = (s) => Number(String(s).replace(',', '.'));
  const LIBELLES_TYPES = { logistique: 'logistique', activite: 'activité', commerce: 'commerce', sante: 'santé', hotellerie: 'hôtellerie', bureaux: 'bureaux', autre: 'autre' };
  const NOMS_DEPTS = Object.entries(DEPARTEMENTS).map(([code, nom]) => [String(code).padStart(2, '0'), plat(nom).trim()]).sort((a, b) => b[1].length - a[1].length);

  const EXPRESSIONS_ZONE = [
    ...Object.entries(REGIONS).flatMap(([nom, r]) => [plat(nom).trim(), ...r.alias].map((texte) => ({ texte, region: nom }))),
    ...NOMS_DEPTS.map(([code, texte]) => ({ texte, code })),
  ].sort((a, b) => b.texte.length - a.texte.length);

  /** Les departements d'une liste de regions ou de codes (« PACA », « 69 », « Rhône »). */
  function departementsDe(liste) {
    const out = new Set();
    for (const brut of liste || []) {
      const x = String(brut).trim();
      const p = plat(x).trim();
      const code = /^\d$/.test(x) ? `0${x}` : x.toUpperCase();
      if (DEPARTEMENTS[code] || DEPARTEMENTS[Number(code)]) { out.add(code); continue; }
      const region = Object.entries(REGIONS).find(([nom, r]) => plat(nom).trim() === p || r.alias.includes(p));
      if (region) { region[1].depts.forEach((d) => out.add(d)); continue; }
      const dep = NOMS_DEPTS.find(([, nom]) => nom === p);
      if (dep) out.add(dep[0]);
    }
    return [...out];
  }

  /**
   * Pure : une phrase libre en criteres de mandat. Rend aussi `reconnu` (ce
   * que la phrase a donne) pour que l'ecran montre ce qui a ete compris.
   */
  function lirePhrase(phrase) {
    const t = ` ${plat(phrase)} `;
    const m = { types: [], zones: [], departements: [], exclusionsTypes: [] };
    const reconnu = [];

    const ticket = t.match(/(\d+(?:[.,]\d+)?)\s*(?:m|me|m€|millions?)?\s*(?:a|-|et)\s*(\d+(?:[.,]\d+)?)\s*(?:m\b|me\b|m€|millions?|m\s?eur)/) || t.match(/entre\s+(\d+(?:[.,]\d+)?)\s*(?:m|millions?)?\s*et\s+(\d+(?:[.,]\d+)?)/);
    if (ticket) { m.ticketMin = nombre(ticket[1]) * 1e6; m.ticketMax = nombre(ticket[2]) * 1e6; reconnu.push(`ticket ${ticket[1]} à ${ticket[2]} M€`); }
    else {
      const min = t.match(/(?:plus de|au moins|minimum|a partir de|des)\s+(\d+(?:[.,]\d+)?)\s*(?:m\b|me\b|m€|millions?)/);
      const max = t.match(/(?:moins de|jusqu a|maximum|au plus)\s+(\d+(?:[.,]\d+)?)\s*(?:m\b|me\b|m€|millions?)/);
      if (min) { m.ticketMin = nombre(min[1]) * 1e6; reconnu.push(`ticket min ${min[1]} M€`); }
      if (max) { m.ticketMax = nombre(max[1]) * 1e6; reconnu.push(`ticket max ${max[1]} M€`); }
    }

    // « hors restauration », « sauf commerce » : exclusions de types.
    const hors = [...t.matchAll(/(?:hors|sauf|pas de|exclure|excluant)\s+([a-z ]{3,30}?)(?=[,.;]|\s(?:et|ni|avec|en|sur)\s|$)/g)].map((x) => x[1]);
    for (const [cle, re] of TYPES) {
      const exclu = hors.some((h) => re.test(h));
      if (exclu) { m.exclusionsTypes.push(cle); continue; }
      if (re.test(t)) m.types.push(cle);
    }
    if (m.types.length) reconnu.push(`types : ${m.types.map((k) => LIBELLES_TYPES[k]).join(', ')}`);
    if (m.exclusionsTypes.length) reconnu.push(`hors : ${m.exclusionsTypes.map((k) => LIBELLES_TYPES[k]).join(', ')}`);

    // Regions et departements, l'expression la plus longue d'abord, retiree du texte une fois lue :
    // « Rhone » n'est pas lu dans « Auvergne-Rhone-Alpes », ni « Corse » ou « sud » dans « Corse-du-Sud ».
    let reste = t;
    const vu = (a) => [` ${a} `, ` ${a},`, ` ${a}.`, ` ${a};`].some((x) => reste.includes(x));
    const deptsNommes = [];
    for (const { texte, region, code } of EXPRESSIONS_ZONE) {
      if (!vu(texte)) continue;
      if (region) { if (!m.zones.includes(region)) m.zones.push(region); } else deptsNommes.push(code);
      reste = reste.split(texte).join(' ');
    }
    const deptsCodes = [...reste.matchAll(/(?:departements?|dept?s?\.?|\()\s*((?:\d{2,3}|2a|2b)(?:\s*(?:,|et|\/)\s*(?:\d{2,3}|2a|2b))*)/g)].flatMap((x) => x[1].split(/\s*(?:,|et|\/)\s*/)).map((c) => c.toUpperCase());
    m.zones.push(...deptsNommes, ...deptsCodes.filter((c) => DEPARTEMENTS[c] || DEPARTEMENTS[Number(c)]));
    m.zones = [...new Set(m.zones)];
    m.departements = departementsDe(m.zones);
    if (m.zones.length) reconnu.push(`zone : ${m.zones.map((z) => (DEPARTEMENTS[z] || DEPARTEMENTS[Number(z)] ? `${DEPARTEMENTS[z] || DEPARTEMENTS[Number(z)]} (${z})` : z)).join(', ')}`);

    const bail = t.match(/bail\s+(?:ferme\s+)?(?:de\s+|d\s+)?(?:au moins\s+|minimum\s+)?(\d{1,2})\s*ans/) || t.match(/(\d{1,2})\s*ans\s+(?:fermes?|minimum|ferme minimum)/);
    if (bail) { m.bailMinAns = Number(bail[1]); reconnu.push(`bail ferme ${bail[1]} ans`); }
    const rdt = t.match(/(?:rendement|taux|yield)[^0-9]{0,20}(\d+(?:[.,]\d+)?)\s*%/) || t.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:de rendement|net|brut)/);
    if (rdt) { m.rendement = nombre(rdt[1]); reconnu.push(`rendement ${rdt[1]} %`); }
    const client = String(phrase || '').match(/\bSCPI\s+((?:[A-ZÉ0-9][\w'’&-]*)(?:\s+[A-ZÉ0-9][\w'’&-]*){0,3})/);
    if (client && !/^(logisti|activit|commerc|bureau|sant|h[oô]tel)/i.test(client[1])) { m.client = client[1].trim(); reconnu.push(`client : ${m.client}`); }
    return { criteres: m, reconnu };
  }

  /** Pure : le nom par defaut d'un mandat d'apres ses criteres. */
  function nomDe(c, types) {
    const mots = (c.types || []).map((k) => LIBELLES_TYPES[k] || k);
    const t = mots.length > 1 ? `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}` : mots[0] || '';
    const tc = t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
    const z = (c.zones || []).length ? c.zones.map((x) => DEPARTEMENTS[x] || DEPARTEMENTS[Number(x)] || x).join(', ') : 'France';
    const ticket = c.ticketMin || c.ticketMax ? `${(c.ticketMin || 0) / 1e6}–${(c.ticketMax || 0) / 1e6} M€` : '';
    return [tc || 'Tous actifs', z, ticket].filter(Boolean).join(' · ');
  }

  const TYPES_VALIDES = ['logistique', 'activite', 'commerce', 'sante', 'hotellerie', 'bureaux', 'autre'];
  const num = (v, min, max, defaut) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut; };
  /**
   * Pure : des criteres de mandat surs (une valeur inconnue retombe sur le defaut).
   * Les zones (regions, departements) donnent la liste des departements.
   */
  function normaliser(c) {
    const x = c && typeof c === 'object' ? c : {};
    const zones = Array.isArray(x.zones) ? x.zones.map(String).slice(0, 120) : [];
    const exclusionsTypes = (Array.isArray(x.exclusionsTypes) ? x.exclusionsTypes : []).filter((t) => TYPES_VALIDES.includes(t));
    let types = (Array.isArray(x.types) ? x.types : []).filter((t) => TYPES_VALIDES.includes(t) && !exclusionsTypes.includes(t));
    if (!types.length) types = TYPES_VALIDES.filter((t) => t !== 'autre' && !exclusionsTypes.includes(t));
    const poids = x.poids || {};
    return {
      ticketMin: num(x.ticketMin, 0, 1e9, 5e6),
      ticketMax: num(x.ticketMax, 0, 1e9, 50e6),
      types, exclusionsTypes, zones,
      departements: zones.length ? departementsDe(zones) : (Array.isArray(x.departements) ? departementsDe(x.departements) : []),
      bailMinAns: num(x.bailMinAns, 0, 30, 9),
      rendement: num(x.rendement, 1, 20, 6.5),
      exclusionsNaf: (Array.isArray(x.exclusionsNaf) ? x.exclusionsNaf : []).map(String).filter((n) => /^\d{2}(\.\d{1,2}[A-Z]?)?$/.test(n)).slice(0, 30),
      poids: { fit: num(poids.fit, 0, 100, 40), motivation: num(poids.motivation, 0, 100, 35), locataire: num(poids.locataire, 0, 100, 25) },
    };
  }

  /** Pure : le nom lisible d'une zone (« 06 » → « Alpes-Maritimes (06) »). */
  const zoneLisible = (z) => (DEPARTEMENTS[z] || DEPARTEMENTS[Number(z)] ? `${DEPARTEMENTS[z] || DEPARTEMENTS[Number(z)]} (${z})` : z);

  return { DEPARTEMENTS, REGIONS, TYPES_VALIDES, departementsDe, lirePhrase, nomDe, normaliser, zoneLisible };
}));
