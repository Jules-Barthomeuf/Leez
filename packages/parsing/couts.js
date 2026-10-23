// Prix unitaires des services, en configuration (jamais en dur dans les
// parseurs), et conversion en euros. Chaque variable est documentee dans
// .env.example avec sa source et sa date. Sans variable, le cout est null
// (« non mesuré »), jamais une valeur devinee.
const USD_EUR = Number(process.env.USD_EUR) > 0 ? Number(process.env.USD_EUR) : null;

/** Prix en euros d'une quantite (ex. milliers de pages) au tarif de la variable donnee (en USD). null si non configure. */
function prixEnEuros(variable, quantite) {
  const prix = Number(process.env[variable]);
  if (!(prix >= 0) || !process.env[variable] || USD_EUR == null) return null;
  return Math.round(prix * quantite * USD_EUR * 1e6) / 1e6;
}

/** Cout en euros d'un appel a un modele Claude, d'apres les tokens et les prix par million (USD). */
function coutClaude(modele, usage) {
  const prixEntree = Number(process.env[`CLAUDE_PRIX_ENTREE_USD_MTOK_${modele.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`] || process.env.CLAUDE_PRIX_ENTREE_USD_MTOK);
  const prixSortie = Number(process.env[`CLAUDE_PRIX_SORTIE_USD_MTOK_${modele.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`] || process.env.CLAUDE_PRIX_SORTIE_USD_MTOK);
  if (!(prixEntree > 0) || !(prixSortie > 0) || USD_EUR == null || !usage) return null;
  const entree = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) * 0.1 + (usage.cache_creation_input_tokens || 0) * 1.25;
  return Math.round(((entree * prixEntree + (usage.output_tokens || 0) * prixSortie) / 1e6) * USD_EUR * 1e6) / 1e6;
}

module.exports = { USD_EUR, prixEnEuros, coutClaude };
