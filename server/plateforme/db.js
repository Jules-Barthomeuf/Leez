// Acces a la base pour la plateforme : chaque requete tourne dans une
// transaction qui porte l'organisation et le role courants, lus par les
// politiques RLS du schema `plateforme` (migration 020). Jamais de pool.query
// direct sur une table plateforme.* ailleurs que par ces fonctions.
const { pool } = require('../db');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidValide(s) { return typeof s === 'string' && UUID.test(s); }

async function transaction(reglages, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [cle, valeur] of Object.entries(reglages)) {
      // set_config(..., true) : le reglage meurt avec la transaction, jamais avec la connexion rendue au pool.
      await client.query('SELECT set_config($1, $2, true)', [cle, valeur == null ? '' : String(valeur)]);
    }
    const resultat = await fn(client);
    await client.query('COMMIT');
    return resultat;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Execute fn(client) dans l'organisation orgId avec le role donne ('owner', 'admin', 'analyst',
 * 'viewer', ou 'worker' pour les jobs). Les lignes des autres organisations sont invisibles.
 */
function avecOrg(orgId, role, fn) {
  if (!uuidValide(orgId)) throw new Error('avecOrg : identifiant d\'organisation invalide');
  return transaction({ 'app.org_id': orgId, 'app.role': role || 'analyst' }, fn);
}

/** Mode systeme (seeds, donnees publiques) : ecrit les objets a org_id NULL. */
function avecSysteme(fn) {
  return transaction({ 'app.systeme': '1' }, fn);
}

/**
 * Verifie au demarrage que les extensions de la plateforme sont installees (decision A2).
 * unaccent et pg_trgm sont toujours requises ; vector l'est en production (NODE_ENV=production)
 * ou si REQUIRE_PGVECTOR=true, sinon son absence est seulement signalee (Postgres embarque local).
 * Leve une erreur explicite, qui doit arreter le processus.
 */
async function verifierExtensions() {
  const { rows } = await pool.query("SELECT extname FROM pg_extension WHERE extname IN ('vector', 'unaccent', 'pg_trgm')");
  const presentes = new Set(rows.map((r) => r.extname));
  const vectorRequise = process.env.NODE_ENV === 'production' || process.env.REQUIRE_PGVECTOR === 'true';
  const manquantes = ['unaccent', 'pg_trgm', ...(vectorRequise ? ['vector'] : [])].filter((e) => !presentes.has(e));
  if (manquantes.length) {
    throw new Error(`Extensions Postgres manquantes : ${manquantes.join(', ')}. Lancez \`node scripts/check-db.js\` puis, sur la base, CREATE EXTENSION ${manquantes[0]}; (la migration 021 le fait si l'extension est disponible sur le serveur).`);
  }
  if (!presentes.has('vector')) console.warn('[plateforme] pgvector absent : toléré hors production, la recherche vectorielle (phase 4) se fera en mémoire.');
  return { presentes: [...presentes] };
}

module.exports = { avecOrg, avecSysteme, uuidValide, pool, verifierExtensions };
