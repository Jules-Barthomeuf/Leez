// Wrapper PostHog cote serveur -- no-op propre si POSTHOG_API_KEY est
// absente (l'utilisateur cree son compte PostHog APRES le premier
// deploiement, voir render.yaml). Jamais un appel bloquant : track()
// echoue silencieusement au pire, ne doit jamais faire echouer la requete
// qui l'appelle.
//
// Contrainte NDA (les OM sont sous accord de confidentialite) : ce module
// ne doit RECEVOIR que des metadonnees d'usage (noms d'evenements,
// compteurs, codes d'erreur courts) -- jamais du contenu de document, un
// nom de locataire, une adresse, un montant extrait. Cote appelant, jamais
// cote analytics.js (qui ne filtre rien lui-meme).
const { PostHog } = require('posthog-node');

const client = process.env.POSTHOG_API_KEY
  ? new PostHog(process.env.POSTHOG_API_KEY, { host: process.env.POSTHOG_HOST || 'https://eu.i.posthog.com' })
  : null;

function track(event, distinctId, properties) {
  try { client?.capture({ distinctId, event, properties }); } catch { /* jamais bloquant */ }
}
function identify(distinctId, properties) {
  try { client?.identify({ distinctId, properties }); } catch { /* jamais bloquant */ }
}
async function shutdown() {
  try { await client?._shutdown(); } catch { /* deja arrete ou jamais demarre */ }
}

module.exports = { track, identify, shutdown };
