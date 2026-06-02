import type { ColumnType, Insertable, Selectable, Updateable } from "kysely";

export type TimestampTextColumn = ColumnType<string, string | undefined, string | undefined>;

export interface GraphRagDocumentTable {
  id: string;
  human_readable_id: string | null;
  title: string;
  type: string;
  text: string;
  attributes_json: string | null;
  raw_data_json: string | null;
  created_at: TimestampTextColumn;
}

export interface GraphRagTextUnitTable {
  id: string;
  human_readable_id: string | null;
  text: string;
  n_tokens: number | null;
  document_id: string | null;
  attributes_json: string | null;
  created_at: TimestampTextColumn;
}

export interface GraphRagEntityTable {
  id: string;
  human_readable_id: string | null;
  title: string;
  type: string | null;
  description: string | null;
  description_embedding_json: string | null;
  name_embedding_json: string | null;
  frequency: number | null;
  degree: number | null;
  rank: number | null;
  attributes_json: string | null;
  created_at: TimestampTextColumn;
}

export interface GraphRagRelationshipTable {
  id: string;
  human_readable_id: string | null;
  source: string;
  target: string;
  description: string | null;
  description_embedding_json: string | null;
  weight: number;
  combined_degree: number | null;
  rank: number | null;
  attributes_json: string | null;
  created_at: TimestampTextColumn;
}

export interface GraphRagCovariateTable {
  id: string;
  human_readable_id: string | null;
  covariate_type: string;
  type: string | null;
  description: string | null;
  subject_id: string;
  subject_type: string;
  object_id: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  source_text: string | null;
  attributes_json: string | null;
  created_at: TimestampTextColumn;
}

export interface GraphRagCommunityTable {
  id: string;
  human_readable_id: string | null;
  community: number;
  level: number;
  parent: number | null;
  children_json: string;
  title: string;
  attributes_json: string | null;
  period: string | null;
  size: number | null;
  created_at: TimestampTextColumn;
}

export interface GraphRagCommunityReportTable {
  id: string;
  human_readable_id: string | null;
  community: number;
  level: number;
  parent: number | null;
  children_json: string;
  title: string;
  summary: string;
  full_content: string;
  rank: number;
  rating_explanation: string | null;
  findings_json: string;
  full_content_json: string | null;
  full_content_embedding_json: string | null;
  attributes_json: string | null;
  period: string | null;
  size: number | null;
  created_at: TimestampTextColumn;
}

export interface GraphRagEmbeddingTable {
  id: string;
  human_readable_id: string | null;
  target_kind: string;
  target_id: string;
  vector_json: string;
  model: string | null;
  dimensions: number | null;
  text: string | null;
  metadata_json: string | null;
  created_at: TimestampTextColumn;
}

export interface GraphRagDocumentTextUnitTable {
  document_id: string;
  text_unit_id: string;
  position: number;
}

export interface GraphRagTextUnitEntityTable {
  text_unit_id: string;
  entity_id: string;
  position: number;
}

export interface GraphRagTextUnitRelationshipTable {
  text_unit_id: string;
  relationship_id: string;
  position: number;
}

export interface GraphRagTextUnitCovariateTable {
  text_unit_id: string;
  covariate_id: string;
  position: number;
}

export interface GraphRagEntityCommunityTable {
  entity_id: string;
  community_id: string;
  position: number;
}

export interface GraphRagEntityTextUnitTable {
  entity_id: string;
  text_unit_id: string;
  position: number;
}

export interface GraphRagRelationshipTextUnitTable {
  relationship_id: string;
  text_unit_id: string;
  position: number;
}

export interface GraphRagCovariateTextUnitTable {
  covariate_id: string;
  text_unit_id: string;
  position: number;
}

export interface GraphRagCommunityEntityTable {
  community_id: string;
  entity_id: string;
  position: number;
}

export interface GraphRagCommunityRelationshipTable {
  community_id: string;
  relationship_id: string;
  position: number;
}

export interface GraphRagCommunityTextUnitTable {
  community_id: string;
  text_unit_id: string;
  position: number;
}

export interface GraphRagCommunityCovariateTable {
  community_id: string;
  covariate_id: string;
  position: number;
}

export interface GraphRagSqlDatabase {
  grag_documents: GraphRagDocumentTable;
  grag_text_units: GraphRagTextUnitTable;
  grag_entities: GraphRagEntityTable;
  grag_relationships: GraphRagRelationshipTable;
  grag_covariates: GraphRagCovariateTable;
  grag_communities: GraphRagCommunityTable;
  grag_community_reports: GraphRagCommunityReportTable;
  grag_embeddings: GraphRagEmbeddingTable;
  grag_document_text_units: GraphRagDocumentTextUnitTable;
  grag_text_unit_entities: GraphRagTextUnitEntityTable;
  grag_text_unit_relationships: GraphRagTextUnitRelationshipTable;
  grag_text_unit_covariates: GraphRagTextUnitCovariateTable;
  grag_entity_communities: GraphRagEntityCommunityTable;
  grag_entity_text_units: GraphRagEntityTextUnitTable;
  grag_relationship_text_units: GraphRagRelationshipTextUnitTable;
  grag_covariate_text_units: GraphRagCovariateTextUnitTable;
  grag_community_entities: GraphRagCommunityEntityTable;
  grag_community_relationships: GraphRagCommunityRelationshipTable;
  grag_community_text_units: GraphRagCommunityTextUnitTable;
  grag_community_covariates: GraphRagCommunityCovariateTable;
}

export type GraphRagTable<RowName extends keyof GraphRagSqlDatabase> =
  GraphRagSqlDatabase[RowName];
export type GraphRagSelectable<RowName extends keyof GraphRagSqlDatabase> = Selectable<
  GraphRagTable<RowName>
>;
export type GraphRagInsertable<RowName extends keyof GraphRagSqlDatabase> = Insertable<
  GraphRagTable<RowName>
>;
export type GraphRagUpdateable<RowName extends keyof GraphRagSqlDatabase> = Updateable<
  GraphRagTable<RowName>
>;
