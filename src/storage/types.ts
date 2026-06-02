import type {
  Community,
  CommunityReport,
  Covariate,
  EmbeddingRecord,
  EmbeddingTargetKind,
  Entity,
  GraphRagDocument,
  GraphRagSnapshot,
  PartialGraphRagSnapshot,
  Relationship,
  TextUnit
} from "../model.js";

export interface ListOptions {
  limit?: number;
  offset?: number;
}

export interface CommunityReportListOptions extends ListOptions {
  level?: number;
  communityIds?: readonly number[];
}

export interface EmbeddingListOptions extends ListOptions {
  targetKind?: EmbeddingTargetKind;
  targetIds?: readonly string[];
  model?: string;
}

export interface GraphRagStore {
  upsertGraph(snapshot: PartialGraphRagSnapshot): Promise<void>;
  getSnapshot(): Promise<GraphRagSnapshot>;

  upsertDocuments(documents: readonly GraphRagDocument[]): Promise<void>;
  listDocuments(options?: ListOptions): Promise<GraphRagDocument[]>;
  getDocument(id: string): Promise<GraphRagDocument | undefined>;

  upsertTextUnits(textUnits: readonly TextUnit[]): Promise<void>;
  listTextUnits(options?: ListOptions): Promise<TextUnit[]>;
  getTextUnit(id: string): Promise<TextUnit | undefined>;

  upsertEntities(entities: readonly Entity[]): Promise<void>;
  listEntities(options?: ListOptions): Promise<Entity[]>;
  getEntity(id: string): Promise<Entity | undefined>;

  upsertRelationships(relationships: readonly Relationship[]): Promise<void>;
  listRelationships(options?: ListOptions): Promise<Relationship[]>;
  getRelationship(id: string): Promise<Relationship | undefined>;

  upsertCovariates(covariates: readonly Covariate[]): Promise<void>;
  listCovariates(options?: ListOptions): Promise<Covariate[]>;
  getCovariate(id: string): Promise<Covariate | undefined>;

  upsertCommunities(communities: readonly Community[]): Promise<void>;
  listCommunities(options?: ListOptions): Promise<Community[]>;
  getCommunity(id: string): Promise<Community | undefined>;

  upsertCommunityReports(reports: readonly CommunityReport[]): Promise<void>;
  listCommunityReports(options?: CommunityReportListOptions): Promise<CommunityReport[]>;
  getCommunityReport(id: string): Promise<CommunityReport | undefined>;

  upsertEmbeddings(records: readonly EmbeddingRecord[]): Promise<void>;
  listEmbeddings(options?: EmbeddingListOptions): Promise<EmbeddingRecord[]>;
  getEmbedding(id: string): Promise<EmbeddingRecord | undefined>;
}
