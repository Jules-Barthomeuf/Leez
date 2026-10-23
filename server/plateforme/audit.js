// Journal des actions utilisateur (principe 6) : une ligne audit_events par
// action, ecrite dans la meme transaction que l'action elle-meme.
async function journaliser(client, { orgId, acteur = null, action, type, id = null, payload = null }) {
  await client.query(
    'INSERT INTO plateforme.audit_events (org_id, actor_user_id, action, entity_type, entity_id, payload) VALUES ($1, $2, $3, $4, $5, $6)',
    [orgId, acteur, action, type, id, payload == null ? null : JSON.stringify(payload)],
  );
}

module.exports = { journaliser };
