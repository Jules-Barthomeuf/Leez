// Fiabilite des sources web du verificateur d'affirmations du vendeur --
// taguee ICI, en code deterministe, jamais par le modele : le modele ne fait
// jamais l'auto-evaluation de la qualite de ses propres sources (regle de la
// maison -- ce qui peut etre decide de facon deterministe l'est toujours,
// le modele ne fait que proposer/rechercher). Une source dont le domaine
// figure dans cette liste blanche est etiquetee "officielle" a l'analyste ;
// toute autre reste "a_confirmer" -- jamais l'inverse par defaut.
const OFFICIAL_DOMAIN_SUFFIXES = [
  'insee.fr',
  'data.gouv.fr',
  'ademe.fr',
  'geoportail-urbanisme.gouv.fr',
  'cadastre.data.gouv.fr',
  'service-public.fr',
  'app.dvf.etalab.gouv.fr',
  'legifrance.gouv.fr',
  'impots.gouv.fr',
  'georisques.gouv.fr',
];

function classifySourceReliability(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return 'a_confirmer'; }
  if (host.endsWith('.gouv.fr')) return 'officielle';
  if (OFFICIAL_DOMAIN_SUFFIXES.some(d => host === d || host.endsWith('.' + d))) return 'officielle';
  return 'a_confirmer';
}

module.exports = { classifySourceReliability, OFFICIAL_DOMAIN_SUFFIXES };
