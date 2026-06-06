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
  type JsonObject,
  type PartialGraphRagSnapshot,
  type Relationship,
  type TextUnit,
} from "../model.js";
import type {
  CommunityReportListOptions,
  EmbeddingListOptions,
  GraphRagStore,
  ListOptions,
} from "../storage/types.js";
import { decodeJson, decodeJsonObject, encodeJson } from "../utils/json.js";
import type { GraphRagOrmClient } from "./schema.js";

type OrmModelClient = {
  findMany(args?: unknown): Promise<Record<string, unknown>[]>;
  findUnique(args: unknown): Promise<Record<string, unknown> | null>;
  createMany(args: unknown): Promise<Record<string, unknown>[]>;
  deleteMany(args: unknown): Promise<number>;
};

type GraphRagOrmTx = GraphRagOrmClient;

type LinkModelName =
  | "documentTextUnit"
  | "textUnitEntity"
  | "textUnitRelationship"
  | "textUnitCovariate"
  | "entityCommunity"
  | "entityTextUnit"
  | "relationshipTextUnit"
  | "covariateTextUnit"
  | "communityEntity"
  | "communityRelationship"
  | "communityTextUnit"
  | "communityCovariate";

export interface OrmGraphRagStoreOptions {
  orm: GraphRagOrmClient;
}

export class OrmGraphRagStore implements GraphRagStore {
  readonly orm: GraphRagOrmClient;

