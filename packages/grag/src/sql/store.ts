import type { Kysely, Transaction } from "kysely";
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
  type CommunityReportFinding,
  type Covariate,
  type EmbeddingRecord,
  type Entity,
  type GraphRagDocument,
  type GraphRagSnapshot,
  type JsonObject,
  type PartialGraphRagSnapshot,
  type Relationship,
  type TextUnit
} from "../model.js";
import { decodeJson, decodeJsonObject, encodeJson } from "../utils/json.js";
import type {
  CommunityReportListOptions,
  EmbeddingListOptions,
  GraphRagStore,
  ListOptions
} from "../storage/types.js";
import type {
  GraphRagInsertable,
  GraphRagSqlDatabase,
  GraphRagSelectable
} from "./schema.js";

type Executor = Kysely<GraphRagSqlDatabase> | Transaction<GraphRagSqlDatabase>;

function humanReadableId(value: string | number | null | undefined): string | null {
  return value === undefined || value === null ? null : String(value);
}

function createdAt(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function maybeLimitOffset<T extends { limit(limit: number): T; offset(offset: number): T }>(
  query: T,
  options?: ListOptions
): T {
  let next = query;
  if (options?.offset !== undefined) {
    next = next.offset(options.offset);
  }
  if (options?.limit !== undefined) {
    next = next.limit(options.limit);
  }
  return next;
}

function links(ownerId: string, ownerColumn: string, valueColumn: string, values: readonly string[]) {
  return values.map((value, position) => ({
    [ownerColumn]: ownerId,
    [valueColumn]: value,
    position
  }));
}

function toMap(rows: readonly Record<string, unknown>[], ownerColumn: string, valueColumn: string) {
  const map = new Map<string, string[]>();

  for (const row of rows) {
    const owner = String(row[ownerColumn]);
    const value = String(row[valueColumn]);
    const values = map.get(owner);
    if (values) {
      values.push(value);
    } else {
      map.set(owner, [value]);
    }
  }

  return map;
}

export interface SqlGraphRagStoreOptions {
  db: Kysely<GraphRagSqlDatabase>;
}

export class SqlGraphRagStore implements GraphRagStore {
  readonly db: Kysely<GraphRagSqlDatabase>;

  constructor(options: SqlGraphRagStoreOptions) {
    this.db = options.db;
  }

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
    const records = documents.map((document) => documentSchema.parse(document));
    if (records.length === 0) return;

    await this.db.transaction().execute(async (trx) => {
      const ids = records.map((document) => document.id);
      await trx.deleteFrom("grag_document_text_units").where("document_id", "in", ids).execute();
      await trx.deleteFrom("grag_documents").where("id", "in", ids).execute();
      await trx.insertInto("grag_documents").values(records.map(toDocumentRow)).execute();

      const rows = records.flatMap((document) =>
        links(document.id, "document_id", "text_unit_id", document.textUnitIds)
      );
      await insertDynamic(trx, "grag_document_text_units", rows);
    });
  }

  async listDocuments(options?: ListOptions): Promise<GraphRagDocument[]> {
    const rows = await maybeLimitOffset(
      this.db.selectFrom("grag_documents").selectAll().orderBy("id"),
      options
    ).execute();
    const textUnitIds = await this.loadLinks("grag_document_text_units", "document_id", "text_unit_id");

    return rows.map((row) => fromDocumentRow(row, textUnitIds.get(row.id) ?? []));
  }

  async getDocument(id: string): Promise<GraphRagDocument | undefined> {
    const document = await this.db
      .selectFrom("grag_documents")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!document) return undefined;

    const rows = await this.db
      .selectFrom("grag_document_text_units")
      .select(["document_id", "text_unit_id"])
      .where("document_id", "=", id)
      .orderBy("position")
      .execute();

    return fromDocumentRow(document, rows.map((row) => row.text_unit_id));
  }

  async upsertTextUnits(textUnits: readonly TextUnit[]): Promise<void> {
    const records = textUnits.map((textUnit) => textUnitSchema.parse(textUnit));
    if (records.length === 0) return;

    await this.db.transaction().execute(async (trx) => {
      const ids = records.map((textUnit) => textUnit.id);
      await trx.deleteFrom("grag_text_unit_entities").where("text_unit_id", "in", ids).execute();
      await trx.deleteFrom("grag_text_unit_relationships").where("text_unit_id", "in", ids).execute();
      await trx.deleteFrom("grag_text_unit_covariates").where("text_unit_id", "in", ids).execute();
      await trx.deleteFrom("grag_text_units").where("id", "in", ids).execute();
      await trx.insertInto("grag_text_units").values(records.map(toTextUnitRow)).execute();

      await insertDynamic(
        trx,
        "grag_text_unit_entities",
        records.flatMap((textUnit) => links(textUnit.id, "text_unit_id", "entity_id", textUnit.entityIds))
      );
      await insertDynamic(
        trx,
        "grag_text_unit_relationships",
        records.flatMap((textUnit) =>
          links(textUnit.id, "text_unit_id", "relationship_id", textUnit.relationshipIds)
        )
      );
      await insertDynamic(
        trx,
        "grag_text_unit_covariates",
        records.flatMap((textUnit) =>
          links(textUnit.id, "text_unit_id", "covariate_id", textUnit.covariateIds)
        )
      );
    });
  }

  async listTextUnits(options?: ListOptions): Promise<TextUnit[]> {
    const rows = await maybeLimitOffset(
      this.db.selectFrom("grag_text_units").selectAll().orderBy("id"),
      options
    ).execute();
    const entityIds = await this.loadLinks("grag_text_unit_entities", "text_unit_id", "entity_id");
    const relationshipIds = await this.loadLinks(
      "grag_text_unit_relationships",
      "text_unit_id",
      "relationship_id"
    );
    const covariateIds = await this.loadLinks("grag_text_unit_covariates", "text_unit_id", "covariate_id");

    return rows.map((row) =>
      fromTextUnitRow(row, {
        entityIds: entityIds.get(row.id) ?? [],
        relationshipIds: relationshipIds.get(row.id) ?? [],
        covariateIds: covariateIds.get(row.id) ?? []
      })
    );
  }

  async getTextUnit(id: string): Promise<TextUnit | undefined> {
    return (await this.listTextUnits()).find((textUnit) => textUnit.id === id);
  }

  async upsertEntities(entities: readonly Entity[]): Promise<void> {
    const records = entities.map((entity) => entitySchema.parse(entity));
    if (records.length === 0) return;

    await this.db.transaction().execute(async (trx) => {
      const ids = records.map((entity) => entity.id);
      await trx.deleteFrom("grag_entity_communities").where("entity_id", "in", ids).execute();
      await trx.deleteFrom("grag_entity_text_units").where("entity_id", "in", ids).execute();
      await trx.deleteFrom("grag_entities").where("id", "in", ids).execute();
      await trx.insertInto("grag_entities").values(records.map(toEntityRow)).execute();

      await insertDynamic(
        trx,
        "grag_entity_communities",
        records.flatMap((entity) => links(entity.id, "entity_id", "community_id", entity.communityIds))
      );
      await insertDynamic(
        trx,
        "grag_entity_text_units",
        records.flatMap((entity) => links(entity.id, "entity_id", "text_unit_id", entity.textUnitIds))
      );
    });
  }

  async listEntities(options?: ListOptions): Promise<Entity[]> {
    const rows = await maybeLimitOffset(
      this.db.selectFrom("grag_entities").selectAll().orderBy("title"),
      options
    ).execute();
    const communityIds = await this.loadLinks("grag_entity_communities", "entity_id", "community_id");
    const textUnitIds = await this.loadLinks("grag_entity_text_units", "entity_id", "text_unit_id");

    return rows.map((row) =>
      fromEntityRow(row, {
        communityIds: communityIds.get(row.id) ?? [],
        textUnitIds: textUnitIds.get(row.id) ?? []
      })
    );
  }

  async getEntity(id: string): Promise<Entity | undefined> {
    return (await this.listEntities()).find((entity) => entity.id === id);
  }

  async upsertRelationships(relationships: readonly Relationship[]): Promise<void> {
    const records = relationships.map((relationship) => relationshipSchema.parse(relationship));
    if (records.length === 0) return;

    await this.db.transaction().execute(async (trx) => {
      const ids = records.map((relationship) => relationship.id);
      await trx
        .deleteFrom("grag_relationship_text_units")
        .where("relationship_id", "in", ids)
        .execute();
      await trx.deleteFrom("grag_relationships").where("id", "in", ids).execute();
      await trx.insertInto("grag_relationships").values(records.map(toRelationshipRow)).execute();
      await insertDynamic(
        trx,
        "grag_relationship_text_units",
        records.flatMap((relationship) =>
          links(relationship.id, "relationship_id", "text_unit_id", relationship.textUnitIds)
        )
      );
    });
  }

  async listRelationships(options?: ListOptions): Promise<Relationship[]> {
    const rows = await maybeLimitOffset(
      this.db.selectFrom("grag_relationships").selectAll().orderBy("source").orderBy("target"),
      options
    ).execute();
    const textUnitIds = await this.loadLinks("grag_relationship_text_units", "relationship_id", "text_unit_id");

    return rows.map((row) => fromRelationshipRow(row, textUnitIds.get(row.id) ?? []));
  }

  async getRelationship(id: string): Promise<Relationship | undefined> {
    return (await this.listRelationships()).find((relationship) => relationship.id === id);
  }

  async upsertCovariates(covariates: readonly Covariate[]): Promise<void> {
    const records = covariates.map((covariate) => covariateSchema.parse(covariate));
    if (records.length === 0) return;

    await this.db.transaction().execute(async (trx) => {
      const ids = records.map((covariate) => covariate.id);
      await trx.deleteFrom("grag_covariate_text_units").where("covariate_id", "in", ids).execute();
      await trx.deleteFrom("grag_covariates").where("id", "in", ids).execute();
      await trx.insertInto("grag_covariates").values(records.map(toCovariateRow)).execute();
      await insertDynamic(
        trx,
        "grag_covariate_text_units",
        records.flatMap((covariate) =>
          links(covariate.id, "covariate_id", "text_unit_id", covariate.textUnitIds)
        )
      );
    });
  }

  async listCovariates(options?: ListOptions): Promise<Covariate[]> {
    const rows = await maybeLimitOffset(
      this.db.selectFrom("grag_covariates").selectAll().orderBy("id"),
      options
    ).execute();
    const textUnitIds = await this.loadLinks("grag_covariate_text_units", "covariate_id", "text_unit_id");

    return rows.map((row) => fromCovariateRow(row, textUnitIds.get(row.id) ?? []));
  }

  async getCovariate(id: string): Promise<Covariate | undefined> {
    return (await this.listCovariates()).find((covariate) => covariate.id === id);
  }

  async upsertCommunities(communities: readonly Community[]): Promise<void> {
    const records = communities.map((community) => communitySchema.parse(community));
    if (records.length === 0) return;

    await this.db.transaction().execute(async (trx) => {
      const ids = records.map((community) => community.id);
      await trx.deleteFrom("grag_community_entities").where("community_id", "in", ids).execute();
      await trx.deleteFrom("grag_community_relationships").where("community_id", "in", ids).execute();
      await trx.deleteFrom("grag_community_text_units").where("community_id", "in", ids).execute();
      await trx.deleteFrom("grag_community_covariates").where("community_id", "in", ids).execute();
      await trx.deleteFrom("grag_communities").where("id", "in", ids).execute();
      await trx.insertInto("grag_communities").values(records.map(toCommunityRow)).execute();

      await insertDynamic(
        trx,
        "grag_community_entities",
        records.flatMap((community) => links(community.id, "community_id", "entity_id", community.entityIds))
      );
      await insertDynamic(
        trx,
        "grag_community_relationships",
        records.flatMap((community) =>
          links(community.id, "community_id", "relationship_id", community.relationshipIds)
        )
      );
      await insertDynamic(
        trx,
        "grag_community_text_units",
        records.flatMap((community) =>
          links(community.id, "community_id", "text_unit_id", community.textUnitIds)
        )
      );
      await insertDynamic(
        trx,
        "grag_community_covariates",
        records.flatMap((community) =>
          links(community.id, "community_id", "covariate_id", community.covariateIds)
        )
      );
    });
  }

  async listCommunities(options?: ListOptions): Promise<Community[]> {
    const rows = await maybeLimitOffset(
      this.db.selectFrom("grag_communities").selectAll().orderBy("level").orderBy("community"),
      options
    ).execute();
    const entityIds = await this.loadLinks("grag_community_entities", "community_id", "entity_id");
    const relationshipIds = await this.loadLinks(
      "grag_community_relationships",
      "community_id",
      "relationship_id"
    );
    const textUnitIds = await this.loadLinks("grag_community_text_units", "community_id", "text_unit_id");
    const covariateIds = await this.loadLinks("grag_community_covariates", "community_id", "covariate_id");

    return rows.map((row) =>
      fromCommunityRow(row, {
        entityIds: entityIds.get(row.id) ?? [],
        relationshipIds: relationshipIds.get(row.id) ?? [],
        textUnitIds: textUnitIds.get(row.id) ?? [],
        covariateIds: covariateIds.get(row.id) ?? []
      })
    );
  }

  async getCommunity(id: string): Promise<Community | undefined> {
    return (await this.listCommunities()).find((community) => community.id === id);
  }

  async upsertCommunityReports(reports: readonly CommunityReport[]): Promise<void> {
    const records = reports.map((report) => communityReportSchema.parse(report));
    if (records.length === 0) return;

    await this.db.transaction().execute(async (trx) => {
      const ids = records.map((report) => report.id);
      await trx.deleteFrom("grag_community_reports").where("id", "in", ids).execute();
      await trx.insertInto("grag_community_reports").values(records.map(toCommunityReportRow)).execute();
    });
  }

  async listCommunityReports(options?: CommunityReportListOptions): Promise<CommunityReport[]> {
    let query = this.db.selectFrom("grag_community_reports").selectAll().orderBy("rank", "desc");

    if (options?.level !== undefined) {
      query = query.where("level", "=", options.level);
    }
    if (options?.communityIds?.length) {
      query = query.where("community", "in", [...options.communityIds]);
    }

    return (await maybeLimitOffset(query, options).execute()).map(fromCommunityReportRow);
  }

  async getCommunityReport(id: string): Promise<CommunityReport | undefined> {
    const report = await this.db
      .selectFrom("grag_community_reports")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return report ? fromCommunityReportRow(report) : undefined;
  }

  async upsertEmbeddings(records: readonly EmbeddingRecord[]): Promise<void> {
    const parsed = records.map((record) => embeddingRecordSchema.parse(record));
    if (parsed.length === 0) return;

    await this.db.transaction().execute(async (trx) => {
      const ids = parsed.map((record) => record.id);
      await trx.deleteFrom("grag_embeddings").where("id", "in", ids).execute();
      await trx.insertInto("grag_embeddings").values(parsed.map(toEmbeddingRow)).execute();
    });
  }

  async listEmbeddings(options?: EmbeddingListOptions): Promise<EmbeddingRecord[]> {
    let query = this.db.selectFrom("grag_embeddings").selectAll().orderBy("id");

    if (options?.targetKind !== undefined) {
      query = query.where("target_kind", "=", options.targetKind);
    }
    if (options?.targetIds?.length) {
      query = query.where("target_id", "in", [...options.targetIds]);
    }
    if (options?.model !== undefined) {
      query = query.where("model", "=", options.model);
    }

    return (await maybeLimitOffset(query, options).execute()).map(fromEmbeddingRow);
  }

  async getEmbedding(id: string): Promise<EmbeddingRecord | undefined> {
    const embedding = await this.db
      .selectFrom("grag_embeddings")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return embedding ? fromEmbeddingRow(embedding) : undefined;
  }

  private async loadLinks(table: string, ownerColumn: string, valueColumn: string) {
    const rows = (await this.db
      .selectFrom(table as never)
      .select([ownerColumn, valueColumn] as never)
      .orderBy("position" as never)
      .execute()) as unknown as Record<string, unknown>[];

    return toMap(rows, ownerColumn, valueColumn);
  }
}

