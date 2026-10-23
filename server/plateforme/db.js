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

module.exports = { avecOrg, avecSysteme, uuidValide, pool };
