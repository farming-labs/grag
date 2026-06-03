import type { Kysely } from "kysely";
import { sql } from "kysely";

export type GraphRagSqlDialect = "postgres" | "sqlite";

const commonStatements = [
  `CREATE TABLE IF NOT EXISTS grag_documents (
    id TEXT PRIMARY KEY,
    human_readable_id TEXT,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    text TEXT NOT NULL,
    attributes_json TEXT,
    raw_data_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS grag_text_units (
    id TEXT PRIMARY KEY,
    human_readable_id TEXT,
    text TEXT NOT NULL,
    n_tokens INTEGER,
    document_id TEXT,
    attributes_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS grag_entities (
    id TEXT PRIMARY KEY,
    human_readable_id TEXT,
    title TEXT NOT NULL,
    type TEXT,
    description TEXT,
    description_embedding_json TEXT,
    name_embedding_json TEXT,
    frequency INTEGER,
    degree INTEGER,
    rank DOUBLE PRECISION,
    attributes_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS grag_relationships (
    id TEXT PRIMARY KEY,
    human_readable_id TEXT,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    description TEXT,
    description_embedding_json TEXT,
    weight DOUBLE PRECISION NOT NULL DEFAULT 1,
    combined_degree INTEGER,
    rank DOUBLE PRECISION,
    attributes_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS grag_covariates (
    id TEXT PRIMARY KEY,
    human_readable_id TEXT,
    covariate_type TEXT NOT NULL DEFAULT 'claim',
    type TEXT,
    description TEXT,
    subject_id TEXT NOT NULL,
    subject_type TEXT NOT NULL DEFAULT 'entity',
    object_id TEXT,
    status TEXT,
    start_date TEXT,
    end_date TEXT,
    source_text TEXT,
    attributes_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS grag_communities (
    id TEXT PRIMARY KEY,
    human_readable_id TEXT,
    community INTEGER NOT NULL,
    level INTEGER NOT NULL,
    parent INTEGER,
    children_json TEXT NOT NULL DEFAULT '[]',
    title TEXT NOT NULL,
    attributes_json TEXT,
    period TEXT,
    size INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS grag_community_reports (
    id TEXT PRIMARY KEY,
    human_readable_id TEXT,
    community INTEGER NOT NULL,
    level INTEGER NOT NULL,
    parent INTEGER,
    children_json TEXT NOT NULL DEFAULT '[]',
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    full_content TEXT NOT NULL DEFAULT '',
    rank DOUBLE PRECISION NOT NULL DEFAULT 1,
    rating_explanation TEXT,
    findings_json TEXT NOT NULL DEFAULT '[]',
    full_content_json TEXT,
    full_content_embedding_json TEXT,
    attributes_json TEXT,
    period TEXT,
    size INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS grag_embeddings (
    id TEXT PRIMARY KEY,
    human_readable_id TEXT,
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    vector_json TEXT NOT NULL,
    model TEXT,
    dimensions INTEGER,
    text TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS grag_document_text_units (
    document_id TEXT NOT NULL,
    text_unit_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (document_id, text_unit_id)
  )`,
  `CREATE TABLE IF NOT EXISTS grag_text_unit_entities (
    text_unit_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (text_unit_id, entity_id)
  )`,
  `CREATE TABLE IF NOT EXISTS grag_text_unit_relationships (
    text_unit_id TEXT NOT NULL,
    relationship_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (text_unit_id, relationship_id)
  )`,
  `CREATE TABLE IF NOT EXISTS grag_text_unit_covariates (
    text_unit_id TEXT NOT NULL,
    covariate_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (text_unit_id, covariate_id)
  )`,
  `CREATE TABLE IF NOT EXISTS grag_entity_communities (
    entity_id TEXT NOT NULL,
    community_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (entity_id, community_id)
  )`,
  `CREATE TABLE IF NOT EXISTS grag_entity_text_units (
    entity_id TEXT NOT NULL,
    text_unit_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (entity_id, text_unit_id)
  )`,
  `CREATE TABLE IF NOT EXISTS grag_relationship_text_units (
    relationship_id TEXT NOT NULL,
    text_unit_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (relationship_id, text_unit_id)
  )`,
  `CREATE TABLE IF NOT EXISTS grag_covariate_text_units (
    covariate_id TEXT NOT NULL,
    text_unit_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (covariate_id, text_unit_id)
  )`,
  `CREATE TABLE IF NOT EXISTS grag_community_entities (
    community_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (community_id, entity_id)
  )`,
  `CREATE TABLE IF NOT EXISTS grag_community_relationships (
    community_id TEXT NOT NULL,
    relationship_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (community_id, relationship_id)
  )`,
  `CREATE TABLE IF NOT EXISTS grag_community_text_units (
    community_id TEXT NOT NULL,
    text_unit_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (community_id, text_unit_id)
  )`,
  `CREATE TABLE IF NOT EXISTS grag_community_covariates (
    community_id TEXT NOT NULL,
    covariate_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (community_id, covariate_id)
  )`,
  `CREATE INDEX IF NOT EXISTS grag_text_units_document_id_idx ON grag_text_units (document_id)`,
  `CREATE INDEX IF NOT EXISTS grag_entities_title_idx ON grag_entities (title)`,
  `CREATE INDEX IF NOT EXISTS grag_relationships_source_target_idx ON grag_relationships (source, target)`,
  `CREATE INDEX IF NOT EXISTS grag_covariates_subject_idx ON grag_covariates (subject_type, subject_id)`,
  `CREATE INDEX IF NOT EXISTS grag_communities_level_idx ON grag_communities (level)`,
  `CREATE INDEX IF NOT EXISTS grag_community_reports_level_idx ON grag_community_reports (level)`,
  `CREATE INDEX IF NOT EXISTS grag_embeddings_target_idx ON grag_embeddings (target_kind, target_id)`
] as const;

export function getGraphRagMigrationStatements(_dialect: GraphRagSqlDialect): readonly string[] {
  return commonStatements;
}

export async function applyGraphRagMigrations<DB extends object>(
  db: Kysely<DB>,
  dialect: GraphRagSqlDialect
): Promise<void> {
  for (const statement of getGraphRagMigrationStatements(dialect)) {
    await sql.raw(statement).execute(db);
  }
}