async function insertDynamic(
  db: Executor,
  table: keyof GraphRagSqlDatabase,
  rows: readonly Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return;
  await db.insertInto(table as never).values(rows as never).execute();
}

function withCreatedAt<T extends object>(row: T, value: string | null | undefined): T & { created_at?: string } {
  return value ? { ...row, created_at: value } : row;
}

function toDocumentRow(document: GraphRagDocument): GraphRagInsertable<"grag_documents"> {
  return withCreatedAt({
    id: document.id,
    human_readable_id: humanReadableId(document.humanReadableId),
    title: document.title,
    type: document.type,
    text: document.text,
    attributes_json: encodeJson(document.attributes),
    raw_data_json: encodeJson(document.rawData)
  }, document.createdAt);
}

function fromDocumentRow(
  row: GraphRagSelectable<"grag_documents">,
  textUnitIds: readonly string[]
): GraphRagDocument {
  return documentSchema.parse({
    id: row.id,
    humanReadableId: row.human_readable_id,
    title: row.title,
    type: row.type,
    text: row.text,
    textUnitIds,
    attributes: decodeJsonObject(row.attributes_json),
    rawData: decodeJsonObject(row.raw_data_json),
    createdAt: createdAt(row.created_at)
  });
}

function toTextUnitRow(textUnit: TextUnit) {
  return {
    id: textUnit.id,
    human_readable_id: humanReadableId(textUnit.humanReadableId),
    text: textUnit.text,
    n_tokens: textUnit.nTokens ?? null,
    document_id: textUnit.documentId ?? null,
    attributes_json: encodeJson(textUnit.attributes)
  };
}

