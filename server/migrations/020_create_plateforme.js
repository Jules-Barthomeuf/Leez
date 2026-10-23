// Plateforme Leez (docs/SPEC.md, section 2) : toutes les tables du modele de
// donnees, dans le schema Postgres `plateforme` pour ne pas entrer en
// collision avec les tables historiques (`documents`, etc.). Une organisation
// est un `workspaces.id` (section 21.2) : on ajoute a `workspaces` le slug et
// les reglages, et a `users` le role de membre.
//
// RLS : chaque table a `org_id` est protegee par une politique qui compare
// `org_id` au reglage de session `app.org_id`, pose par avecOrg()
// (server/plateforme/db.js). FORCE ROW LEVEL SECURITY l'applique aussi au
// proprietaire de la table (l'utilisateur de l'application sur Render). Un
// superutilisateur (Postgres embarque local) passe outre : le test
// d'isolation verifie donc aussi l'API de bout en bout.
exports.shorthands = undefined;

const DIM = Number(process.env.EMBEDDING_DIM) || 1024;

// Tables a org_id NOT NULL : politiques de lecture et d'ecriture standard.
const TABLES_ORG = [
  'criteria_sets', 'deliverable_templates', 'deals', 'deal_stage_events', 'lots', 'documents', 'document_pages',
  'chunks', 'extraction_runs', 'evidence', 'facts', 'deal_metrics', 'fact_suggestions', 'anomalies',
  'criteria_evaluations', 'deliverables', 'decisions', 'memory_entries', 'chat_threads', 'chat_messages',
  'inbound_emails', 'llm_calls', 'audit_events',
];
// Tables a org_id NULL possible (objets systeme) : lisibles par tous, ecrits par l'organisation ou par le systeme.
const TABLES_ORG_OU_SYSTEME = ['extraction_templates', 'reconciliation_rules', 'eval_runs'];

