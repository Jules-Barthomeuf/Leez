// Stade d'analyse du deal (Écran 1/3 de la spec "vertical AI") : triage ->
// underwriting -> comite, plus les issues attente/rejete. Toujours defini
// par une ACTION MANUELLE de l'analyste (barre d'action de l'ecran Triage),
// jamais par une inference du modele -- la valeur par defaut 'triage'
// reflete simplement qu'un deal fraichement importe n'a pas encore ete
// arbitre. Contrainte CHECK plutot qu'un enum Postgres : meme garantie
// d'integrite, sans le cout d'un ALTER TYPE si un stade s'ajoute un jour.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('documents', {
    stage: { type: 'text', notNull: true, default: 'triage' },
  });
  pgm.addConstraint('documents', 'documents_stage_check', {
    check: "stage IN ('triage', 'underwriting', 'comite', 'attente', 'rejete')",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('documents', 'documents_stage_check');
  pgm.dropColumn('documents', 'stage');
};