function fromTextUnitRow(
  row: GraphRagSelectable<"grag_text_units">,
  relations: { entityIds: readonly string[]; relationshipIds: readonly string[]; covariateIds: readonly string[] }
): TextUnit {
  return textUnitSchema.parse({
    id: row.id,
    humanReadableId: row.human_readable_id,
    text: row.text,
    nTokens: row.n_tokens,
    documentId: row.document_id,
    attributes: decodeJsonObject(row.attributes_json),
    entityIds: relations.entityIds,
    relationshipIds: relations.relationshipIds,
    covariateIds: relations.covariateIds
  });
}

function toEntityRow(entity: Entity) {
  return {
    id: entity.id,
    human_readable_id: humanReadableId(entity.humanReadableId),
    title: entity.title,
    type: entity.type ?? null,
    description: entity.description ?? null,
    description_embedding_json: encodeJson(entity.descriptionEmbedding),
    name_embedding_json: encodeJson(entity.nameEmbedding),
    frequency: entity.frequency ?? null,
    degree: entity.degree ?? null,
    rank: entity.rank ?? null,
    attributes_json: encodeJson(entity.attributes)
  };
}

function fromEntityRow(
  row: GraphRagSelectable<"grag_entities">,
  relations: { communityIds: readonly string[]; textUnitIds: readonly string[] }
): Entity {
  return entitySchema.parse({
    id: row.id,
    humanReadableId: row.human_readable_id,
    title: row.title,
    type: row.type,
    description: row.description,
    descriptionEmbedding: decodeJson<number[] | null>(row.description_embedding_json, null),
    nameEmbedding: decodeJson<number[] | null>(row.name_embedding_json, null),
    frequency: row.frequency,
    degree: row.degree,
    rank: row.rank,
    attributes: decodeJsonObject(row.attributes_json),
    communityIds: relations.communityIds,
    textUnitIds: relations.textUnitIds
  });
}

