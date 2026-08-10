// Traduction fidele de la table `documents` de schema.sql (SQLite) vers
// Postgres : les colonnes *_json passent en JSONB natif (pg les
// lit/ecrit comme des objets/tableaux JS directement, plus besoin de
// JSON.stringify/parse manuel cote application), is_demo devient un vrai
// boolean plutot qu'un entier 0/1.
//
// Volontairement PAS de colonne workspace_id ni failed_stage ici : ce
// Milestone est une migration de moteur de stockage a comportement
// identique (SQLite -> Postgres), rien d'autre. workspace_id arrivera avec
// le Milestone Auth (quand le code sait reellement quoi y mettre a chaque
// insertion), failed_stage avec le Milestone Resilience pipeline -- les
// ajouter maintenant, non utilises, rendrait ce Milestone impossible a
// verifier isolement.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('documents', {
    id: { type: 'uuid', primaryKey: true },
    filename: { type: 'text', notNull: true },
    uploaded_at: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true },
    error_message: { type: 'text' },
    page_count: { type: 'integer' },
    pages_json: { type: 'jsonb' },
    fiche_identite_json: { type: 'jsonb' },
    etat_locatif_json: { type: 'jsonb' },
    t12_json: { type: 'jsonb' },
    mix_json: { type: 'jsonb' },
    expiry_json: { type: 'jsonb' },
    indicateurs_json: { type: 'jsonb' },
    consistency_json: { type: 'jsonb' },
    red_flags_json: { type: 'jsonb' },
    is_demo: { type: 'boolean', notNull: true, default: false },
    contexte_narratif_json: { type: 'jsonb' },
    notes: { type: 'text' },
    simulation_json: { type: 'jsonb' },
    vendor_claims_json: { type: 'jsonb' },
    presentation_hidden_cards_json: { type: 'jsonb' },
    deal_recap_json: { type: 'jsonb' },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('documents');
};