  constructor(options: OrmGraphRagStoreOptions) {
    this.orm = options.orm;
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
      embeddings: await this.listEmbeddings(),
    });
  }

  async upsertDocuments(documents: readonly GraphRagDocument[]): Promise<void> {
    const records = documents.map((document) => documentSchema.parse(document));
    if (!records.length) return;

    await this.orm.transaction(async (tx) => {
      const ids = records.map((document) => document.id);
      await deleteWhereIn(tx, "documentTextUnit", "documentId", ids);
      await deleteWhereIn(tx, "document", "id", ids);
      await tx.document.createMany({ data: records.map(toDocumentRow) });
      await createLinks(tx, "documentTextUnit", "documentId", "textUnitId", records);
    });
  }

  async listDocuments(options?: ListOptions): Promise<GraphRagDocument[]> {
    const rows = await this.orm.document.findMany(toFindManyArgs(options, { id: "asc" }));
    const textUnitIds = await loadLinks(this.orm, "documentTextUnit", "documentId", "textUnitId");
    return rows.map((row) => fromDocumentRow(row, textUnitIds.get(row.id) ?? []));
  }

  async getDocument(id: string): Promise<GraphRagDocument | undefined> {
    const row = await this.orm.document.findUnique({ where: { id } });
    if (!row) return undefined;
    const textUnitIds = await loadLinks(this.orm, "documentTextUnit", "documentId", "textUnitId");
    return fromDocumentRow(row, textUnitIds.get(row.id) ?? []);
  }

  async upsertTextUnits(textUnits: readonly TextUnit[]): Promise<void> {
    const records = textUnits.map((textUnit) => textUnitSchema.parse(textUnit));
    if (!records.length) return;

    await this.orm.transaction(async (tx) => {
      const ids = records.map((textUnit) => textUnit.id);
      await deleteWhereIn(tx, "textUnitEntity", "textUnitId", ids);
      await deleteWhereIn(tx, "textUnitRelationship", "textUnitId", ids);
      await deleteWhereIn(tx, "textUnitCovariate", "textUnitId", ids);
      await deleteWhereIn(tx, "textUnit", "id", ids);
      await tx.textUnit.createMany({ data: records.map(toTextUnitRow) });
      await createLinks(tx, "textUnitEntity", "textUnitId", "entityId", records, "entityIds");
      await createLinks(
        tx,
        "textUnitRelationship",
        "textUnitId",
        "relationshipId",
        records,
        "relationshipIds",
      );
      await createLinks(
        tx,
        "textUnitCovariate",
        "textUnitId",
        "covariateId",
        records,
        "covariateIds",
      );
    });
  }

  async listTextUnits(options?: ListOptions): Promise<TextUnit[]> {
    const rows = await this.orm.textUnit.findMany(toFindManyArgs(options, { id: "asc" }));
    const entityIds = await loadLinks(this.orm, "textUnitEntity", "textUnitId", "entityId");
    const relationshipIds = await loadLinks(
      this.orm,
      "textUnitRelationship",
      "textUnitId",
      "relationshipId",
    );
    const covariateIds = await loadLinks(
      this.orm,
      "textUnitCovariate",
      "textUnitId",
      "covariateId",
    );

    return rows.map((row) =>
      fromTextUnitRow(row, {
        entityIds: entityIds.get(row.id) ?? [],
        relationshipIds: relationshipIds.get(row.id) ?? [],
        covariateIds: covariateIds.get(row.id) ?? [],
      }),
    );
  }

  async getTextUnit(id: string): Promise<TextUnit | undefined> {
    const row = await this.orm.textUnit.findUnique({ where: { id } });
    if (!row) return undefined;
    const entityIds = await loadLinks(this.orm, "textUnitEntity", "textUnitId", "entityId");
    const relationshipIds = await loadLinks(
      this.orm,
      "textUnitRelationship",
      "textUnitId",
      "relationshipId",
    );
    const covariateIds = await loadLinks(
      this.orm,
      "textUnitCovariate",
      "textUnitId",
      "covariateId",
    );
    return fromTextUnitRow(row, {
      entityIds: entityIds.get(id) ?? [],
      relationshipIds: relationshipIds.get(id) ?? [],
      covariateIds: covariateIds.get(id) ?? [],
    });
  }

  async upsertEntities(entities: readonly Entity[]): Promise<void> {
    const records = entities.map((entity) => entitySchema.parse(entity));
    if (!records.length) return;

    await this.orm.transaction(async (tx) => {
      const ids = records.map((entity) => entity.id);
      await deleteWhereIn(tx, "entityCommunity", "entityId", ids);
      await deleteWhereIn(tx, "entityTextUnit", "entityId", ids);
      await deleteWhereIn(tx, "entity", "id", ids);
      await tx.entity.createMany({ data: records.map(toEntityRow) });
      await createLinks(tx, "entityCommunity", "entityId", "communityId", records, "communityIds");
      await createLinks(tx, "entityTextUnit", "entityId", "textUnitId", records, "textUnitIds");
    });
  }

  async listEntities(options?: ListOptions): Promise<Entity[]> {
    const rows = await this.orm.entity.findMany(toFindManyArgs(options, { title: "asc" }));
    const communityIds = await loadLinks(this.orm, "entityCommunity", "entityId", "communityId");
    const textUnitIds = await loadLinks(this.orm, "entityTextUnit", "entityId", "textUnitId");
    return rows.map((row) =>
      fromEntityRow(row, {
        communityIds: communityIds.get(row.id) ?? [],
        textUnitIds: textUnitIds.get(row.id) ?? [],
      }),
    );
  }

  async getEntity(id: string): Promise<Entity | undefined> {
    return (await this.listEntities()).find((entity) => entity.id === id);
  }

  async upsertRelationships(relationships: readonly Relationship[]): Promise<void> {
    const records = relationships.map((relationship) => relationshipSchema.parse(relationship));
    if (!records.length) return;

    await this.orm.transaction(async (tx) => {
      const ids = records.map((relationship) => relationship.id);
      await deleteWhereIn(tx, "relationshipTextUnit", "relationshipId", ids);
      await deleteWhereIn(tx, "relationship", "id", ids);
      await tx.relationship.createMany({ data: records.map(toRelationshipRow) });
      await createLinks(
        tx,
        "relationshipTextUnit",
        "relationshipId",
        "textUnitId",
        records,
        "textUnitIds",
      );
    });
  }

  async listRelationships(options?: ListOptions): Promise<Relationship[]> {
    const rows = await this.orm.relationship.findMany(toFindManyArgs(options, { source: "asc" }));
    const textUnitIds = await loadLinks(
      this.orm,
      "relationshipTextUnit",
      "relationshipId",
      "textUnitId",
    );
    return rows.map((row) => fromRelationshipRow(row, textUnitIds.get(row.id) ?? []));
  }

  async getRelationship(id: string): Promise<Relationship | undefined> {
    return (await this.listRelationships()).find((relationship) => relationship.id === id);
  }

  async upsertCovariates(covariates: readonly Covariate[]): Promise<void> {
    const records = covariates.map((covariate) => covariateSchema.parse(covariate));
    if (!records.length) return;

    await this.orm.transaction(async (tx) => {
      const ids = records.map((covariate) => covariate.id);
      await deleteWhereIn(tx, "covariateTextUnit", "covariateId", ids);
      await deleteWhereIn(tx, "covariate", "id", ids);
      await tx.covariate.createMany({ data: records.map(toCovariateRow) });
      await createLinks(
        tx,
        "covariateTextUnit",
        "covariateId",
        "textUnitId",
        records,
        "textUnitIds",
      );
    });
  }

  async listCovariates(options?: ListOptions): Promise<Covariate[]> {
    const rows = await this.orm.covariate.findMany(toFindManyArgs(options, { id: "asc" }));
    const textUnitIds = await loadLinks(this.orm, "covariateTextUnit", "covariateId", "textUnitId");
    return rows.map((row) => fromCovariateRow(row, textUnitIds.get(row.id) ?? []));
  }

  async getCovariate(id: string): Promise<Covariate | undefined> {
    return (await this.listCovariates()).find((covariate) => covariate.id === id);
  }

  async upsertCommunities(communities: readonly Community[]): Promise<void> {
    const records = communities.map((community) => communitySchema.parse(community));
    if (!records.length) return;

    await this.orm.transaction(async (tx) => {
      const ids = records.map((community) => community.id);
      await deleteWhereIn(tx, "communityEntity", "communityId", ids);
      await deleteWhereIn(tx, "communityRelationship", "communityId", ids);
      await deleteWhereIn(tx, "communityTextUnit", "communityId", ids);
      await deleteWhereIn(tx, "communityCovariate", "communityId", ids);
      await deleteWhereIn(tx, "community", "id", ids);
      await tx.community.createMany({ data: records.map(toCommunityRow) });
      await createLinks(tx, "communityEntity", "communityId", "entityId", records, "entityIds");
      await createLinks(
        tx,
        "communityRelationship",
        "communityId",
        "relationshipId",
        records,
        "relationshipIds",
      );
      await createLinks(
        tx,
        "communityTextUnit",
        "communityId",
        "textUnitId",
        records,
        "textUnitIds",
      );
      await createLinks(
        tx,
        "communityCovariate",
        "communityId",
        "covariateId",
        records,
        "covariateIds",
      );
    });
  }

  async listCommunities(options?: ListOptions): Promise<Community[]> {
    const rows = await this.orm.community.findMany(toFindManyArgs(options, { level: "asc" }));
    const entityIds = await loadLinks(this.orm, "communityEntity", "communityId", "entityId");
    const relationshipIds = await loadLinks(
      this.orm,
      "communityRelationship",
      "communityId",
      "relationshipId",
    );
    const textUnitIds = await loadLinks(this.orm, "communityTextUnit", "communityId", "textUnitId");
    const covariateIds = await loadLinks(
      this.orm,
      "communityCovariate",
      "communityId",
      "covariateId",
    );
    return rows.map((row) =>
      fromCommunityRow(row, {
        entityIds: entityIds.get(row.id) ?? [],
        relationshipIds: relationshipIds.get(row.id) ?? [],
        textUnitIds: textUnitIds.get(row.id) ?? [],
        covariateIds: covariateIds.get(row.id) ?? [],
      }),
    );
  }

  async getCommunity(id: string): Promise<Community | undefined> {
    return (await this.listCommunities()).find((community) => community.id === id);
  }

  async upsertCommunityReports(reports: readonly CommunityReport[]): Promise<void> {
    const records = reports.map((report) => communityReportSchema.parse(report));
    if (!records.length) return;

    await this.orm.transaction(async (tx) => {
      const ids = records.map((report) => report.id);
      await deleteWhereIn(tx, "communityReport", "id", ids);
      await tx.communityReport.createMany({ data: records.map(toCommunityReportRow) });
    });
  }

  async listCommunityReports(options?: CommunityReportListOptions): Promise<CommunityReport[]> {
    const where: Record<string, unknown> = {};
    if (options?.level !== undefined) where.level = options.level;
    if (options?.communityIds?.length) where.community = { in: [...options.communityIds] };

    const rows = await this.orm.communityReport.findMany({
      ...toFindManyArgs(options, { rank: "desc" }),
      where,
    });
    return rows.map(fromCommunityReportRow);
  }

  async getCommunityReport(id: string): Promise<CommunityReport | undefined> {
    const row = await this.orm.communityReport.findUnique({ where: { id } });
    return row ? fromCommunityReportRow(row) : undefined;
  }

  async upsertEmbeddings(records: readonly EmbeddingRecord[]): Promise<void> {
    const parsed = records.map((record) => embeddingRecordSchema.parse(record));
    if (!parsed.length) return;

    await this.orm.transaction(async (tx) => {
      const ids = parsed.map((record) => record.id);
      await deleteWhereIn(tx, "embedding", "id", ids);
      await tx.embedding.createMany({ data: parsed.map(toEmbeddingRow) });
    });
  }

  async listEmbeddings(options?: EmbeddingListOptions): Promise<EmbeddingRecord[]> {
    const where: Record<string, unknown> = {};
    if (options?.targetKind !== undefined) where.targetKind = options.targetKind;
    if (options?.targetIds?.length) where.targetId = { in: [...options.targetIds] };
    if (options?.model !== undefined) where.model = options.model;

    const rows = await this.orm.embedding.findMany({
      ...toFindManyArgs(options, { id: "asc" }),
      where,
    });
    return rows.map(fromEmbeddingRow);
  }

  async getEmbedding(id: string): Promise<EmbeddingRecord | undefined> {
    const row = await this.orm.embedding.findUnique({ where: { id } });
    return row ? fromEmbeddingRow(row) : undefined;
  }
}