function toRelationshipRow(relationship: Relationship) {
  return {
    id: relationship.id,
    human_readable_id: humanReadableId(relationship.humanReadableId),
    source: relationship.source,
    target: relationship.target,
    description: relationship.description ?? null,
    description_embedding_json: encodeJson(relationship.descriptionEmbedding),
    weight: relationship.weight,
    combined_degree: relationship.combinedDegree ?? null,
    rank: relationship.rank ?? null,
    attributes_json: encodeJson(relationship.attributes)
  };
}

function fromRelationshipRow(
  row: GraphRagSelectable<"grag_relationships">,
  textUnitIds: readonly string[]
): Relationship {
  return relationshipSchema.parse({
    id: row.id,
    humanReadableId: row.human_readable_id,
    source: row.source,
    target: row.target,
    description: row.description,
    descriptionEmbedding: decodeJson<number[] | null>(row.description_embedding_json, null),
    weight: row.weight,
    combinedDegree: row.combined_degree,
    rank: row.rank,
    attributes: decodeJsonObject(row.attributes_json),
    textUnitIds
  });
}

function toCovariateRow(covariate: Covariate) {
  return {
    id: covariate.id,
    human_readable_id: humanReadableId(covariate.humanReadableId),
    covariate_type: covariate.covariateType,
    type: covariate.type ?? null,
    description: covariate.description ?? null,
    subject_id: covariate.subjectId,
    subject_type: covariate.subjectType,
    object_id: covariate.objectId ?? null,
    status: covariate.status ?? null,
    start_date: covariate.startDate ?? null,
    end_date: covariate.endDate ?? null,
    source_text: covariate.sourceText ?? null,
    attributes_json: encodeJson(covariate.attributes)
  };
}

