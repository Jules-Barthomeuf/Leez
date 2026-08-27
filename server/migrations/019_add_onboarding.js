// Parcours d'accueil : rendez-vous strategique puis acculturation
// (facultative). Deux marqueurs par compte, jamais de blocage de l'app --
// l'acculturation est explicitement optionnelle.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('users', {
    // Renseigne par le webhook de l'outil de reservation (ou a la main par
    // l'administrateur) -- c'est la preuve que le rendez-vous existe.
    meeting_booked_at: { type: 'timestamptz', notNull: false },
    // La personne a vu (et ferme) l'invitation a s'acculturer.
    acculturation_seen_at: { type: 'timestamptz', notNull: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('users', ['meeting_booked_at', 'acculturation_seen_at']);
};
