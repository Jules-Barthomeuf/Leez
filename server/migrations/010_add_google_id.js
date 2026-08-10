// Permet a un compte deja existant (cree par un administrateur -- voir
// create-user.js / POST /workspace/members) de se connecter aussi via
// "Se connecter avec Google", en plus du mot de passe. Volontairement PAS
// une voie de creation de compte : la connexion Google echoue si aucun
// compte n'existe deja pour l'email Google -- ca preserve le modele "pas
// d'auto-inscription publique" deja en place.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('users', { google_id: { type: 'text' } });
  pgm.createIndex('users', 'google_id', { unique: true, where: 'google_id IS NOT NULL' });
};

exports.down = (pgm) => {
  pgm.dropColumn('users', 'google_id');
};
