// Deux changements lies a l'auto-inscription personnelle (sans creation de
// fonds) : (1) un nom d'affichage pour la personne (le champ "Nom" du
// formulaire d'inscription -- jusqu'ici il n'existait aucune notion de nom,
// seulement l'email) ; (2) workspace_id devient NULLABLE : un compte
// auto-inscrit n'appartient a aucun fonds tant qu'un administrateur (voir
// SUPER_ADMIN_EMAIL / routes/admin.js) ne l'a pas rattache a un fonds
// existant ou nouvellement cree. Les comptes crees via create-user.js ou
// "Ajouter un membre" continuent d'avoir un workspace_id des la creation --
// rien ne change pour eux.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('users', { name: { type: 'text' } });
  pgm.alterColumn('users', 'workspace_id', { notNull: false });
};

exports.down = (pgm) => {
  pgm.dropColumn('users', 'name');
  pgm.alterColumn('users', 'workspace_id', { notNull: true });
};
