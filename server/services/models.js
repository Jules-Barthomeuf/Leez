// Choix des modèles, centralisé et configurable par variables
// d'environnement. Par défaut : le comportement actuel (Opus 5 partout) --
// aucune bascule silencieuse vers un modèle moins cher, c'est une décision
// qui appartient à l'exploitant, pas au code.
//
//   ANTHROPIC_MODEL             remplace TOUS les rôles ci-dessous
//   ANTHROPIC_MODEL_EXTRACTION  extraction des documents (le plus coûteux :
//                               le PDF est envoyé à chaque appel)
//   ANTHROPIC_MODEL_CHAT        assistant, récapitulatif, présentation, simulateur
//   ANTHROPIC_MODEL_WEB         recherche web (affirmations vendeur, locataires)
//
// Identifiants valides : claude-opus-5, claude-sonnet-5, claude-haiku-4-5.
const DEFAULT_MODEL = 'claude-opus-5';
const override = (process.env.ANTHROPIC_MODEL || '').trim();

function pick(roleEnvVar) {
  return (process.env[roleEnvVar] || '').trim() || override || DEFAULT_MODEL;
}

module.exports = {
  EXTRACTION_MODEL: pick('ANTHROPIC_MODEL_EXTRACTION'),
  CHAT_MODEL: pick('ANTHROPIC_MODEL_CHAT'),
  WEB_MODEL: pick('ANTHROPIC_MODEL_WEB'),
};