function fromCovariateRow(
  row: GraphRagSelectable<"grag_covariates">,
  textUnitIds: readonly string[]
): Covariate {
  return covariateSchema.parse({
    id: row.id,
    humanReadableId: row.human_readable_id,
    covariateType: row.covariate_type,
    type: row.type,
    description: row.description,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    objectId: row.object_id,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    sourceText: row.source_text,
    attributes: decodeJsonObject(row.attributes_json),
    textUnitIds
  });
}

function toCommunityRow(community: Community) {
  return {
    id: community.id,
    human_readable_id: humanReadableId(community.humanReadableId),
    community: community.community,
    level: community.level,
    parent: community.parent ?? null,
    children_json: JSON.stringify(community.children),
    title: community.title,
    attributes_json: encodeJson(community.attributes),
    period: community.period ?? null,
    size: community.size ?? null
  };
}

function fromCommunityRow(
  row: GraphRagSelectable<"grag_communities">,
  relations: {
    entityIds: readonly string[];
    relationshipIds: readonly string[];
    textUnitIds: readonly string[];
    covariateIds: readonly string[];
  }
): Community {
  return communitySchema.parse({
    id: row.id,
    humanReadableId: row.human_readable_id,
    community: row.community,
    level: row.level,
    parent: row.parent,
    children: decodeJson<number[]>(row.children_json, []),
    title: row.title,
    attributes: decodeJsonObject(row.attributes_json),
    period: row.period,
    size: row.size,
    entityIds: relations.entityIds,
    relationshipIds: relations.relationshipIds,
    textUnitIds: relations.textUnitIds,
    covariateIds: relations.covariateIds
  });
}

