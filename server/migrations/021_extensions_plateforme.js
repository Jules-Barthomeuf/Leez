// Extensions de la plateforme (decision A2), rejouable : unaccent et pg_trgm
// sont creees si elles manquent ; vector aussi, quand le serveur la propose
// (Render oui, Postgres embarque local non). Le demarrage du serveur et du
// worker verifie ensuite leur presence (server/plateforme/db.js,
// verifierExtensions) et echoue explicitement si l'une manque.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS unaccent;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
        CREATE EXTENSION IF NOT EXISTS vector;
      END IF;
    END $$;
  `);
};

exports.down = () => {
  // Les extensions restent : d'autres objets (chunks.embedding, french_unaccent) en dependent.
};
