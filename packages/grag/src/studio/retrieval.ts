import type {
  CommunityReport,
  Entity,
  GraphRagSnapshot,
  Relationship,
  TextUnit
} from "../model.js";

export type GraphRagRetrievalHitKind = "entity" | "relationship" | "text_unit" | "community_report";

export interface GraphRagRetrievalHit {
  kind: GraphRagRetrievalHitKind;
  id: string;
  title: string;
  score: number;
  text: string;
  sourcePaths: string[];
  entityIds: string[];
  relationshipIds: string[];
}

export interface GraphRagRetrievalResult {
  query: string;
  tokens: string[];
  hits: GraphRagRetrievalHit[];
  context: string;
  stats: {
    entityHits: number;
    relationshipHits: number;
    textUnitHits: number;
    communityReportHits: number;
  };
}

export interface RetrieveGraphRagSnapshotOptions {
  limit?: number;
}

function tokenize(value: string): string[] {
  return Array.from(new Set(
    value
      .toLowerCase()
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[@./:_-]+/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2)
  )).slice(0, 16);
}

function sourcePathsFromAttributes(attributes: unknown): string[] {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return [];
  }

  const record = attributes as Record<string, unknown>;
  const sourcePaths = Array.isArray(record.sourcePaths)
    ? record.sourcePaths.filter((value): value is string => typeof value === "string")
    : [];
  const evidenceFiles = Array.isArray(record.evidenceFiles)
    ? record.evidenceFiles.filter((value): value is string => typeof value === "string")
    : [];
  const sourcePath = typeof record.sourcePath === "string" ? [record.sourcePath] : [];
  return Array.from(new Set([...sourcePaths, ...evidenceFiles, ...sourcePath]));
}

function lexicalScore(tokens: readonly string[], text: string): number {
  if (tokens.length === 0) {
    return 0;
  }

  const normalized = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (normalized.includes(token)) {
      score += 1;
    }
  }

  return score / tokens.length;
}

function roundScore(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function entityHit(entity: Entity, score: number): GraphRagRetrievalHit {
  return {
    kind: "entity",
    id: entity.id,
    title: entity.title,
    score: roundScore(score),
    text: [entity.type, entity.description].filter(Boolean).join(" - "),
    sourcePaths: sourcePathsFromAttributes(entity.attributes),
    entityIds: [entity.id],
    relationshipIds: []
  };
}

function relationshipHit(relationship: Relationship, score: number): GraphRagRetrievalHit {
  return {
    kind: "relationship",
    id: relationship.id,
    title: `${relationship.source} -> ${relationship.target}`,
    score: roundScore(score),
    text: relationship.description ?? "",
    sourcePaths: sourcePathsFromAttributes(relationship.attributes),
    entityIds: [
      typeof relationship.attributes?.sourceEntityId === "string" ? relationship.attributes.sourceEntityId : relationship.source,
      typeof relationship.attributes?.targetEntityId === "string" ? relationship.attributes.targetEntityId : relationship.target
    ],
    relationshipIds: [relationship.id]
  };
}

function textUnitHit(textUnit: TextUnit, score: number): GraphRagRetrievalHit {
  return {
    kind: "text_unit",
    id: textUnit.id,
    title: textUnit.humanReadableId?.toString() ?? textUnit.id,
    score: roundScore(score),
    text: textUnit.text,
    sourcePaths: sourcePathsFromAttributes(textUnit.attributes),
    entityIds: textUnit.entityIds,
    relationshipIds: textUnit.relationshipIds
  };
}

function reportHit(report: CommunityReport, score: number): GraphRagRetrievalHit {
  return {
    kind: "community_report",
    id: report.id,
    title: report.title,
    score: roundScore(score),
    text: report.summary || report.fullContent,
    sourcePaths: [],
    entityIds: [],
    relationshipIds: []
  };
}

function buildContext(hits: readonly GraphRagRetrievalHit[]): string {
  return hits
    .slice(0, 8)
    .map((hit, index) => {
      const sources = hit.sourcePaths.length > 0 ? `\nSources: ${hit.sourcePaths.slice(0, 4).join(", ")}` : "";
      return `${index + 1}. [${hit.kind}] ${hit.title} (${hit.score})\n${hit.text}${sources}`;
    })
    .join("\n\n");
}

export function retrieveFromGraphRagSnapshot(
  snapshot: GraphRagSnapshot,
  query: string,
  options: RetrieveGraphRagSnapshotOptions = {}
): GraphRagRetrievalResult {
  const tokens = tokenize(query);
  const limit = Math.max(1, Math.min(options.limit ?? 12, 30));
  const entityHits = snapshot.entities
    .map((entity) => ({
      entity,
      score: lexicalScore(tokens, [
        entity.title,
        entity.type ?? "",
        entity.description ?? "",
        ...sourcePathsFromAttributes(entity.attributes)
      ].join(" "))
    }))
    .filter((entry) => entry.score > 0)
    .map((entry) => entityHit(entry.entity, entry.score * 1.12));
  const relationshipHits = snapshot.relationships
    .map((relationship) => ({
      relationship,
      score: lexicalScore(tokens, [
        relationship.source,
        relationship.target,
        relationship.description ?? ""
      ].join(" "))
    }))
    .filter((entry) => entry.score > 0)
    .map((entry) => relationshipHit(entry.relationship, entry.score));
  const textUnitHits = snapshot.textUnits
    .map((textUnit) => ({
      textUnit,
      score: lexicalScore(tokens, textUnit.text)
    }))
    .filter((entry) => entry.score > 0)
    .map((entry) => textUnitHit(entry.textUnit, entry.score * 1.2));
  const communityReportHits = snapshot.communityReports
    .map((report) => ({
      report,
      score: lexicalScore(tokens, [report.title, report.summary, report.fullContent].join(" "))
    }))
    .filter((entry) => entry.score > 0)
    .map((entry) => reportHit(entry.report, entry.score * 0.92));
  const hits = [...entityHits, ...relationshipHits, ...textUnitHits, ...communityReportHits]
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit);

  return {
    query,
    tokens,
    hits,
    context: buildContext(hits),
    stats: {
      entityHits: entityHits.length,
      relationshipHits: relationshipHits.length,
      textUnitHits: textUnitHits.length,
      communityReportHits: communityReportHits.length
    }
  };
}