exports.up = (pgm) => {
  pgm.sql(`
    CREATE SCHEMA IF NOT EXISTS plateforme;
    CREATE EXTENSION IF NOT EXISTS unaccent;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    -- pgvector quand il est disponible (Render) ; sinon la colonne embedding est un real[] (section 21.2).
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
        CREATE EXTENSION IF NOT EXISTS vector;
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'french_unaccent') THEN
        CREATE TEXT SEARCH CONFIGURATION public.french_unaccent (COPY = pg_catalog.french);
        ALTER TEXT SEARCH CONFIGURATION public.french_unaccent
          ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem;
      END IF;
    END $$;

    -- Reglages de session poses par avecOrg() : l'organisation courante, le role du membre, et le mode systeme (worker, seeds).
    CREATE OR REPLACE FUNCTION plateforme.org_courante() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
    CREATE OR REPLACE FUNCTION plateforme.peut_ecrire() RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT coalesce(current_setting('app.role', true), '') <> 'viewer' $$;
    CREATE OR REPLACE FUNCTION plateforme.est_systeme() RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT coalesce(current_setting('app.systeme', true), '') = '1' $$;

    -- ORGANISATION ET ACCES : organizations = workspaces, memberships = users.
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS slug text;
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS settings_json jsonb NOT NULL DEFAULT '{}'::jsonb;
    UPDATE workspaces SET slug = trim(both '-' from lower(regexp_replace(unaccent(name), '[^a-zA-Z0-9]+', '-', 'g'))) WHERE slug IS NULL;
    UPDATE workspaces w SET slug = coalesce(nullif(w.slug, ''), 'org') || '-' || substr(w.id::text, 1, 6)
      WHERE w.slug = '' OR EXISTS (SELECT 1 FROM workspaces x WHERE x.slug = w.slug AND x.created_at < w.created_at)
         OR EXISTS (SELECT 1 FROM workspaces x WHERE x.slug = w.slug AND x.created_at = w.created_at AND x.id < w.id);
    CREATE UNIQUE INDEX IF NOT EXISTS workspaces_slug_unique ON workspaces (slug) WHERE slug IS NOT NULL;

    ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'analyst';
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'admin', 'analyst', 'viewer'));
    -- Les membres existants gardent la main (ils geraient deja membres et reglages) ; le plus ancien de chaque espace devient owner.
    UPDATE users SET role = 'admin';
    UPDATE users u SET role = 'owner' WHERE u.workspace_id IS NOT NULL AND u.id = (
      SELECT x.id FROM users x WHERE x.workspace_id = u.workspace_id ORDER BY x.created_at, x.id LIMIT 1);

    -- CONFIGURATION (Bibliotheque)
    CREATE TABLE plateforme.criteria_sets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      name text NOT NULL, version int NOT NULL DEFAULT 1, is_active boolean NOT NULL DEFAULT false,
      rules jsonb NOT NULL DEFAULT '{"rules":[]}'::jsonb, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE (org_id, name, version)
    );
    CREATE TABLE plateforme.extraction_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      doc_type text NOT NULL, label text NOT NULL, version int NOT NULL DEFAULT 1, is_active boolean NOT NULL DEFAULT false,
      schema jsonb NOT NULL,
      UNIQUE NULLS NOT DISTINCT (org_id, doc_type, version)
    );
    CREATE TABLE plateforme.deliverable_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      kind text NOT NULL CHECK (kind IN ('excel', 'word')), key text NOT NULL, stage text,
      name text NOT NULL, storage_path text, mapping jsonb, sections jsonb,
      version int NOT NULL DEFAULT 1, is_active boolean NOT NULL DEFAULT false,
      UNIQUE (org_id, key, version)
    );
    CREATE TABLE plateforme.reconciliation_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      key text NOT NULL, rule jsonb NOT NULL, is_active boolean NOT NULL DEFAULT true, version int NOT NULL DEFAULT 1,
      UNIQUE NULLS NOT DISTINCT (org_id, key, version)
    );

    -- DEALS
    CREATE TABLE plateforme.deals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      name text NOT NULL,
      stage text NOT NULL DEFAULT 'reception' CHECK (stage IN ('reception', 'pre_analysis', 'data_room', 'analysis', 'committee', 'decision', 'closed')),
      conformity text NOT NULL DEFAULT 'pending' CHECK (conformity IN ('conforme', 'a_discuter', 'incomplet', 'non_conforme', 'pending')),
      source text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'email', 'data_room_link')),
      assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      archived_at timestamptz,
      links_to_fetch jsonb NOT NULL DEFAULT '[]'::jsonb
    );
    CREATE INDEX deals_org_stage ON plateforme.deals (org_id, stage) WHERE archived_at IS NULL;
    CREATE TABLE plateforme.deal_stage_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      deal_id uuid NOT NULL REFERENCES plateforme.deals(id) ON DELETE CASCADE,
      from_stage text, to_stage text NOT NULL, by_user uuid REFERENCES users(id) ON DELETE SET NULL, note text
    );
    CREATE INDEX deal_stage_events_deal ON plateforme.deal_stage_events (deal_id, created_at);
    CREATE TABLE plateforme.lots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      deal_id uuid NOT NULL REFERENCES plateforme.deals(id) ON DELETE CASCADE,
      lot_key text NOT NULL, label text,
      UNIQUE (deal_id, lot_key)
    );

    -- DOCUMENTS
    CREATE TABLE plateforme.documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      deal_id uuid NOT NULL REFERENCES plateforme.deals(id) ON DELETE CASCADE,
      parent_document_id uuid REFERENCES plateforme.documents(id) ON DELETE CASCADE,
      page_range int4range,
      storage_path text, filename text NOT NULL, mime text NOT NULL, sha256 text, size_bytes bigint, page_count int,
      doc_type text, doc_type_confidence real, doc_type_source text CHECK (doc_type_source IN ('llm', 'human')),
      status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsing', 'parsed', 'classified', 'indexed', 'extracting', 'extracted', 'failed', 'duplicate')),
      error text, document_date date,
      duplicate_of uuid REFERENCES plateforme.documents(id) ON DELETE SET NULL
    );
    CREATE UNIQUE INDEX documents_deal_sha_range ON plateforme.documents (deal_id, sha256, page_range) NULLS NOT DISTINCT WHERE duplicate_of IS NULL AND sha256 IS NOT NULL;
    CREATE INDEX documents_deal ON plateforme.documents (deal_id, created_at);
    CREATE INDEX documents_org_status ON plateforme.documents (org_id, status);
    CREATE TABLE plateforme.document_pages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      document_id uuid NOT NULL REFERENCES plateforme.documents(id) ON DELETE CASCADE,
      page_number int NOT NULL, width real, height real, text text NOT NULL DEFAULT '',
      blocks jsonb NOT NULL DEFAULT '[]'::jsonb, ocr boolean NOT NULL DEFAULT false,
      UNIQUE (document_id, page_number)
    );
    CREATE TABLE plateforme.chunks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      deal_id uuid NOT NULL REFERENCES plateforme.deals(id) ON DELETE CASCADE,
      document_id uuid NOT NULL REFERENCES plateforme.documents(id) ON DELETE CASCADE,
      ordinal int NOT NULL, page_start int NOT NULL, page_end int NOT NULL,
      text text NOT NULL, block_ids text[] NOT NULL DEFAULT '{}', token_count int,
      tsv tsvector GENERATED ALWAYS AS (to_tsvector('public.french_unaccent'::regconfig, text)) STORED,
      UNIQUE (document_id, ordinal)
    );
    CREATE INDEX chunks_tsv ON plateforme.chunks USING gin (tsv);
    CREATE INDEX chunks_trgm ON plateforme.chunks USING gin (text gin_trgm_ops);
    CREATE INDEX chunks_deal ON plateforme.chunks (deal_id);
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        EXECUTE 'ALTER TABLE plateforme.chunks ADD COLUMN embedding vector(${DIM})';
        EXECUTE 'CREATE INDEX chunks_embedding ON plateforme.chunks USING hnsw (embedding vector_cosine_ops)';
      ELSE
        EXECUTE 'ALTER TABLE plateforme.chunks ADD COLUMN embedding real[]';
      END IF;
    END $$;

    -- EXTRACTION ET FAITS
    CREATE TABLE plateforme.extraction_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      document_id uuid NOT NULL REFERENCES plateforme.documents(id) ON DELETE CASCADE,
      template_id uuid REFERENCES plateforme.extraction_templates(id) ON DELETE SET NULL, template_version int,
      model text, prompt_version text,
      status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
      llm_call_ids uuid[] NOT NULL DEFAULT '{}', error text,
      started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
    );
    CREATE INDEX extraction_runs_document ON plateforme.extraction_runs (document_id, started_at);
    CREATE TABLE plateforme.evidence (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      source_kind text NOT NULL CHECK (source_kind IN ('document', 'public_data', 'human')),
      document_id uuid REFERENCES plateforme.documents(id) ON DELETE CASCADE,
      page_number int, quote text, char_start int, char_end int, bbox jsonb, match_score real, external_ref jsonb
    );
    CREATE INDEX evidence_document ON plateforme.evidence (document_id, page_number);
    CREATE TABLE plateforme.facts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      deal_id uuid NOT NULL REFERENCES plateforme.deals(id) ON DELETE CASCADE,
      lot_key text NOT NULL DEFAULT 'main',
      document_id uuid REFERENCES plateforme.documents(id) ON DELETE CASCADE,
      field_key text NOT NULL, value_type text NOT NULL, value jsonb, unit text, raw_text text,
      status text NOT NULL CHECK (status IN ('verified', 'unverified', 'human', 'conflict', 'public_data')),
      confidence real, evidence_id uuid REFERENCES plateforme.evidence(id) ON DELETE SET NULL,
      source text NOT NULL CHECK (source IN ('extraction', 'human', 'public_data', 'resolution')),
      extraction_run_id uuid REFERENCES plateforme.extraction_runs(id) ON DELETE SET NULL,
      derived_from uuid[], version int NOT NULL DEFAULT 1, is_current boolean NOT NULL DEFAULT true,
      superseded_by uuid REFERENCES plateforme.facts(id) ON DELETE SET NULL,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX facts_deal_field_courant ON plateforme.facts (deal_id, field_key, lot_key) WHERE is_current;
    CREATE INDEX facts_document_field_courant ON plateforme.facts (document_id, field_key) WHERE is_current;
    CREATE TABLE plateforme.deal_metrics (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      deal_id uuid NOT NULL REFERENCES plateforme.deals(id) ON DELETE CASCADE,
      lot_key text NOT NULL DEFAULT 'main', metric_key text NOT NULL, value jsonb,
      input_fact_ids uuid[] NOT NULL DEFAULT '{}', formula_id text, missing text[] NOT NULL DEFAULT '{}',
      computed_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (deal_id, lot_key, metric_key)
    );
    CREATE TABLE plateforme.fact_suggestions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      deal_id uuid NOT NULL REFERENCES plateforme.deals(id) ON DELETE CASCADE,
      field_key text NOT NULL, lot_key text NOT NULL DEFAULT 'main', proposed_value jsonb,
      evidence_id uuid REFERENCES plateforme.evidence(id) ON DELETE SET NULL,
      proposed_by text NOT NULL CHECK (proposed_by IN ('agent', 'public_data', 'extraction')),
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
      decided_by uuid REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX fact_suggestions_deal ON plateforme.fact_suggestions (deal_id, status);

    -- CONTROLES
    CREATE TABLE plateforme.anomalies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      deal_id uuid NOT NULL REFERENCES plateforme.deals(id) ON DELETE CASCADE,
      lot_key text NOT NULL DEFAULT 'main', rule_key text NOT NULL, rule_version int NOT NULL DEFAULT 1,
      severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
      title text NOT NULL, message text NOT NULL, fact_ids uuid[] NOT NULL DEFAULT '{}', computed jsonb,
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'explained', 'dismissed', 'resolved')),
      resolution_note text, resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE (deal_id, lot_key, rule_key)
    );
    CREATE TABLE plateforme.criteria_evaluations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      deal_id uuid NOT NULL REFERENCES plateforme.deals(id) ON DELETE CASCADE,
      criteria_set_id uuid REFERENCES plateforme.criteria_sets(id) ON DELETE SET NULL, criteria_version int,
      results jsonb NOT NULL DEFAULT '[]'::jsonb,
      conformity text NOT NULL CHECK (conformity IN ('conforme', 'a_discuter', 'incomplet', 'non_conforme')),
      computed_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX criteria_evaluations_deal ON plateforme.criteria_evaluations (deal_id, computed_at DESC);

    -- LIVRABLES, DECISIONS, MEMOIRE
    CREATE TABLE plateforme.deliverables (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      deal_id uuid NOT NULL REFERENCES plateforme.deals(id) ON DELETE CASCADE,
      stage text NOT NULL, key text NOT NULL,
      template_id uuid REFERENCES plateforme.deliverable_templates(id) ON DELETE SET NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'running', 'ready', 'validated', 'failed')),
      version int NOT NULL DEFAULT 1, storage_path text, content jsonb, fact_snapshot jsonb,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      validated_by uuid REFERENCES users(id) ON DELETE SET NULL, validated_at timestamptz, error text,
      UNIQUE (deal_id, key, version)
    );
    CREATE TABLE plateforme.decisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      deal_id uuid NOT NULL REFERENCES plateforme.deals(id) ON DELETE CASCADE,
      outcome text NOT NULL CHECK (outcome IN ('pursue', 'offer', 'on_hold', 'pass')),
      reason_code text NOT NULL, reason_text text NOT NULL CHECK (length(reason_text) >= 10),
      conditions text, decided_by uuid REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX decisions_deal ON plateforme.decisions (deal_id, created_at DESC);
    CREATE TABLE plateforme.memory_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      deal_id uuid REFERENCES plateforme.deals(id) ON DELETE SET NULL,
      decision_id uuid REFERENCES plateforme.decisions(id) ON DELETE SET NULL,
      kind text NOT NULL CHECK (kind IN ('decision', 'note')),
      summary text NOT NULL, features jsonb NOT NULL DEFAULT '{}'::jsonb, tags text[] NOT NULL DEFAULT '{}',
      is_active boolean NOT NULL DEFAULT true
    );
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        EXECUTE 'ALTER TABLE plateforme.memory_entries ADD COLUMN embedding vector(${DIM})';
      ELSE
        EXECUTE 'ALTER TABLE plateforme.memory_entries ADD COLUMN embedding real[]';
      END IF;
    END $$;

    -- CHAT
    CREATE TABLE plateforme.chat_threads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      deal_id uuid NOT NULL REFERENCES plateforme.deals(id) ON DELETE CASCADE,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL, title text
    );
    CREATE TABLE plateforme.chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      thread_id uuid NOT NULL REFERENCES plateforme.chat_threads(id) ON DELETE CASCADE,
      role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
      content jsonb NOT NULL, citations jsonb
    );
    CREATE INDEX chat_messages_thread ON plateforme.chat_messages (thread_id, created_at);

    -- ENTREES, DONNEES EXTERNES, TRACABILITE
    CREATE TABLE plateforme.inbound_emails (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      deal_id uuid REFERENCES plateforme.deals(id) ON DELETE SET NULL,
      message_id text NOT NULL UNIQUE, from_address text, subject text, raw_path text,
      status text NOT NULL CHECK (status IN ('accepted', 'quarantined', 'failed'))
    );
    CREATE TABLE plateforme.public_data_cache (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      source text NOT NULL, cache_key text NOT NULL, payload jsonb,
      fetched_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
      UNIQUE (source, cache_key)
    );
    CREATE TABLE plateforme.index_values (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      index_code text NOT NULL, year int NOT NULL, quarter int NOT NULL CHECK (quarter BETWEEN 1 AND 4),
      value numeric NOT NULL, published_at date,
      UNIQUE (index_code, year, quarter)
    );
    CREATE TABLE plateforme.llm_calls (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      purpose text NOT NULL, model text NOT NULL, prompt_version text,
      input_tokens int, output_tokens int, cost_eur numeric, latency_ms int,
      status text NOT NULL DEFAULT 'ok', request_hash text,
      deal_id uuid REFERENCES plateforme.deals(id) ON DELETE SET NULL
    );
    CREATE INDEX llm_calls_org_date ON plateforme.llm_calls (org_id, created_at);
    CREATE TABLE plateforme.audit_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      action text NOT NULL, entity_type text NOT NULL, entity_id uuid, payload jsonb
    );
    CREATE INDEX audit_events_org_entity ON plateforme.audit_events (org_id, entity_type, entity_id);
    CREATE TABLE plateforme.eval_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      suite text NOT NULL, git_sha text, metrics jsonb NOT NULL DEFAULT '{}'::jsonb, report_path text
    );
  `);

  // RLS : lecture dans l'organisation courante ; ecriture dans l'organisation courante par un membre qui n'est pas viewer.
  for (const t of TABLES_ORG) {
    const ecriture = t === 'audit_events' ? 'org_id = plateforme.org_courante()' : 'org_id = plateforme.org_courante() AND plateforme.peut_ecrire()';
    pgm.sql(`
      ALTER TABLE plateforme.${t} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE plateforme.${t} FORCE ROW LEVEL SECURITY;
      CREATE POLICY ${t}_lecture ON plateforme.${t} FOR SELECT USING (org_id = plateforme.org_courante());
      CREATE POLICY ${t}_insertion ON plateforme.${t} FOR INSERT WITH CHECK (${ecriture});
      CREATE POLICY ${t}_modification ON plateforme.${t} FOR UPDATE USING (${ecriture}) WITH CHECK (${ecriture});
      CREATE POLICY ${t}_suppression ON plateforme.${t} FOR DELETE USING (${ecriture});
    `);
  }
  for (const t of TABLES_ORG_OU_SYSTEME) {
    const ecriture = '(org_id = plateforme.org_courante() AND plateforme.peut_ecrire()) OR (org_id IS NULL AND plateforme.est_systeme())';
    pgm.sql(`
      ALTER TABLE plateforme.${t} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE plateforme.${t} FORCE ROW LEVEL SECURITY;
      CREATE POLICY ${t}_lecture ON plateforme.${t} FOR SELECT USING (org_id IS NULL OR org_id = plateforme.org_courante());
      CREATE POLICY ${t}_insertion ON plateforme.${t} FOR INSERT WITH CHECK (${ecriture});
      CREATE POLICY ${t}_modification ON plateforme.${t} FOR UPDATE USING (${ecriture}) WITH CHECK (${ecriture});
      CREATE POLICY ${t}_suppression ON plateforme.${t} FOR DELETE USING (${ecriture});
    `);
  }
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP SCHEMA IF EXISTS plateforme CASCADE;
    DROP INDEX IF EXISTS workspaces_slug_unique;
    ALTER TABLE workspaces DROP COLUMN IF EXISTS slug;
    ALTER TABLE workspaces DROP COLUMN IF EXISTS settings_json;
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users DROP COLUMN IF EXISTS role;
  `);
};
