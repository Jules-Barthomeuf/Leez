// Invitation par lien : l'administrateur cree le compte, envoie un lien, et
// la personne n'a plus qu'a choisir son mot de passe.
//
// password_hash devient nullable : entre la creation du compte et la
// definition du mot de passe, il n'y a AUCUN mot de passe -- stocker un
// hash bidon serait un identifiant utilisable par accident. Un compte sans
// hash ne peut pas se connecter (voir routes/auth.js#login).
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.alterColumn('users', 'password_hash', { notNull: false });
  pgm.addColumns('users', {
    // Jeton stocke HACHE (sha256) : une fuite de la base ne permet pas de
    // reconstituer un lien d'invitation valide.
    invite_token_hash: { type: 'text', notNull: false },
    invite_expires_at: { type: 'timestamptz', notNull: false },
  });
  pgm.createIndex('users', 'invite_token_hash');
};

exports.down = (pgm) => {
  pgm.dropIndex('users', 'invite_token_hash');
  pgm.dropColumns('users', ['invite_token_hash', 'invite_expires_at']);
  pgm.alterColumn('users', 'password_hash', { notNull: true });
};
