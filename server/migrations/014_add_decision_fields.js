// Décision sur un dossier (cycle Vault -> Mémoire) : quand l'analyste
// rejette un dossier, il fournit un MOTIF obligatoire ; le dossier sort du
// Vault (liste active) mais reste intégralement en base et apparaît dans
// Mémoire avec son motif, qui a décidé et quand. Un rappel vers le Vault
// (stage != 'rejete') CONSERVE ces champs : ils deviennent l'historique
// "précédemment refusé le X pour : ..." affiché en tête du dossier -- la
// mémoire du fonds ne s'efface jamais silencieusement.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('documents', {
    decision_motif: { type: 'text', notNull: false },
    decided_at: { type: 'text', notNull: false },
    decided_by: { type: 'text', notNull: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('documents', ['decision_motif', 'decided_at', 'decided_by']);
};