function toCommunityReportRow(report: CommunityReport) {
  return {
    id: report.id,
    human_readable_id: humanReadableId(report.humanReadableId),
    community: report.community,
    level: report.level,
    parent: report.parent ?? null,
    children_json: JSON.stringify(report.children),
    title: report.title,
    summary: report.summary,
    full_content: report.fullContent,
    rank: report.rank,
    rating_explanation: report.ratingExplanation ?? null,
    findings_json: JSON.stringify(report.findings),
    full_content_json: encodeJson(report.fullContentJson),
    full_content_embedding_json: encodeJson(report.fullContentEmbedding),
    attributes_json: encodeJson(report.attributes),
    period: report.period ?? null,
    size: report.size ?? null
  };
}

function fromCommunityReportRow(row: GraphRagSelectable<"grag_community_reports">): CommunityReport {
  return communityReportSchema.parse({
    id: row.id,
    humanReadableId: row.human_readable_id,
    community: row.community,
    level: row.level,
    parent: row.parent,
    children: decodeJson<number[]>(row.children_json, []),
    title: row.title,
    summary: row.summary,
    fullContent: row.full_content,
    rank: row.rank,
    ratingExplanation: row.rating_explanation,
    findings: decodeJson<JsonObject[]>(row.findings_json, []),
    fullContentJson: decodeJson<JsonObject | null>(row.full_content_json, null),
    fullContentEmbedding: decodeJson<number[] | null>(row.full_content_embedding_json, null),
    attributes: decodeJsonObject(row.attributes_json),
    period: row.period,
    size: row.size
  });
}

function toEmbeddingRow(record: EmbeddingRecord) {
  return withCreatedAt({
    id: record.id,
    human_readable_id: humanReadableId(record.humanReadableId),
    target_kind: record.targetKind,
    target_id: record.targetId,
    vector_json: JSON.stringify(record.vector),
    model: record.model ?? null,
    dimensions: record.dimensions ?? record.vector.length,
    text: record.text ?? null,
    metadata_json: encodeJson(record.metadata)
  }, record.createdAt);
}

function fromEmbeddingRow(row: GraphRagSelectable<"grag_embeddings">): EmbeddingRecord {
  return embeddingRecordSchema.parse({
    id: row.id,
    humanReadableId: row.human_readable_id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    vector: decodeJson<number[]>(row.vector_json, []),
    model: row.model,
    dimensions: row.dimensions,
    text: row.text,
    metadata: decodeJsonObject(row.metadata_json),
    createdAt: createdAt(row.created_at)
  });
}
