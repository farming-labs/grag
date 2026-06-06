import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);

export const humanReadableIdSchema = z.union([z.string(), z.number()]);

export const identifiedSchema = z.object({
  id: z.string().min(1),
  humanReadableId: humanReadableIdSchema.nullish(),
});

export const namedSchema = identifiedSchema.extend({
  title: z.string().min(1),
});

export const documentSchema = namedSchema.extend({
  type: z.string().default("text"),
  text: z.string(),
  textUnitIds: z.array(z.string()).default([]),
  attributes: jsonObjectSchema.nullish(),
  createdAt: z.string().nullish(),
  rawData: jsonObjectSchema.nullish(),
});

export const textUnitSchema = identifiedSchema.extend({
  text: z.string(),
  entityIds: z.array(z.string()).default([]),
  relationshipIds: z.array(z.string()).default([]),
  covariateIds: z.array(z.string()).default([]),
  nTokens: z.number().int().nonnegative().nullish(),
  documentId: z.string().nullish(),
  attributes: jsonObjectSchema.nullish(),
});

export const entitySchema = namedSchema.extend({
  type: z.string().nullish(),
  description: z.string().nullish(),
  descriptionEmbedding: z.array(z.number()).nullish(),
  nameEmbedding: z.array(z.number()).nullish(),
  communityIds: z.array(z.string()).default([]),
  textUnitIds: z.array(z.string()).default([]),
  frequency: z.number().int().nonnegative().nullish(),
  degree: z.number().int().nonnegative().nullish(),
  rank: z.number().nullish(),
  attributes: jsonObjectSchema.nullish(),
});

export const relationshipSchema = identifiedSchema.extend({
  source: z.string().min(1),
  target: z.string().min(1),
  description: z.string().nullish(),
  descriptionEmbedding: z.array(z.number()).nullish(),
  weight: z.number().default(1),
  combinedDegree: z.number().int().nonnegative().nullish(),
  rank: z.number().nullish(),
  textUnitIds: z.array(z.string()).default([]),
  attributes: jsonObjectSchema.nullish(),
});

export const covariateSchema = identifiedSchema.extend({
  covariateType: z.string().default("claim"),
  type: z.string().nullish(),
  description: z.string().nullish(),
  subjectId: z.string().min(1),
  subjectType: z.string().default("entity"),
  objectId: z.string().nullish(),
  status: z.enum(["TRUE", "FALSE", "SUSPECTED"]).or(z.string()).nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  sourceText: z.string().nullish(),
  textUnitIds: z.array(z.string()).default([]),
  attributes: jsonObjectSchema.nullish(),
});

export const communitySchema = namedSchema.extend({
  community: z.number().int(),
  level: z.number().int().nonnegative(),
  parent: z.number().int().nullish(),
  children: z.array(z.number().int()).default([]),
  entityIds: z.array(z.string()).default([]),
  relationshipIds: z.array(z.string()).default([]),
  textUnitIds: z.array(z.string()).default([]),
  covariateIds: z.array(z.string()).default([]),
  attributes: jsonObjectSchema.nullish(),
  period: z.string().nullish(),
  size: z.number().int().nonnegative().nullish(),
});

export const findingSchema = z.object({
  summary: z.string(),
  explanation: z.string().nullish(),
});

export const communityReportSchema = namedSchema.extend({
  community: z.number().int(),
  level: z.number().int().nonnegative(),
  parent: z.number().int().nullish(),
  children: z.array(z.number().int()).default([]),
  summary: z.string().default(""),
  fullContent: z.string().default(""),
  rank: z.number().default(1),
  ratingExplanation: z.string().nullish(),
  findings: z.array(findingSchema).default([]),
  fullContentJson: jsonObjectSchema.nullish(),
  fullContentEmbedding: z.array(z.number()).nullish(),
  attributes: jsonObjectSchema.nullish(),
  period: z.string().nullish(),
  size: z.number().int().nonnegative().nullish(),
});

export const embeddingTargetKindSchema = z.enum([
  "document",
  "text_unit",
  "entity",
  "relationship",
  "community",
  "community_report",
]);

export const embeddingRecordSchema = identifiedSchema.extend({
  targetKind: embeddingTargetKindSchema,
  targetId: z.string().min(1),
  vector: z.array(z.number()),
  model: z.string().nullish(),
  dimensions: z.number().int().positive().nullish(),
  text: z.string().nullish(),
  metadata: jsonObjectSchema.nullish(),
  createdAt: z.string().nullish(),
});

export const graphRagSnapshotSchema = z.object({
  documents: z.array(documentSchema).default([]),
  textUnits: z.array(textUnitSchema).default([]),
  entities: z.array(entitySchema).default([]),
  relationships: z.array(relationshipSchema).default([]),
  covariates: z.array(covariateSchema).default([]),
  communities: z.array(communitySchema).default([]),
  communityReports: z.array(communityReportSchema).default([]),
  embeddings: z.array(embeddingRecordSchema).default([]),
});

export type HumanReadableId = z.infer<typeof humanReadableIdSchema>;
export type Identified = z.infer<typeof identifiedSchema>;
export type Named = z.infer<typeof namedSchema>;
export type GraphRagDocument = z.infer<typeof documentSchema>;
export type TextUnit = z.infer<typeof textUnitSchema>;
export type Entity = z.infer<typeof entitySchema>;
export type Relationship = z.infer<typeof relationshipSchema>;
export type Covariate = z.infer<typeof covariateSchema>;
export type Community = z.infer<typeof communitySchema>;
export type CommunityReportFinding = z.infer<typeof findingSchema>;
export type CommunityReport = z.infer<typeof communityReportSchema>;
export type EmbeddingTargetKind = z.infer<typeof embeddingTargetKindSchema>;
export type EmbeddingRecord = z.infer<typeof embeddingRecordSchema>;
export type GraphRagSnapshot = z.infer<typeof graphRagSnapshotSchema>;

export type PartialGraphRagSnapshot = Partial<{
  [K in keyof GraphRagSnapshot]: GraphRagSnapshot[K];
}>;

export const graphRagTableNames = [
  "documents",
  "textUnits",
  "entities",
  "relationships",
  "covariates",
  "communities",
  "communityReports",
  "embeddings",
] as const;

export type GraphRagTableName = (typeof graphRagTableNames)[number];