function clientFor(orm: GraphRagOrmClient, model: string): OrmModelClient {
  return (orm as unknown as Record<string, OrmModelClient>)[model]!;
}

async function deleteWhereIn(
  orm: GraphRagOrmTx,
  model: string,
  field: string,
  values: readonly string[],
): Promise<void> {
  if (!values.length) return;
  await clientFor(orm, model).deleteMany({
    where: {
      [field]: {
        in: [...values],
      },
    },
  });
}

async function loadLinks(
  orm: GraphRagOrmClient,
  model: LinkModelName,
  ownerKey: string,
  valueKey: string,
): Promise<Map<string, string[]>> {
  const rows = await clientFor(orm, model).findMany({
    orderBy: {
      position: "asc",
    },
  });
  const map = new Map<string, string[]>();

  for (const row of rows) {
    const owner = String(row[ownerKey]);
    const value = String(row[valueKey]);
    const values = map.get(owner);
    if (values) {
      values.push(value);
    } else {
      map.set(owner, [value]);
    }
  }

  return map;
}

async function createLinks<T extends { id: string }>(
  orm: GraphRagOrmTx,
  model: LinkModelName,
  ownerKey: string,
  valueKey: string,
  records: readonly T[],
  sourceKey: keyof T = "textUnitIds" as keyof T,
): Promise<void> {
  const rows = records.flatMap((record) => {
    const values = (record[sourceKey] as readonly string[] | undefined) ?? [];
    return values.map((value, position) => ({
      [ownerKey]: record.id,
      [valueKey]: value,
      position,
    }));
  });

  if (!rows.length) return;
  await clientFor(orm, model).createMany({ data: rows });
}

