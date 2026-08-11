// Socle de l'orchestration multi-agents (voir plan "Leez -- spécification :
// orchestration multi-agents", Lot 1). agent_runs = une ligne par execution
// d'agent (reprenable/auditable) ; agent_findings = une ligne par element
// produit, JAMAIS sans source_url (voir server/services/agentOutputValidation.js
// qui l'impose cote code avant toute ecriture -- la contrainte notNull ici
// n'est que le dernier filet).
//
// Pas de colonne workspace_id sur ces deux tables : le scoping se fait via
// dossier_id -> documents(id), meme pattern deja en place pour
// supporting_documents (voir 004_create_supporting_documents.js) -- tout
// appelant doit d'abord verifier le dossier parent via getDocument(id,
// workspaceId) avant d'operer sur ses agent_runs/agent_findings.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('agent_runs', {
    id: { type: 'uuid', primaryKey: true },
    dossier_id: { type: 'uuid', notNull: true, references: 'documents(id)', onDelete: 'CASCADE' },
    // enum applicatif (pas un type Postgres ENUM) : coherent avec le choix
    // deja fait pour documents.status/failed_stage, plus simple a faire
    // evoluer (ajouter un type d'agent) sans migration de type.
    agent_type: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'queued' },
    launched_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    depends_on: { type: 'uuid[]', notNull: true, default: pgm.func("'{}'::uuid[]") },
    steps_total: { type: 'int', notNull: true, default: 1 },
    steps_done: { type: 'int', notNull: true, default: 0 },
    current_step_label: { type: 'text' },
    sources_count: { type: 'int', notNull: true, default: 0 },
    result: { type: 'jsonb' },
    error_message: { type: 'text' },
    token_cost: { type: 'int' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    started_at: { type: 'timestamptz' },
    ended_at: { type: 'timestamptz' },
  });
  pgm.createIndex('agent_runs', 'dossier_id');
  pgm.createIndex('agent_runs', ['dossier_id', 'agent_type']);

  pgm.createTable('agent_findings', {
    id: { type: 'uuid', primaryKey: true },
    agent_run_id: { type: 'uuid', notNull: true, references: 'agent_runs(id)', onDelete: 'CASCADE' },
    // denormalise depuis agent_runs.dossier_id -- evite un JOIN pour toute
    // lecture "findings de ce dossier" (page Donnees, Points d'attention...).
    dossier_id: { type: 'uuid', notNull: true, references: 'documents(id)', onDelete: 'CASCADE' },
    kind: { type: 'text', notNull: true },
    payload: { type: 'jsonb', notNull: true },
    source_url: { type: 'text', notNull: true },
    source_label: { type: 'text' },
    source_date: { type: 'date' },
    source_tier: { type: 'text', notNull: true },
    validation_status: { type: 'text', notNull: true, default: 'pending' },
    target_field: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('agent_findings', 'agent_run_id');
  pgm.createIndex('agent_findings', 'dossier_id');
};

exports.down = (pgm) => {
  pgm.dropTable('agent_findings');
  pgm.dropTable('agent_runs');
};
