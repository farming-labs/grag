import {
  communityReportSchema,
  communitySchema,
  covariateSchema,
  documentSchema,
  embeddingRecordSchema,
  entitySchema,
  graphRagSnapshotSchema,
  relationshipSchema,
  textUnitSchema,
  type Community,
  type CommunityReport,
  type Covariate,
  type EmbeddingRecord,
  type Entity,
  type GraphRagDocument,
  type GraphRagSnapshot,
  type PartialGraphRagSnapshot,
  type Relationship,
  type TextUnit
} from "../model.js";
import type {
  CommunityReportListOptions,
  EmbeddingListOptions,
  GraphRagStore,
  ListOptions
} from "./types.js";

type ModelWithId = { id: string };

function slice<T>(items: readonly T[], options?: ListOptions): T[] {
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? items.length;
  return items.slice(offset, offset + limit);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function upsertInto<T extends ModelWithId>(map: Map<string, T>, items: readonly T[]): void {
  for (const item of items) {
    map.set(item.id, clone(item));
  }
}

function listFrom<T>(map: Map<string, T>, options?: ListOptions): T[] {
  return slice([...map.values()], options).map((item) => clone(item));
}

export class MemoryGraphRagStore implements GraphRagStore {
  private readonly documents = new Map<string, GraphRagDocument>();
  private readonly textUnits = new Map<string, TextUnit>();
  private readonly entities = new Map<string, Entity>();
  private readonly relationships = new Map<string, Relationship>();
  private readonly covariates = new Map<string, Covariate>();
  private readonly communities = new Map<string, Community>();
  private readonly communityReports = new Map<string, CommunityReport>();
  private readonly embeddings = new Map<string, EmbeddingRecord>();

  async upsertGraph(snapshot: PartialGraphRagSnapshot): Promise<void> {
    if (snapshot.documents) await this.upsertDocuments(snapshot.documents);
    if (snapshot.textUnits) await this.upsertTextUnits(snapshot.textUnits);
    if (snapshot.entities) await this.upsertEntities(snapshot.entities);
    if (snapshot.relationships) await this.upsertRelationships(snapshot.relationships);
    if (snapshot.covariates) await this.upsertCovariates(snapshot.covariates);
    if (snapshot.communities) await this.upsertCommunities(snapshot.communities);
    if (snapshot.communityReports) await this.upsertCommunityReports(snapshot.communityReports);
    if (snapshot.embeddings) await this.upsertEmbeddings(snapshot.embeddings);
  }

  async getSnapshot(): Promise<GraphRagSnapshot> {
    return graphRagSnapshotSchema.parse({
      documents: await this.listDocuments(),
      textUnits: await this.listTextUnits(),
      entities: await this.listEntities(),
      relationships: await this.listRelationships(),
      covariates: await this.listCovariates(),
      communities: await this.listCommunities(),
      communityReports: await this.listCommunityReports(),
      embeddings: await this.listEmbeddings()
    });
  }

  async upsertDocuments(documents: readonly GraphRagDocument[]): Promise<void> {
    upsertInto(this.documents, documents.map((document) => documentSchema.parse(document)));
  }

  async listDocuments(options?: ListOptions): Promise<GraphRagDocument[]> {
    return listFrom(this.documents, options);
  }

  async getDocument(id: string): Promise<GraphRagDocument | undefined> {
    const document = this.documents.get(id);
    return document ? clone(document) : undefined;
  }

  async upsertTextUnits(textUnits: readonly TextUnit[]): Promise<void> {
    upsertInto(this.textUnits, textUnits.map((textUnit) => textUnitSchema.parse(textUnit)));
  }

  async listTextUnits(options?: ListOptions): Promise<TextUnit[]> {
    return listFrom(this.textUnits, options);
  }

  async getTextUnit(id: string): Promise<TextUnit | undefined> {
    const textUnit = this.textUnits.get(id);
    return textUnit ? clone(textUnit) : undefined;
  }

  async upsertEntities(entities: readonly Entity[]): Promise<void> {
    upsertInto(this.entities, entities.map((entity) => entitySchema.parse(entity)));
  }

  async listEntities(options?: ListOptions): Promise<Entity[]> {
    return listFrom(this.entities, options);
  }

  async getEntity(id: string): Promise<Entity | undefined> {
    const entity = this.entities.get(id);
    return entity ? clone(entity) : undefined;
  }

  async upsertRelationships(relationships: readonly Relationship[]): Promise<void> {
    upsertInto(
      this.relationships,
      relationships.map((relationship) => relationshipSchema.parse(relationship))
    );
  }

  async listRelationships(options?: ListOptions): Promise<Relationship[]> {
    return listFrom(this.relationships, options);
  }

  async getRelationship(id: string): Promise<Relationship | undefined> {
    const relationship = this.relationships.get(id);
    return relationship ? clone(relationship) : undefined;
  }

  async upsertCovariates(covariates: readonly Covariate[]): Promise<void> {
    upsertInto(this.covariates, covariates.map((covariate) => covariateSchema.parse(covariate)));
  }

  async listCovariates(options?: ListOptions): Promise<Covariate[]> {
    return listFrom(this.covariates, options);
  }

  async getCovariate(id: string): Promise<Covariate | undefined> {
    const covariate = this.covariates.get(id);
    return covariate ? clone(covariate) : undefined;
  }

  async upsertCommunities(communities: readonly Community[]): Promise<void> {
    upsertInto(
      this.communities,
      communities.map((community) => communitySchema.parse(community))
    );
  }

  async listCommunities(options?: ListOptions): Promise<Community[]> {
    return listFrom(this.communities, options);
  }

  async getCommunity(id: string): Promise<Community | undefined> {
    const community = this.communities.get(id);
    return community ? clone(community) : undefined;
  }

  async upsertCommunityReports(reports: readonly CommunityReport[]): Promise<void> {
    upsertInto(
      this.communityReports,
      reports.map((report) => communityReportSchema.parse(report))
    );
  }

  async listCommunityReports(options?: CommunityReportListOptions): Promise<CommunityReport[]> {
    const reports = [...this.communityReports.values()]
      .filter((report) => options?.level === undefined || report.level === options.level)
      .filter(
        (report) => !options?.communityIds?.length || options.communityIds.includes(report.community)
      )
      .sort((left, right) => (right.rank ?? 0) - (left.rank ?? 0));

    return slice(reports, options).map((report) => clone(report));
  }

  async getCommunityReport(id: string): Promise<CommunityReport | undefined> {
    const report = this.communityReports.get(id);
    return report ? clone(report) : undefined;
  }

  async upsertEmbeddings(records: readonly EmbeddingRecord[]): Promise<void> {
    upsertInto(this.embeddings, records.map((record) => embeddingRecordSchema.parse(record)));
  }

  async listEmbeddings(options?: EmbeddingListOptions): Promise<EmbeddingRecord[]> {
    const records = [...this.embeddings.values()]
      .filter((record) => options?.targetKind === undefined || record.targetKind === options.targetKind)
      .filter((record) => !options?.targetIds?.length || options.targetIds.includes(record.targetId))
      .filter((record) => options?.model === undefined || record.model === options.model);

    return slice(records, options).map((record) => clone(record));
  }

  async getEmbedding(id: string): Promise<EmbeddingRecord | undefined> {
    const embedding = this.embeddings.get(id);
    return embedding ? clone(embedding) : undefined;
  }
}