function toFindManyArgs(options: ListOptions | undefined, orderBy: Record<string, "asc" | "desc">) {
  const args: {
    orderBy: Record<string, "asc" | "desc">;
    take?: number;
    skip?: number;
  } = { orderBy };

  if (options?.limit !== undefined) args.take = options.limit;
  if (options?.offset !== undefined) args.skip = options.offset;

  return args;
}

function parseDecimal(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === "") return fallback;
  return Number(value);
}

function decimalString(value: number | null | undefined): string | null {
  return value === undefined || value === null ? null : String(value);
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toDocumentRow(document: GraphRagDocument) {
  return {
    id: document.id,
    humanReadableId:
      document.humanReadableId === undefined ? null : String(document.humanReadableId),
    title: document.title,
    type: document.type,
    text: document.text,
    attributesJson: encodeJson(document.attributes),
    rawDataJson: encodeJson(document.rawData),
    createdAt: document.createdAt ?? null,
  };
}

function fromDocumentRow(
  row: Record<string, unknown>,
  textUnitIds: readonly string[],
): GraphRagDocument {
  return documentSchema.parse({
    id: row.id,
    humanReadableId: row.humanReadableId,
    title: row.title,
    type: row.type,
    text: row.text,
    textUnitIds,
    attributes: decodeJsonObject(asString(row.attributesJson)),
    rawData: decodeJsonObject(asString(row.rawDataJson)),
    createdAt: asString(row.createdAt),
  });
}

function toTextUnitRow(textUnit: TextUnit) {
  return {
    id: textUnit.id,
    humanReadableId:
      textUnit.humanReadableId === undefined ? null : String(textUnit.humanReadableId),
    text: textUnit.text,
    nTokens: textUnit.nTokens ?? null,
    documentId: textUnit.documentId ?? null,
    attributesJson: encodeJson(textUnit.attributes),
    createdAt: null,
  };
}

function fromTextUnitRow(
  row: Record<string, unknown>,
  relations: {
    entityIds: readonly string[];
    relationshipIds: readonly string[];
    covariateIds: readonly string[];
  },
): TextUnit {
  return textUnitSchema.parse({
    id: row.id,
    humanReadableId: row.humanReadableId,
    text: row.text,
    nTokens: row.nTokens,
    documentId: row.documentId,
    attributes: decodeJsonObject(asString(row.attributesJson)),
    entityIds: relations.entityIds,
    relationshipIds: relations.relationshipIds,
    covariateIds: relations.covariateIds,
  });
}

function toEntityRow(entity: Entity) {
  return {
    id: entity.id,
    humanReadableId: entity.humanReadableId === undefined ? null : String(entity.humanReadableId),
    title: entity.title,
    type: entity.type ?? null,
    description: entity.description ?? null,
    descriptionEmbeddingJson: encodeJson(entity.descriptionEmbedding),
    nameEmbeddingJson: encodeJson(entity.nameEmbedding),
    frequency: entity.frequency ?? null,
    degree: entity.degree ?? null,
    rank: decimalString(entity.rank),
    attributesJson: encodeJson(entity.attributes),
    createdAt: null,
  };
}

function fromEntityRow(
  row: Record<string, unknown>,
  relations: { communityIds: readonly string[]; textUnitIds: readonly string[] },
): Entity {
  return entitySchema.parse({
    id: row.id,
    humanReadableId: row.humanReadableId,
    title: row.title,
    type: row.type,
    description: row.description,
    descriptionEmbedding: decodeJson<number[] | null>(asString(row.descriptionEmbeddingJson), null),
    nameEmbedding: decodeJson<number[] | null>(asString(row.nameEmbeddingJson), null),
    frequency: row.frequency,
    degree: row.degree,
    rank: row.rank === null ? null : parseDecimal(row.rank, 1),
    attributes: decodeJsonObject(asString(row.attributesJson)),
    communityIds: relations.communityIds,
    textUnitIds: relations.textUnitIds,
  });
}

function toRelationshipRow(relationship: Relationship) {
  return {
    id: relationship.id,
    humanReadableId:
      relationship.humanReadableId === undefined ? null : String(relationship.humanReadableId),
    source: relationship.source,
    target: relationship.target,
    description: relationship.description ?? null,
    descriptionEmbeddingJson: encodeJson(relationship.descriptionEmbedding),
    weight: String(relationship.weight),
    combinedDegree: relationship.combinedDegree ?? null,
    rank: decimalString(relationship.rank),
    attributesJson: encodeJson(relationship.attributes),
    createdAt: null,
  };
}

function fromRelationshipRow(
  row: Record<string, unknown>,
  textUnitIds: readonly string[],
): Relationship {
  return relationshipSchema.parse({
    id: row.id,
    humanReadableId: row.humanReadableId,
    source: row.source,
    target: row.target,
    description: row.description,
    descriptionEmbedding: decodeJson<number[] | null>(asString(row.descriptionEmbeddingJson), null),
    weight: parseDecimal(row.weight, 1),
    combinedDegree: row.combinedDegree,
    rank: row.rank === null ? null : parseDecimal(row.rank, 1),
    attributes: decodeJsonObject(asString(row.attributesJson)),
    textUnitIds,
  });
}

function toCovariateRow(covariate: Covariate) {
  return {
    id: covariate.id,
    humanReadableId:
      covariate.humanReadableId === undefined ? null : String(covariate.humanReadableId),
    covariateType: covariate.covariateType,
    type: covariate.type ?? null,
    description: covariate.description ?? null,
    subjectId: covariate.subjectId,
    subjectType: covariate.subjectType,
    objectId: covariate.objectId ?? null,
    status: covariate.status ?? null,
    startDate: covariate.startDate ?? null,
    endDate: covariate.endDate ?? null,
    sourceText: covariate.sourceText ?? null,
    attributesJson: encodeJson(covariate.attributes),
    createdAt: null,
  };
}

function fromCovariateRow(row: Record<string, unknown>, textUnitIds: readonly string[]): Covariate {
  return covariateSchema.parse({
    id: row.id,
    humanReadableId: row.humanReadableId,
    covariateType: row.covariateType,
    type: row.type,
    description: row.description,
    subjectId: row.subjectId,
    subjectType: row.subjectType,
    objectId: row.objectId,
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate,
    sourceText: row.sourceText,
    attributes: decodeJsonObject(asString(row.attributesJson)),
    textUnitIds,
  });
}

function toCommunityRow(community: Community) {
  return {
    id: community.id,
    humanReadableId:
      community.humanReadableId === undefined ? null : String(community.humanReadableId),
    community: community.community,
    level: community.level,
    parent: community.parent ?? null,
    childrenJson: JSON.stringify(community.children),
    title: community.title,
    attributesJson: encodeJson(community.attributes),
    period: community.period ?? null,
    size: community.size ?? null,
    createdAt: null,
  };
}

function fromCommunityRow(
  row: Record<string, unknown>,
  relations: {
    entityIds: readonly string[];
    relationshipIds: readonly string[];
    textUnitIds: readonly string[];
    covariateIds: readonly string[];
  },
): Community {
  return communitySchema.parse({
    id: row.id,
    humanReadableId: row.humanReadableId,
    community: row.community,
    level: row.level,
    parent: row.parent,
    children: decodeJson<number[]>(asString(row.childrenJson), []),
    title: row.title,
    attributes: decodeJsonObject(asString(row.attributesJson)),
    period: row.period,
    size: row.size,
    entityIds: relations.entityIds,
    relationshipIds: relations.relationshipIds,
    textUnitIds: relations.textUnitIds,
    covariateIds: relations.covariateIds,
  });
}

function toCommunityReportRow(report: CommunityReport) {
  return {
    id: report.id,
    humanReadableId: report.humanReadableId === undefined ? null : String(report.humanReadableId),
    community: report.community,
    level: report.level,
    parent: report.parent ?? null,
    childrenJson: JSON.stringify(report.children),
    title: report.title,
    summary: report.summary,
    fullContent: report.fullContent,
    rank: String(report.rank),
    ratingExplanation: report.ratingExplanation ?? null,
    findingsJson: JSON.stringify(report.findings),
    fullContentJson: encodeJson(report.fullContentJson),
    fullContentEmbeddingJson: encodeJson(report.fullContentEmbedding),
    attributesJson: encodeJson(report.attributes),
    period: report.period ?? null,
    size: report.size ?? null,
    createdAt: null,
  };
}

function fromCommunityReportRow(row: Record<string, unknown>): CommunityReport {
  return communityReportSchema.parse({
    id: row.id,
    humanReadableId: row.humanReadableId,
    community: row.community,
    level: row.level,
    parent: row.parent,
    children: decodeJson<number[]>(asString(row.childrenJson), []),
    title: row.title,
    summary: row.summary,
    fullContent: row.fullContent,
    rank: parseDecimal(row.rank, 1),
    ratingExplanation: row.ratingExplanation,
    findings: decodeJson<JsonObject[]>(asString(row.findingsJson), []),
    fullContentJson: decodeJson<JsonObject | null>(asString(row.fullContentJson), null),
    fullContentEmbedding: decodeJson<number[] | null>(asString(row.fullContentEmbeddingJson), null),
    attributes: decodeJsonObject(asString(row.attributesJson)),
    period: row.period,
    size: row.size,
  });
}

function toEmbeddingRow(record: EmbeddingRecord) {
  return {
    id: record.id,
    humanReadableId: record.humanReadableId === undefined ? null : String(record.humanReadableId),
    targetKind: record.targetKind,
    targetId: record.targetId,
    vectorJson: JSON.stringify(record.vector),
    model: record.model ?? null,
    dimensions: record.dimensions ?? record.vector.length,
    text: record.text ?? null,
    metadataJson: encodeJson(record.metadata),
    createdAt: record.createdAt ?? null,
  };
}

function fromEmbeddingRow(row: Record<string, unknown>): EmbeddingRecord {
  return embeddingRecordSchema.parse({
    id: row.id,
    humanReadableId: row.humanReadableId,
    targetKind: row.targetKind,
    targetId: row.targetId,
    vector: decodeJson<number[]>(asString(row.vectorJson), []),
    model: row.model,
    dimensions: row.dimensions,
    text: row.text,
    metadata: decodeJsonObject(asString(row.metadataJson)),
    createdAt: asString(row.createdAt),
  });
}
