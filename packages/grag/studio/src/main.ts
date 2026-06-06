import "./styles.css";
import {
  buildDocumentGraphRagSnapshot,
  exampleSupportDocument,
} from "../../src/studio/document.js";

type JsonObject = Record<string, unknown>;

interface Entity {
  id: string;
  title: string;
  type?: string | null;
  description?: string | null;
  communityIds?: string[];
  textUnitIds?: string[];
  degree?: number | null;
  rank?: number | null;
  attributes?: JsonObject | null;
}

interface Relationship {
  id: string;
  source: string;
  target: string;
  description?: string | null;
  weight?: number | null;
  textUnitIds?: string[];
  attributes?: JsonObject | null;
}

interface TextUnit {
  id: string;
  humanReadableId?: string | number | null;
  text: string;
  entityIds?: string[];
  relationshipIds?: string[];
  attributes?: JsonObject | null;
}

interface Community {
  id: string;
  title: string;
  community: number;
  entityIds?: string[];
  relationshipIds?: string[];
  textUnitIds?: string[];
}

interface CommunityReport {
  id: string;
  title: string;
  community: number;
  summary?: string;
  fullContent?: string;
  rank?: number;
}

interface GraphRagSnapshot {
  documents: unknown[];
  textUnits: TextUnit[];
  entities: Entity[];
  relationships: Relationship[];
  covariates: unknown[];
  communities: Community[];
  communityReports: CommunityReport[];
  embeddings: unknown[];
}

interface GraphEntity extends Entity {
  type: string;
  description: string;
  sourcePaths: string[];
  communityId: string;
  communityTitle: string;
  degree: number;
  rank: number;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

interface GraphRelationship extends Relationship {
  sourceId: string;
  targetId: string;
  weight: number;
}

interface GraphCommunity {
  id: string;
  title: string;
  color: string;
  entityIds: string[];
  relationshipIds: string[];
  textUnitIds: string[];
  report: CommunityReport | null;
}

interface RetrievalHit {
  kind: string;
  id: string;
  title: string;
  score: number;
  text: string;
  sourcePaths: string[];
  entityIds: string[];
  relationshipIds: string[];
}

interface RetrievalResult {
  query: string;
  tokens: string[];
  hits: RetrievalHit[];
  context: string;
  stats: {
    entityHits: number;
    relationshipHits: number;
    textUnitHits: number;
    communityReportHits: number;
  };
}

interface StudioCapabilities {
  openaiEnabled: boolean;
  openaiModel: string;
  maxUploadBytes: number;
}

interface DocumentGraphUploadResponse {
  snapshot: GraphRagSnapshot;
  model?: string;
  suggestedQueries?: string[];
}

interface RepoGraphResponse {
  snapshot: GraphRagSnapshot;
  mode?: string;
  model?: string;
  answer?: string;
  stats?: JsonObject;
  selectedFiles?: Array<{
    path: string;
    kind: string;
    bytes: number;
  }>;
  retrieval?: RetrievalResult;
}

interface DocumentGraphUploadPayload {
  filename: string;
  mimeType: string;
  byteSize: number;
  text?: string;
  dataUrl?: string;
}

interface DbColumnPreview {
  name: string;
  kind: string;
  note: string;
}

interface DbTablePreview {
  name: string;
  group: "core" | "link";
  count: number;
  purpose: string;
  optimizedFor: string;
  retrievalUse: string;
  columns: DbColumnPreview[];
  rows: JsonObject[];
}

interface GraphModel {
  entities: GraphEntity[];
  relationships: GraphRelationship[];
  textUnits: TextUnit[];
  communities: GraphCommunity[];
  entityById: Map<string, GraphEntity>;
  communityById: Map<string, GraphCommunity>;
  textUnitById: Map<string, TextUnit>;
}

interface Layout {
  nodes: GraphEntity[];
  links: GraphRelationship[];
  byId: Map<string, GraphEntity>;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

type SnapshotSource = "sample" | "document" | "json" | "repo";

type DragState =
  | {
      kind: "pan";
      pointerId: number;
      last: Point;
      moved: boolean;
    }
  | {
      kind: "node";
      pointerId: number;
      nodeId: string;
      start: Point;
      moved: boolean;
    };

declare global {
  interface Window {
    __GRAG_SNAPSHOT__?: GraphRagSnapshot;
    __GRAG_STUDIO__?: {
      title?: string;
    };
  }
}

const palette = [
  "#8cc7ff",
  "#9be7b1",
  "#f3dc7a",
  "#e5a1c4",
  "#e88484",
  "#b9a7ff",
  "#85ddd4",
  "#e7b37a",
];
const MAX_FOCUSED_GRAPH_NODES = 96;
const MAX_FOCUSED_GRAPH_EDGES = 160;
const MAX_FULL_GRAPH_EDGES = 420;
const MAX_TEXT_UNIT_SEED_ENTITIES = 5;
const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("Missing #app root.");
}

const app = appRoot;
let snapshot: GraphRagSnapshot;
let baseSnapshot: GraphRagSnapshot;
let baseSourceTitle = "Built-in sample graph";
let graph: GraphModel;
let layout: Layout;
let retrieval: RetrievalResult | null = null;
let dragState: DragState | null = null;
let capabilities: StudioCapabilities = {
  openaiEnabled: false,
  openaiModel: "gpt-5.4-mini",
  maxUploadBytes: 50 * 1024 * 1024,
};
const pinnedPositions = new Map<string, Point>();
const state = {
  lens: "community" as "community" | "type",
  focus: false,
  filter: "",
  retrievalQuery:
    "How does this repository organize GraphRAG storage, retrieval, Studio, and repo import?",
  selectedId: null as string | null,
  selectedCommunity: null as string | null,
  selectedStorageTable: "grag_entities" as string | null,
  snapshotSource: "sample" as SnapshotSource,
  sourceTitle: "Repository knowledge graph sample",
  documentStatus: "Generate a graph from a GitHub repository, upload docs, or paste text.",
  view: {
    scale: 1,
    panX: 0,
    panY: 0,
  },
};

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const replacement: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacement[char] ?? char;
  });
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}...` : value;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function sourcePaths(attributes: JsonObject | null | undefined): string[] {
  if (!attributes) {
    return [];
  }

  const sourcePath = typeof attributes.sourcePath === "string" ? [attributes.sourcePath] : [];
  return Array.from(
    new Set([
      ...getStringArray(attributes.sourcePaths),
      ...getStringArray(attributes.evidenceFiles),
      ...sourcePath,
    ]),
  );
}

function colorFor(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length] ?? palette[0]!;
}

function tokens(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[@./:_-]+/g, " ")
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 2),
    ),
  );
}

function lexicalScore(queryTokens: string[], text: string): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  const haystack = text.toLowerCase();
  return queryTokens.filter((token) => haystack.includes(token)).length / queryTokens.length;
}

function titleToId(entities: Entity[]): Map<string, string> {
  return new Map(entities.map((entity) => [normalize(entity.title), entity.id]));
}

function looksLikeSnapshot(value: unknown): value is GraphRagSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.entities) &&
    Array.isArray(record.relationships) &&
    Array.isArray(record.textUnits)
  );
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function shortText(value: unknown, length = 120): string {
  return truncate(String(value ?? ""), length);
}

function rowValue(value: unknown): string | number | boolean | null {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

function rowFromRecord(record: JsonObject, keys: readonly string[]): JsonObject {
  return Object.fromEntries(keys.map((key) => [key, rowValue(record[key])]));
}

function sourceEntityId(relationship: GraphRelationship | Relationship): string {
  return typeof relationship.attributes?.sourceEntityId === "string"
    ? relationship.attributes.sourceEntityId
    : relationship.source;
}

function targetEntityId(relationship: GraphRelationship | Relationship): string {
  return typeof relationship.attributes?.targetEntityId === "string"
    ? relationship.attributes.targetEntityId
    : relationship.target;
}

function resetGraphView(): void {
  state.view.scale = 1;
  state.view.panX = 0;
  state.view.panY = 0;
}

function resetGraphFocus(): void {
  state.selectedId = null;
  state.selectedCommunity = null;
  state.selectedStorageTable = "grag_entities";
  retrieval = null;
  pinnedPositions.clear();
  resetGraphView();
}

function suggestedQueryFor(input: GraphRagSnapshot): string {
  const entityTitles = input.entities
    .slice()
    .sort(
      (left, right) =>
        Number(right.rank ?? right.degree ?? 0) - Number(left.rank ?? left.degree ?? 0),
    )
    .slice(0, 3)
    .map((entity) => entity.title);

  if (entityTitles.length >= 2) {
    return `How do ${entityTitles.slice(0, 2).join(" and ")} connect?`;
  }

  return entityTitles[0]
    ? `What does this document say about ${entityTitles[0]}?`
    : "What is this document about?";
}

async function activateSnapshot(
  nextSnapshot: GraphRagSnapshot,
  source: SnapshotSource,
  sourceTitle: string,
  nextQuery?: string,
): Promise<void> {
  snapshot = nextSnapshot;
  graph = buildGraph(snapshot);
  state.snapshotSource = source;
  state.sourceTitle = sourceTitle;
  state.retrievalQuery = nextQuery ?? suggestedQueryFor(snapshot);
  resetGraphFocus();
  const retrievalInput = document.querySelector<HTMLInputElement>("#retrieval-query");
  if (retrievalInput) {
    retrievalInput.value = state.retrievalQuery;
  }
  renderAll();
  await runRetrieval();
}

function buildGraph(input: GraphRagSnapshot): GraphModel {
  const rawTitleToId = titleToId(input.entities);
  const reportsByCommunity = new Map(
    input.communityReports.map((report) => [report.community, report]),
  );
  const communities: GraphCommunity[] = input.communities.map((community) => ({
    id: community.id,
    title: community.title,
    color: colorFor(community.title),
    entityIds: community.entityIds ?? [],
    relationshipIds: community.relationshipIds ?? [],
    textUnitIds: community.textUnitIds ?? [],
    report: reportsByCommunity.get(community.community) ?? null,
  }));
  const communityById = new Map(communities.map((community) => [community.id, community]));
  const communityIdByEntityId = new Map<string, string>();
  for (const community of communities) {
    for (const entityId of community.entityIds) {
      communityIdByEntityId.set(entityId, community.id);
    }
  }

  const relationships: GraphRelationship[] = input.relationships.flatMap((relationship) => {
    const sourceId =
      typeof relationship.attributes?.sourceEntityId === "string"
        ? relationship.attributes.sourceEntityId
        : rawTitleToId.get(normalize(relationship.source));
    const targetId =
      typeof relationship.attributes?.targetEntityId === "string"
        ? relationship.attributes.targetEntityId
        : rawTitleToId.get(normalize(relationship.target));

    if (!sourceId || !targetId) {
      return [];
    }

    return [
      {
        ...relationship,
        sourceId,
        targetId,
        weight: Number(relationship.weight ?? 1),
      },
    ];
  });
  const degreeById = new Map<string, number>();
  for (const relationship of relationships) {
    degreeById.set(relationship.sourceId, (degreeById.get(relationship.sourceId) ?? 0) + 1);
    degreeById.set(relationship.targetId, (degreeById.get(relationship.targetId) ?? 0) + 1);
  }
  const entities: GraphEntity[] = input.entities.map((entity) => {
    const communityId =
      communityIdByEntityId.get(entity.id) ?? entity.communityIds?.[0] ?? "community-unclustered";
    let community = communityById.get(communityId);
    if (!community) {
      community = {
        id: communityId,
        title: communityId.replace(/^community-/, ""),
        color: colorFor(communityId),
        entityIds: [entity.id],
        relationshipIds: [],
        textUnitIds: [],
        report: null,
      };
      communityById.set(communityId, community);
      communities.push(community);
    }

    return {
      ...entity,
      type: entity.type ?? "Entity",
      description: entity.description ?? "",
      sourcePaths: sourcePaths(entity.attributes),
      communityId,
      communityTitle: community.title,
      degree: Math.max(Number(entity.degree ?? 0), degreeById.get(entity.id) ?? 0),
      rank: Number(entity.rank ?? 1),
      color: community.color,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: 10,
    };
  });
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const textUnitById = new Map(input.textUnits.map((textUnit) => [textUnit.id, textUnit]));

  return {
    entities,
    relationships,
    textUnits: input.textUnits,
    communities,
    entityById,
    communityById,
    textUnitById,
  };
}

function buildDbTables(): DbTablePreview[] {
  const documents = snapshot.documents.map(asRecord);
  const covariates = snapshot.covariates.map(asRecord);
  const embeddings = snapshot.embeddings.map(asRecord);
  const documentTextUnits = documents.flatMap((document) =>
    getStringArray(document.textUnitIds).map((textUnitId, position) => ({
      document_id: rowValue(document.id),
      text_unit_id: textUnitId,
      position,
    })),
  );
  const textUnitEntities = graph.textUnits.flatMap((unit) =>
    (unit.entityIds ?? []).map((entityId, position) => ({
      text_unit_id: unit.id,
      entity_id: entityId,
      position,
    })),
  );
  const textUnitRelationships = graph.textUnits.flatMap((unit) =>
    (unit.relationshipIds ?? []).map((relationshipId, position) => ({
      text_unit_id: unit.id,
      relationship_id: relationshipId,
      position,
    })),
  );
  const entityCommunities = graph.entities.flatMap((entity) =>
    (entity.communityIds ?? [entity.communityId]).map((communityId, position) => ({
      entity_id: entity.id,
      community_id: communityId,
      position,
    })),
  );
  const entityTextUnits = graph.entities.flatMap((entity) =>
    (entity.textUnitIds ?? []).map((textUnitId, position) => ({
      entity_id: entity.id,
      text_unit_id: textUnitId,
      position,
    })),
  );
  const relationshipTextUnits = graph.relationships.flatMap((relationship) =>
    (relationship.textUnitIds ?? []).map((textUnitId, position) => ({
      relationship_id: relationship.id,
      text_unit_id: textUnitId,
      position,
    })),
  );
  const communityEntities = graph.communities.flatMap((community) =>
    community.entityIds.map((entityId, position) => ({
      community_id: community.id,
      entity_id: entityId,
      position,
    })),
  );
  const communityRelationships = graph.communities.flatMap((community) =>
    community.relationshipIds.map((relationshipId, position) => ({
      community_id: community.id,
      relationship_id: relationshipId,
      position,
    })),
  );
  const communityTextUnits = graph.communities.flatMap((community) =>
    community.textUnitIds.map((textUnitId, position) => ({
      community_id: community.id,
      text_unit_id: textUnitId,
      position,
    })),
  );

  return [
    dbTable(
      "grag_documents",
      "core",
      documents.length,
      "Raw source documents plus metadata and source paths.",
      "Source reconstruction, citation display, incremental reindexing by document.",
      "Retrieval uses document ids and source metadata to cite where graph evidence came from.",
      [
        ["id", "TEXT PK", "Stable document id"],
        ["title", "TEXT", "Human-readable document name"],
        ["type", "TEXT", "File/source kind"],
        ["text", "TEXT", "Original or extracted text"],
        ["attributes_json", "JSON text", "Source path, extractor, run metadata"],
      ],
      documents.map((document) =>
        rowFromRecord(document, ["id", "title", "type", "text", "attributes"]),
      ),
    ),
    dbTable(
      "grag_text_units",
      "core",
      graph.textUnits.length,
      "Chunked grounding units used for local context and citations.",
      "Fast lexical/vector recall, bounded context windows, source-grounded answers.",
      "Basic/local retrieval scores these rows first, then follows links to entities and relationships.",
      [
        ["id", "TEXT PK", "Stable text chunk id"],
        ["text", "TEXT", "Grounding chunk"],
        ["document_id", "TEXT", "Parent document"],
        ["n_tokens", "INTEGER", "Approximate token size"],
        ["attributes_json", "JSON text", "Source path and chunk metadata"],
      ],
      graph.textUnits.map((unit) => ({
        id: unit.id,
        text: shortText(unit.text),
        document_id: rowValue((unit as TextUnit & { documentId?: string | null }).documentId),
        n_tokens: rowValue((unit as TextUnit & { nTokens?: number | null }).nTokens),
        attributes_json: rowValue(unit.attributes),
      })),
    ),
    dbTable(
      "grag_entities",
      "core",
      graph.entities.length,
      "Named concepts extracted from documents.",
      "Entity lookup, neighborhood expansion, explainable graph navigation.",
      "Local retrieval scores titles/descriptions, then expands through entity relationships and text-unit links.",
      [
        ["id", "TEXT PK", "Stable entity id"],
        ["title", "TEXT indexed", "Entity name"],
        ["type", "TEXT", "Package, Storage, Retrieval, etc."],
        ["description", "TEXT", "Grounded summary"],
        ["degree", "INTEGER", "Graph connectivity"],
        ["rank", "DOUBLE", "Importance score"],
      ],
      graph.entities.map((entity) => ({
        id: entity.id,
        title: entity.title,
        type: entity.type,
        description: shortText(entity.description),
        degree: entity.degree,
        rank: entity.rank,
      })),
    ),
    dbTable(
      "grag_relationships",
      "core",
      graph.relationships.length,
      "Edges between extracted entities.",
      "Graph expansion, causality/dependency traversal, support impact analysis.",
      "Retrieval follows these edges from seed entities to pull nearby evidence and show why results connect.",
      [
        ["id", "TEXT PK", "Stable relationship id"],
        ["source", "TEXT indexed", "Source entity title"],
        ["target", "TEXT indexed", "Target entity title"],
        ["description", "TEXT", "Grounded edge explanation"],
        ["weight", "DOUBLE", "Relationship strength"],
        ["attributes_json", "JSON text", "Entity ids/source metadata"],
      ],
      graph.relationships.map((relationship) => ({
        id: relationship.id,
        source: relationship.source,
        target: relationship.target,
        description: shortText(relationship.description),
        weight: relationship.weight,
        attributes_json: rowValue(relationship.attributes),
      })),
    ),
    dbTable(
      "grag_covariates",
      "core",
      covariates.length,
      "Claims, facts, or time-bound attributes attached to graph subjects.",
      "Temporal filters, claim verification, incident/status tracking.",
      "Advanced retrieval can filter or cite claims about an entity without mixing them into the entity record.",
      [
        ["id", "TEXT PK", "Stable covariate id"],
        ["covariate_type", "TEXT", "claim/status/etc."],
        ["subject_id", "TEXT indexed", "Entity/document subject"],
        ["status", "TEXT", "TRUE/FALSE/SUSPECTED or custom"],
        ["source_text", "TEXT", "Grounding quote"],
      ],
      covariates.map((covariate) =>
        rowFromRecord(covariate, ["id", "covariateType", "subjectId", "status", "sourceText"]),
      ),
    ),
    dbTable(
      "grag_communities",
      "core",
      graph.communities.length,
      "Cluster records for groups of entities/relationships.",
      "Global search, topic summaries, high-level navigation.",
      "Global retrieval groups community reports by level/rank instead of scanning every chunk.",
      [
        ["id", "TEXT PK", "Stable community id"],
        ["community", "INTEGER indexed", "Community number"],
        ["level", "INTEGER indexed", "Hierarchy level"],
        ["title", "TEXT", "Cluster label"],
        ["size", "INTEGER", "Entity count"],
      ],
      graph.communities.map((community) => ({
        id: community.id,
        community: rowValue(community.report?.community ?? ""),
        level: rowValue(community.report?.rank === undefined ? 0 : 0),
        title: community.title,
        size: community.entityIds.length,
      })),
    ),
    dbTable(
      "grag_community_reports",
      "core",
      snapshot.communityReports.length,
      "LLM/generated summaries of each community.",
      "Fast global answers, map-reduce summarization, analyst review.",
      "Global search loads these first, chunks them, maps over reports, then reduces partial answers.",
      [
        ["id", "TEXT PK", "Stable report id"],
        ["community", "INTEGER indexed", "Community number"],
        ["title", "TEXT", "Report label"],
        ["summary", "TEXT", "Short summary"],
        ["full_content", "TEXT", "Detailed report"],
        ["rank", "DOUBLE indexed", "Report priority"],
      ],
      snapshot.communityReports.map((report) => ({
        id: report.id,
        community: report.community,
        title: report.title,
        summary: shortText(report.summary),
        full_content: shortText(report.fullContent),
        rank: rowValue(report.rank),
      })),
    ),
    dbTable(
      "grag_embeddings",
      "core",
      embeddings.length,
      "Vector records for documents, chunks, entities, relationships, or reports.",
      "Vector recall, pgvector/HNSW indexes, hybrid search.",
      "Basic search can load text_unit embeddings and compare them to the query vector before graph expansion.",
      [
        ["id", "TEXT PK", "Stable embedding id"],
        ["target_kind", "TEXT indexed", "document/text_unit/entity/etc."],
        ["target_id", "TEXT indexed", "Record being embedded"],
        ["vector_json", "JSON/vector", "Portable vector payload"],
        ["model", "TEXT indexed", "Embedding model"],
      ],
      embeddings.map((embedding) =>
        rowFromRecord(embedding, ["id", "targetKind", "targetId", "model", "dimensions", "text"]),
      ),
    ),
    dbTable(
      "grag_document_text_units",
      "link",
      documentTextUnits.length,
      "Ordered document-to-chunk links.",
      "Reconstructing document context and citation order.",
      "Lets retrieval climb from a hit chunk back to its source document.",
      linkColumns("document_id", "text_unit_id"),
      documentTextUnits,
    ),
    dbTable(
      "grag_text_unit_entities",
      "link",
      textUnitEntities.length,
      "Which entities appear in each text unit.",
      "Grounded entity evidence and chunk-to-graph joins.",
      "When a chunk hits, retrieval can highlight entities mentioned in it.",
      linkColumns("text_unit_id", "entity_id"),
      textUnitEntities,
    ),
    dbTable(
      "grag_text_unit_relationships",
      "link",
      textUnitRelationships.length,
      "Which relationships are grounded by each text unit.",
      "Edge citations and explainable relationships.",
      "When an edge is retrieved, the UI can show the exact grounding chunk.",
      linkColumns("text_unit_id", "relationship_id"),
      textUnitRelationships,
    ),
    dbTable(
      "grag_entity_communities",
      "link",
      entityCommunities.length,
      "Entity membership in one or more communities.",
      "Community filtering and global search grouping.",
      "Lets global retrieval connect a selected entity to its report community.",
      linkColumns("entity_id", "community_id"),
      entityCommunities,
    ),
    dbTable(
      "grag_entity_text_units",
      "link",
      entityTextUnits.length,
      "Entity-to-grounding-chunk links.",
      "Entity inspector sources and local context building.",
      "Local retrieval pulls source chunks for matching entities.",
      linkColumns("entity_id", "text_unit_id"),
      entityTextUnits,
    ),
    dbTable(
      "grag_relationship_text_units",
      "link",
      relationshipTextUnits.length,
      "Relationship-to-grounding-chunk links.",
      "Relationship citations and edge confidence.",
      "Relationship hits cite the text units that justify the edge.",
      linkColumns("relationship_id", "text_unit_id"),
      relationshipTextUnits,
    ),
    dbTable(
      "grag_community_entities",
      "link",
      communityEntities.length,
      "Community-to-entity membership.",
      "Cluster rendering and community summaries.",
      "The Studio and global search use this to traverse from a report to member entities.",
      linkColumns("community_id", "entity_id"),
      communityEntities,
    ),
    dbTable(
      "grag_community_relationships",
      "link",
      communityRelationships.length,
      "Community-to-edge membership.",
      "Cluster edge summarization and local neighborhood views.",
      "Used to show the important relationships inside a selected community.",
      linkColumns("community_id", "relationship_id"),
      communityRelationships,
    ),
    dbTable(
      "grag_community_text_units",
      "link",
      communityTextUnits.length,
      "Community-to-grounding-chunk membership.",
      "Community report source grounding.",
      "Global retrieval can cite chunks that support a report.",
      linkColumns("community_id", "text_unit_id"),
      communityTextUnits,
    ),
  ];
}

function dbTable(
  name: string,
  group: "core" | "link",
  count: number,
  purpose: string,
  optimizedFor: string,
  retrievalUse: string,
  columns: readonly (readonly [string, string, string])[],
  rows: JsonObject[],
): DbTablePreview {
  return {
    name,
    group,
    count,
    purpose,
    optimizedFor,
    retrievalUse,
    columns: columns.map(([columnName, kind, note]) => ({
      name: columnName,
      kind,
      note,
    })),
    rows,
  };
}

function linkColumns(left: string, right: string): readonly (readonly [string, string, string])[] {
  return [
    [left, "TEXT indexed", "Owner/source id"],
    [right, "TEXT indexed", "Linked target id"],
    ["position", "INTEGER", "Stable order"],
  ];
}

function renderShell(): void {
  app.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="brand">
          <div class="mark" aria-hidden="true">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M6 7h12M6 17h12M7 7v10M17 7v10M12 4v4M12 16v4" stroke="currentColor" stroke-width="1.5"/><circle cx="6" cy="7" r="2" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="7" r="2" stroke="currentColor" stroke-width="1.5"/><circle cx="6" cy="17" r="2" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="17" r="2" stroke="currentColor" stroke-width="1.5"/></svg>
          </div>
          <div>
            <p class="eyebrow">GraphRAG</p>
            <h1>Studio</h1>
          </div>
        </div>
        <p class="sub">A built-in CLI Studio for inspecting graph snapshots and testing retrieval.</p>
        <div class="section repo-panel">
          <div class="section-head">
            <h2>GitHub Repo</h2>
            <span class="source-badge">Local by default</span>
          </div>
          <form class="repo-tools" id="repo-form">
            <input id="repo-url" value="https://github.com/microsoft/graphrag" autocomplete="off" aria-label="GitHub repository URL" />
            <input id="repo-question" value="Generate a repository knowledge graph: packages, modules, storage, retrieval, APIs, docs, and workflows." autocomplete="off" aria-label="Repository question" />
            <label class="repo-option">
              <input id="repo-openai" type="checkbox" />
              <span>OpenAI extraction</span>
            </label>
            <button id="repo-build" class="primary" type="submit">Generate repo graph</button>
          </form>
        </div>
        <div class="section document-panel">
          <div class="section-head">
            <h2>Document</h2>
            <span class="source-badge" id="source-badge">${esc(state.sourceTitle)}</span>
          </div>
          <div class="document-tools">
            <label class="file-picker">
              <input id="document-file" type="file" accept=".txt,.md,.json,.csv,.html,.xml,.pdf,.doc,.docx,.ppt,.pptx,image/*,text/*,application/json,application/pdf" />
              <span>Upload</span>
            </label>
            <button id="document-example" class="toggle" type="button">Example</button>
            <textarea id="document-text" rows="6" placeholder="Paste a doc, support runbook, ticket export, or markdown page"></textarea>
            <button id="document-build" class="primary" type="button">Build document graph</button>
            <button id="sample-reset" class="toggle" type="button">Reset sample graph</button>
            <p class="document-status" id="document-status">${esc(state.documentStatus)}</p>
          </div>
        </div>
        <div class="metrics" id="metrics"></div>
        <div class="controls">
          <input id="filter" placeholder="Filter graph" autocomplete="off" />
          <div class="seg" role="group" aria-label="Graph lens">
            <button id="lens-community" class="active" type="button">Community</button>
            <button id="lens-type" type="button">Type</button>
          </div>
          <button id="focus" class="toggle" type="button">Focus selected neighborhood</button>
        </div>
        <div class="section">
          <div class="section-head">
            <h2>Communities</h2>
            <span class="community-count">${graph.communities.length}</span>
          </div>
          <div class="list" id="communities"></div>
        </div>
        <div class="section">
          <div class="section-head">
            <h2>Database Store</h2>
            <span class="community-count" id="table-count">0</span>
          </div>
          <p class="sub">The active snapshot as normalized SQL or @farming-labs/orm tables.</p>
          <div class="list storage-list" id="storage-tables"></div>
        </div>
        <div class="section">
          <h2>Retrieval</h2>
          <form class="retrieval-form" id="retrieval-form">
            <input id="retrieval-query" value="${esc(state.retrievalQuery)}" autocomplete="off" />
            <button class="primary" type="submit">Run retrieval</button>
          </form>
          <div class="list" id="retrieval-results"></div>
        </div>
      </aside>
      <main class="stage">
        <header class="stage-head">
          <div>
            <p class="eyebrow">Preview</p>
            <h1 id="stage-title">${esc(window.__GRAG_STUDIO__?.title ?? "GraphRAG Studio")}</h1>
          </div>
          <div class="stage-actions" aria-label="Graph controls">
            <button id="zoom-out" class="icon-button" type="button" title="Zoom out" aria-label="Zoom out">-</button>
            <button id="zoom-in" class="icon-button" type="button" title="Zoom in" aria-label="Zoom in">+</button>
            <button id="reset-view" class="icon-button" type="button" title="Reset view" aria-label="Reset view">1:1</button>
            <button id="reflow" class="icon-button" type="button" title="Reflow graph" aria-label="Reflow graph">R</button>
          </div>
          <div class="legend" id="legend"></div>
        </header>
        <div class="graph-shell">
          <svg id="graph" role="img" aria-label="GraphRAG Studio graph"></svg>
          <div class="watermark">GRAG STUDIO</div>
        </div>
      </main>
      <aside class="inspector">
        <p class="eyebrow">Inspector</p>
        <div id="inspector"></div>
      </aside>
    </div>
  `;
  bindEvents();
}

function bindEvents(): void {
  document
    .querySelector<HTMLInputElement>("#document-file")
    ?.addEventListener("change", (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      void loadDocumentFile(file).finally(() => {
        input.value = "";
      });
    });
  document.querySelector<HTMLButtonElement>("#document-example")?.addEventListener("click", () => {
    const textarea = document.querySelector<HTMLTextAreaElement>("#document-text");
    if (textarea) {
      textarea.value = exampleSupportDocument();
    }
    void buildDocumentGraphFromText("Support GraphRAG Playbook", "example/support-playbook.md");
  });
  document.querySelector<HTMLButtonElement>("#document-build")?.addEventListener("click", () => {
    const textarea = document.querySelector<HTMLTextAreaElement>("#document-text");
    void buildDocumentGraphFromText("Pasted document", "pasted-document.md", textarea?.value ?? "");
  });
  document
    .querySelector<HTMLTextAreaElement>("#document-text")
    ?.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        const textarea = event.currentTarget as HTMLTextAreaElement;
        void buildDocumentGraphFromText("Pasted document", "pasted-document.md", textarea.value);
      }
    });
  document.querySelector<HTMLButtonElement>("#sample-reset")?.addEventListener("click", () => {
    void activateSnapshot(
      baseSnapshot,
      "sample",
      baseSourceTitle,
      "How does this repository organize GraphRAG storage, retrieval, Studio, and repo import?",
    );
  });
  document.querySelector<HTMLFormElement>("#repo-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const repoInput = document.querySelector<HTMLInputElement>("#repo-url");
    const questionInput = document.querySelector<HTMLInputElement>("#repo-question");
    void buildRepositoryGraph(repoInput?.value ?? "", questionInput?.value ?? "");
  });
  document.querySelector<HTMLButtonElement>("#lens-community")?.addEventListener("click", () => {
    state.lens = "community";
    document.querySelector("#lens-community")?.classList.add("active");
    document.querySelector("#lens-type")?.classList.remove("active");
    renderAll();
  });
  document.querySelector<HTMLButtonElement>("#lens-type")?.addEventListener("click", () => {
    state.lens = "type";
    document.querySelector("#lens-type")?.classList.add("active");
    document.querySelector("#lens-community")?.classList.remove("active");
    renderAll();
  });
  document.querySelector<HTMLButtonElement>("#focus")?.addEventListener("click", () => {
    state.focus = !state.focus;
    document.querySelector("#focus")?.classList.toggle("active", state.focus);
    renderAll();
  });
  document.querySelector<HTMLInputElement>("#filter")?.addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    state.filter = input.value.trim();
    renderAll();
  });
  document
    .querySelector<HTMLFormElement>("#retrieval-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.querySelector<HTMLInputElement>("#retrieval-query");
      state.retrievalQuery = input?.value.trim() || "";
      void runRetrieval();
    });
  document.querySelector<HTMLButtonElement>("#zoom-in")?.addEventListener("click", () => {
    zoomAt(1.18);
  });
  document.querySelector<HTMLButtonElement>("#zoom-out")?.addEventListener("click", () => {
    zoomAt(1 / 1.18);
  });
  document.querySelector<HTMLButtonElement>("#reset-view")?.addEventListener("click", () => {
    resetGraphView();
    renderGraph();
  });
  document.querySelector<HTMLButtonElement>("#reflow")?.addEventListener("click", () => {
    pinnedPositions.clear();
    renderAll();
  });
  const svg = document.querySelector<SVGSVGElement>("#graph");
  svg?.addEventListener("wheel", handleGraphWheel, { passive: false });
  svg?.addEventListener("pointerdown", handleGraphPointerDown);
  svg?.addEventListener("pointermove", handleGraphPointerMove);
  svg?.addEventListener("pointerup", handleGraphPointerUp);
  svg?.addEventListener("pointercancel", handleGraphPointerUp);
}

async function loadDocumentFile(file: File): Promise<void> {
  setDocumentStatus(`Reading ${file.name}...`);
  if (file.size > capabilities.maxUploadBytes) {
    setDocumentStatus(
      `File is too large. Max upload is ${Math.round(capabilities.maxUploadBytes / 1024 / 1024)}MB.`,
    );
    return;
  }

  const textLike = isTextLikeFile(file);
  const raw = textLike ? await file.text() : "";
  const textarea = document.querySelector<HTMLTextAreaElement>("#document-text");
  if (textarea && raw) {
    textarea.value = raw.slice(0, 20_000);
  }

  const isJson = file.name.toLowerCase().endsWith(".json") || file.type.includes("json");
  if (isJson && raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (looksLikeSnapshot(parsed)) {
        await activateSnapshot(parsed, "json", file.name, suggestedQueryFor(parsed));
        setDocumentStatus("Loaded GraphRAG JSON snapshot.");
        return;
      }
    } catch {
      // Fall through to document extraction so pasted/exported text still works.
    }
  }

  if (capabilities.openaiEnabled) {
    try {
      setDocumentStatus(`OpenAI is extracting graph from ${file.name}...`);
      const result = await uploadDocumentGraph(file, raw || undefined);
      const query = result.suggestedQueries?.[0] ?? suggestedQueryFor(result.snapshot);
      await activateSnapshot(result.snapshot, "document", file.name, query);
      setDocumentStatus(
        `OpenAI extracted ${result.snapshot.entities.length} entities with ${result.model ?? capabilities.openaiModel}.`,
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!textLike) {
        setDocumentStatus(message);
        return;
      }
      setDocumentStatus(`${message} Falling back to local text extraction.`);
    }
  }

  if (!textLike) {
    setDocumentStatus(
      "This file type needs OPENAI_API_KEY on the Studio server. Text, Markdown, JSON, CSV, HTML, XML, and code files work locally.",
    );
    return;
  }

  await buildDocumentGraphFromText(file.name, file.name, raw);
}

async function buildDocumentGraphFromText(
  title: string,
  sourcePath: string,
  providedText?: string,
): Promise<void> {
  const textarea = document.querySelector<HTMLTextAreaElement>("#document-text");
  const raw = (providedText ?? textarea?.value ?? "").trim();
  if (!raw) {
    setDocumentStatus("Waiting for document");
    return;
  }

  const nextSnapshot = buildDocumentGraphRagSnapshot(raw, {
    title,
    sourcePath,
  }) as unknown as GraphRagSnapshot;
  await activateSnapshot(nextSnapshot, "document", title, suggestedQueryFor(nextSnapshot));
  setDocumentStatus(`Built local graph with ${nextSnapshot.entities.length} entities.`);
}

function setDocumentStatus(value: string): void {
  state.documentStatus = value;
  const target = document.querySelector<HTMLParagraphElement>("#document-status");
  if (target) {
    target.textContent = value;
  }
}

function isTextLikeFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("text/") ||
    file.type.includes("json") ||
    [
      ".txt",
      ".md",
      ".mdx",
      ".json",
      ".csv",
      ".tsv",
      ".html",
      ".htm",
      ".xml",
      ".yaml",
      ".yml",
      ".log",
      ".js",
      ".ts",
      ".tsx",
      ".jsx",
      ".css",
      ".sql",
      ".py",
      ".rb",
      ".go",
      ".rs",
      ".java",
      ".c",
      ".cpp",
      ".h",
    ].some((extension) => name.endsWith(extension))
  );
}

async function uploadDocumentGraph(
  file: File,
  rawText?: string,
): Promise<DocumentGraphUploadResponse> {
  const payload = await createUploadPayload(file, rawText);
  const response = await fetch("/document-graph.json", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(errorMessageFromResponse(body));
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !looksLikeSnapshot((body as Record<string, unknown>).snapshot)
  ) {
    throw new Error("The document graph response did not include a snapshot.");
  }

  const record = body as Record<string, unknown>;
  return {
    snapshot: record.snapshot as GraphRagSnapshot,
    ...(typeof record.model === "string" ? { model: record.model } : {}),
    ...(Array.isArray(record.suggestedQueries)
      ? {
          suggestedQueries: record.suggestedQueries.filter(
            (value): value is string => typeof value === "string",
          ),
        }
      : {}),
  };
}

async function buildRepositoryGraph(repo: string, query: string): Promise<void> {
  const cleanRepo = repo.trim();
  const cleanQuery =
    query.trim() ||
    "What are the important packages, plugins, storage surfaces, and auth flows in this repository?";
  const button = document.querySelector<HTMLButtonElement>("#repo-build");
  const useOpenAI = document.querySelector<HTMLInputElement>("#repo-openai")?.checked === true;
  if (!cleanRepo) {
    setDocumentStatus("Enter a GitHub repository URL or owner/name pair.");
    return;
  }

  button?.setAttribute("disabled", "true");
  setDocumentStatus(
    `Cloning and indexing ${cleanRepo}${useOpenAI ? " with OpenAI extraction" : " with local extraction"}...`,
  );
  try {
    const result = await uploadRepositoryGraph(cleanRepo, cleanQuery, useOpenAI);
    const title = cleanRepo.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
    await activateSnapshot(result.snapshot, "repo", title, cleanQuery);
    const fileCount = result.selectedFiles?.length ?? 0;
    const mode = result.mode
      ? ` using ${result.mode}${result.model ? ` (${result.model})` : ""}`
      : "";
    setDocumentStatus(
      `Generated repo graph from ${fileCount} files${mode}: ${result.snapshot.entities.length} entities, ${result.snapshot.relationships.length} relationships.`,
    );
    if (result.answer) {
      retrieval = result.retrieval ?? retrieval;
      renderRetrieval();
    }
  } catch (error) {
    setDocumentStatus(error instanceof Error ? error.message : String(error));
  } finally {
    button?.removeAttribute("disabled");
  }
}

async function uploadRepositoryGraph(
  repo: string,
  query: string,
  useOpenAI: boolean,
): Promise<RepoGraphResponse> {
  const response = await fetch("/repo-graph.json", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      repo,
      query,
      useOpenAI,
      maxFiles: 12,
      maxCorpusChars: 60_000,
    }),
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(errorMessageFromResponse(body).replace("Document graph", "Repository graph"));
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !looksLikeSnapshot((body as Record<string, unknown>).snapshot)
  ) {
    throw new Error("The repository graph response did not include a snapshot.");
  }

  const record = body as Record<string, unknown>;
  return {
    snapshot: record.snapshot as GraphRagSnapshot,
    ...(typeof record.mode === "string" ? { mode: record.mode } : {}),
    ...(typeof record.model === "string" ? { model: record.model } : {}),
    ...(typeof record.answer === "string" ? { answer: record.answer } : {}),
    ...(record.stats && typeof record.stats === "object" && !Array.isArray(record.stats)
      ? { stats: record.stats as JsonObject }
      : {}),
    ...(Array.isArray(record.selectedFiles)
      ? {
          selectedFiles: record.selectedFiles.filter(
            (entry): entry is { path: string; kind: string; bytes: number } =>
              Boolean(entry) &&
              typeof entry === "object" &&
              !Array.isArray(entry) &&
              typeof (entry as Record<string, unknown>).path === "string" &&
              typeof (entry as Record<string, unknown>).kind === "string" &&
              typeof (entry as Record<string, unknown>).bytes === "number",
          ),
        }
      : {}),
    ...(record.retrieval && typeof record.retrieval === "object" && !Array.isArray(record.retrieval)
      ? { retrieval: record.retrieval as RetrievalResult }
      : {}),
  };
}

async function createUploadPayload(
  file: File,
  rawText?: string,
): Promise<DocumentGraphUploadPayload> {
  const mimeType = file.type || guessMimeType(file.name);
  const text = rawText?.trim();
  if (text) {
    return {
      filename: file.name,
      mimeType,
      byteSize: file.size,
      text,
    };
  }

  return {
    filename: file.name,
    mimeType,
    byteSize: file.size,
    dataUrl: await fileToDataUrl(file, mimeType),
  };
}

async function fileToDataUrl(file: File, mimeType: string): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function guessMimeType(filename: string): string {
  const name = filename.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".csv")) return "text/csv";
  if (name.endsWith(".md") || name.endsWith(".mdx")) return "text/markdown";
  if (name.endsWith(".html") || name.endsWith(".htm")) return "text/html";
  if (name.endsWith(".xml")) return "text/xml";
  return "application/octet-stream";
}

function errorMessageFromResponse(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const error = (value as Record<string, unknown>).error;
    if (typeof error === "string") {
      return error;
    }
  }

  return "Document graph extraction failed.";
}

function renderSourceState(): void {
  const badge = document.querySelector<HTMLSpanElement>("#source-badge");
  if (badge) {
    const prefix =
      state.snapshotSource === "document"
        ? "Document"
        : state.snapshotSource === "json"
          ? "Snapshot"
          : state.snapshotSource === "repo"
            ? "Repository"
            : "Sample";
    badge.textContent = `${prefix}: ${state.sourceTitle}`;
  }
  const title = document.querySelector<HTMLHeadingElement>("#stage-title");
  if (title) {
    title.textContent = state.sourceTitle;
  }
  const status = document.querySelector<HTMLParagraphElement>("#document-status");
  if (status) {
    status.textContent = state.documentStatus;
  }
}

function renderMetrics(): void {
  const metrics = [
    ["Entities", graph.entities.length],
    ["Links", graph.relationships.length],
    ["Communities", graph.communities.length],
    ["Text Units", graph.textUnits.length],
  ];
  const target = document.querySelector<HTMLDivElement>("#metrics");
  if (!target) return;
  target.innerHTML = metrics
    .map(
      ([label, value]) =>
        `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`,
    )
    .join("");
}

function groupFor(entity: GraphEntity): string {
  return state.lens === "type" ? entity.type : entity.communityTitle;
}

function entityMatchesFilter(entity: GraphEntity): boolean {
  const queryTokens = tokens(state.filter);
  if (queryTokens.length === 0) return false;
  return (
    lexicalScore(
      queryTokens,
      [
        entity.title,
        entity.type,
        entity.description,
        entity.communityTitle,
        ...entity.sourcePaths,
      ].join(" "),
    ) > 0
  );
}

function retrievalEntityIds(): Set<string> {
  const ids = new Set<string>();
  const queryTokens = tokens(retrieval?.query ?? state.retrievalQuery);
  for (const hit of retrieval?.hits ?? []) {
    if (hit.kind === "text_unit") {
      for (const entityId of rankedTextUnitHitEntities(hit, queryTokens)) {
        ids.add(entityId);
      }
    } else {
      for (const entityId of hit.entityIds) ids.add(entityId);
    }
    for (const relationshipId of hit.relationshipIds) {
      const relationship = graph.relationships.find((item) => item.id === relationshipId);
      if (relationship) {
        ids.add(relationship.sourceId);
        ids.add(relationship.targetId);
      }
    }
  }
  return ids;
}

function rankedTextUnitHitEntities(hit: RetrievalHit, queryTokens: string[]): string[] {
  const hitSourcePaths = new Set(hit.sourcePaths);
  return hit.entityIds
    .flatMap((entityId) => {
      const entity = graph.entityById.get(entityId);
      if (!entity) {
        return [];
      }
      const sourceMatch = entity.sourcePaths.some((path) => hitSourcePaths.has(path)) ? 2.2 : 0;
      const lexical = lexicalScore(
        queryTokens,
        [
          entity.title,
          entity.type,
          entity.description,
          entity.communityTitle,
          ...entity.sourcePaths,
        ].join(" "),
      );
      const typeBoost =
        entity.type.includes("File") ||
        entity.type.includes("Package") ||
        entity.type.includes("Storage")
          ? 0.8
          : 0;
      return [
        {
          id: entity.id,
          score:
            lexical * 12 + sourceMatch + typeBoost + entity.rank * 0.08 + entity.degree * 0.025,
        },
      ];
    })
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, MAX_TEXT_UNIT_SEED_ENTITIES)
    .map((entry) => entry.id);
}

function visibleSeeds(): Set<string> {
  const ids = retrievalEntityIds();
  if (state.selectedId) ids.add(state.selectedId);
  for (const entity of graph.entities) {
    if (entityMatchesFilter(entity)) ids.add(entity.id);
    if (state.selectedCommunity && entity.communityId === state.selectedCommunity)
      ids.add(entity.id);
  }
  return ids;
}

function visibleIds(): Set<string> {
  const seeds = visibleSeeds();
  if (!state.focus || seeds.size === 0) {
    return new Set(graph.entities.map((entity) => entity.id));
  }

  const scores = new Map<string, number>();
  const addScore = (entityId: string, score: number) => {
    scores.set(entityId, Math.max(scores.get(entityId) ?? 0, score));
  };
  for (const seed of seeds) {
    const entity = graph.entityById.get(seed);
    addScore(seed, 100 + Number(entity?.rank ?? 0));
  }
  for (const relationship of graph.relationships) {
    if (seeds.has(relationship.sourceId) || seeds.has(relationship.targetId)) {
      const source = graph.entityById.get(relationship.sourceId);
      const target = graph.entityById.get(relationship.targetId);
      addScore(
        relationship.sourceId,
        18 + relationship.weight * 2 + Number(source?.rank ?? 0) * 0.22,
      );
      addScore(
        relationship.targetId,
        18 + relationship.weight * 2 + Number(target?.rank ?? 0) * 0.22,
      );
    }
  }
  const limit =
    state.selectedCommunity || state.filter
      ? MAX_FOCUSED_GRAPH_NODES + 48
      : MAX_FOCUSED_GRAPH_NODES;
  return new Set(
    Array.from(scores.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([entityId]) => entityId),
  );
}

function computeLayout(): void {
  const svg = document.querySelector<SVGSVGElement>("#graph");
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const visibleCount = visibleIds().size || graph.entities.length;
  const width = Math.max(1180, rect.width || 960, Math.min(1800, 780 + visibleCount * 9));
  const height = Math.max(820, rect.height || 640, Math.min(1400, 620 + visibleCount * 7));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const ids = visibleIds();
  const nodes = graph.entities
    .filter((entity) => ids.has(entity.id))
    .map((entity) => ({ ...entity }));
  const groups = Array.from(new Set(nodes.map(groupFor))).sort((left, right) =>
    left.localeCompare(right),
  );
  const centers = new Map<string, { x: number; y: number }>();
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(250, Math.min(width, height) * 0.38);
  groups.forEach((group, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, groups.length) - Math.PI / 2;
    centers.set(group, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });

  nodes.forEach((node, index) => {
    const center = centers.get(groupFor(node)) ?? { x: centerX, y: centerY };
    const angle = index * 2.3999632297;
    node.x = center.x + Math.cos(angle) * 92;
    node.y = center.y + Math.sin(angle) * 92;
    node.vx = 0;
    node.vy = 0;
    node.r = Math.max(
      8,
      Math.min(23, 8 + Math.sqrt(node.degree || 1) * 2.8 + Math.sqrt(node.rank || 1) * 0.8),
    );
    node.color =
      state.lens === "type"
        ? colorFor(node.type)
        : (graph.communityById.get(node.communityId)?.color ?? colorFor(node.communityTitle));
    const pinned = pinnedPositions.get(node.id);
    if (pinned) {
      node.x = Math.max(44, Math.min(width - 44, pinned.x));
      node.y = Math.max(44, Math.min(height - 44, pinned.y));
    }
  });

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visibleSeedIds = visibleSeeds();
  const maxLinks = state.focus ? MAX_FOCUSED_GRAPH_EDGES : MAX_FULL_GRAPH_EDGES;
  const links = graph.relationships
    .filter((relationship) => byId.has(relationship.sourceId) && byId.has(relationship.targetId))
    .sort(
      (left, right) =>
        relationshipVisualScore(right, visibleSeedIds) -
          relationshipVisualScore(left, visibleSeedIds) || left.id.localeCompare(right.id),
    )
    .slice(0, maxLinks);
  for (let tick = 0; tick < 220; tick += 1) {
    for (const node of nodes) {
      const center = centers.get(groupFor(node)) ?? { x: centerX, y: centerY };
      node.vx += (center.x - node.x) * 0.006;
      node.vy += (center.y - node.y) * 0.006;
    }
    for (const link of links) {
      const source = byId.get(link.sourceId);
      const target = byId.get(link.targetId);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const desired = 178 - Math.min(42, link.weight * 28);
      const force = (distance - desired) * 0.01;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = nodes[leftIndex]!;
        const right = nodes[rightIndex]!;
        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const minimum = left.r + right.r + 64;
        if (distance < minimum) {
          const push = (minimum - distance) * 0.023;
          const px = (dx / distance) * push;
          const py = (dy / distance) * push;
          left.vx -= px;
          left.vy -= py;
          right.vx += px;
          right.vy += py;
        }
      }
    }
    for (const node of nodes) {
      const pinned = pinnedPositions.get(node.id);
      if (pinned) {
        node.x = Math.max(44, Math.min(width - 44, pinned.x));
        node.y = Math.max(44, Math.min(height - 44, pinned.y));
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx *= 0.72;
      node.vy *= 0.72;
      node.x = Math.max(44, Math.min(width - 44, node.x + node.vx));
      node.y = Math.max(44, Math.min(height - 44, node.y + node.vy));
    }
  }
  layout = { nodes, links, byId, width, height };
}

function relationshipVisualScore(relationship: GraphRelationship, seeds: Set<string>): number {
  const selectedBoost =
    state.selectedId &&
    (relationship.sourceId === state.selectedId || relationship.targetId === state.selectedId)
      ? 80
      : 0;
  const seedBoost = seeds.has(relationship.sourceId) || seeds.has(relationship.targetId) ? 34 : 0;
  const hotPairBoost =
    seeds.has(relationship.sourceId) && seeds.has(relationship.targetId) ? 18 : 0;
  return selectedBoost + seedBoost + hotPairBoost + relationship.weight * 8;
}

function renderCommunities(): void {
  const target = document.querySelector<HTMLDivElement>("#communities");
  if (!target) return;
  const max = Math.max(1, ...graph.communities.map((community) => community.entityIds.length));
  target.innerHTML = graph.communities
    .slice()
    .sort(
      (left, right) =>
        right.entityIds.length - left.entityIds.length || left.title.localeCompare(right.title),
    )
    .map((community) => {
      const active = state.selectedCommunity === community.id ? " active" : "";
      const width = Math.max(8, Math.round((community.entityIds.length / max) * 100));
      return `
        <button class="community${active}" data-community="${esc(community.id)}" type="button">
          <div class="community-row">
            <span class="community-title"><i class="dot" style="background:${community.color}"></i>${esc(community.title)}</span>
            <span class="community-count">${community.entityIds.length}</span>
          </div>
          <div class="bar"><i style="width:${width}%; background:${community.color}"></i></div>
        </button>
      `;
    })
    .join("");
  target.querySelectorAll<HTMLButtonElement>("[data-community]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.community ?? null;
      state.selectedCommunity = state.selectedCommunity === id ? null : id;
      state.selectedId = null;
      state.selectedStorageTable = null;
      renderAll();
    });
  });
}

function renderStorageTables(): void {
  const target = document.querySelector<HTMLDivElement>("#storage-tables");
  const count = document.querySelector<HTMLSpanElement>("#table-count");
  if (!target) return;

  const tables = buildDbTables();
  if (count) {
    count.textContent = String(tables.length);
  }

  target.innerHTML = tables
    .map(
      (table) => `
      <button class="storage-table${state.selectedStorageTable === table.name ? " active" : ""}" type="button" data-table="${esc(table.name)}">
        <span>
          <strong>${esc(table.name)}</strong>
          <small>${esc(table.group)} · ${esc(table.purpose)}</small>
        </span>
        <b>${table.count}</b>
      </button>
    `,
    )
    .join("");
  target.querySelectorAll<HTMLButtonElement>("[data-table]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedStorageTable = button.dataset.table ?? null;
      state.selectedId = null;
      state.selectedCommunity = null;
      renderAll();
    });
  });
}

function renderLegend(): void {
  const target = document.querySelector<HTMLDivElement>("#legend");
  if (!target) return;
  const groups = Array.from(new Set(layout.nodes.map(groupFor))).slice(0, 10);
  target.innerHTML = groups
    .map(
      (group) =>
        `<span class="pill"><i class="dot" style="background:${colorFor(group)}"></i>${esc(group)}</span>`,
    )
    .join("");
}

function svgPointFromEvent(event: PointerEvent | WheelEvent): Point {
  const svg = document.querySelector<SVGSVGElement>("#graph");
  const rect = svg?.getBoundingClientRect();
  if (!svg || !rect || rect.width === 0 || rect.height === 0) {
    return { x: layout.width / 2, y: layout.height / 2 };
  }

  return {
    x: ((event.clientX - rect.left) / rect.width) * layout.width,
    y: ((event.clientY - rect.top) / rect.height) * layout.height,
  };
}

function graphPointFromEvent(event: PointerEvent | WheelEvent): Point {
  const point = svgPointFromEvent(event);
  return {
    x: (point.x - state.view.panX) / state.view.scale,
    y: (point.y - state.view.panY) / state.view.scale,
  };
}

function zoomAt(factor: number, anchor?: Point): void {
  const point = anchor ?? { x: layout.width / 2, y: layout.height / 2 };
  const nextScale = Math.max(0.35, Math.min(3.2, state.view.scale * factor));
  const world = {
    x: (point.x - state.view.panX) / state.view.scale,
    y: (point.y - state.view.panY) / state.view.scale,
  };
  state.view.scale = nextScale;
  state.view.panX = point.x - world.x * nextScale;
  state.view.panY = point.y - world.y * nextScale;
  renderGraph();
}

function handleGraphWheel(event: WheelEvent): void {
  event.preventDefault();
  zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, svgPointFromEvent(event));
}

function handleGraphPointerDown(event: PointerEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(".node")) {
    return;
  }

  const svg = document.querySelector<SVGSVGElement>("#graph");
  svg?.setPointerCapture(event.pointerId);
  dragState = {
    kind: "pan",
    pointerId: event.pointerId,
    last: svgPointFromEvent(event),
    moved: false,
  };
}

function startNodeDrag(event: PointerEvent, nodeId: string): void {
  event.preventDefault();
  event.stopPropagation();
  const svg = document.querySelector<SVGSVGElement>("#graph");
  svg?.setPointerCapture(event.pointerId);
  dragState = {
    kind: "node",
    pointerId: event.pointerId,
    nodeId,
    start: graphPointFromEvent(event),
    moved: false,
  };
}

function handleGraphPointerMove(event: PointerEvent): void {
  if (!dragState || dragState.pointerId !== event.pointerId) {
    return;
  }

  if (dragState.kind === "pan") {
    const point = svgPointFromEvent(event);
    const dx = point.x - dragState.last.x;
    const dy = point.y - dragState.last.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.5) {
      dragState.moved = true;
    }
    state.view.panX += dx;
    state.view.panY += dy;
    dragState.last = point;
    renderGraph();
    return;
  }

  const point = graphPointFromEvent(event);
  const dx = point.x - dragState.start.x;
  const dy = point.y - dragState.start.y;
  if (Math.sqrt(dx * dx + dy * dy) > 4) {
    dragState.moved = true;
  }
  const node = layout.byId.get(dragState.nodeId);
  if (!node) {
    return;
  }

  const pinned = {
    x: Math.max(44, Math.min(layout.width - 44, point.x)),
    y: Math.max(44, Math.min(layout.height - 44, point.y)),
  };
  pinnedPositions.set(node.id, pinned);
  node.x = pinned.x;
  node.y = pinned.y;
  renderGraph();
}

function handleGraphPointerUp(event: PointerEvent): void {
  if (!dragState || dragState.pointerId !== event.pointerId) {
    return;
  }

  const completed = dragState;
  dragState = null;
  const svg = document.querySelector<SVGSVGElement>("#graph");
  try {
    svg?.releasePointerCapture(event.pointerId);
  } catch {
    // Some browsers release pointer capture automatically after rerendering.
  }

  if (completed.kind === "node" && !completed.moved) {
    state.selectedId = state.selectedId === completed.nodeId ? null : completed.nodeId;
    state.selectedCommunity = null;
    state.selectedStorageTable = null;
    renderAll();
    return;
  }

  if (completed.kind === "pan" && !completed.moved) {
    state.selectedId = null;
    state.selectedCommunity = null;
    state.selectedStorageTable = null;
    renderAll();
  }
}

function renderGraph(): void {
  const svg = document.querySelector<SVGSVGElement>("#graph");
  if (!svg) return;
  const seeds = visibleSeeds();
  const hot = new Set(seeds);
  for (const relationship of graph.relationships) {
    if (seeds.has(relationship.sourceId) || seeds.has(relationship.targetId)) {
      hot.add(relationship.sourceId);
      hot.add(relationship.targetId);
    }
  }
  svg.innerHTML = "";
  const pattern = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  pattern.innerHTML =
    '<pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M 30 0 L 0 0 0 30" fill="none" stroke="#151515" stroke-width="1"/></pattern>';
  svg.appendChild(pattern);
  const viewport = document.createElementNS("http://www.w3.org/2000/svg", "g");
  viewport.setAttribute("class", "graph-viewport");
  viewport.setAttribute(
    "transform",
    `translate(${state.view.panX} ${state.view.panY}) scale(${state.view.scale})`,
  );
  svg.appendChild(viewport);
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("class", "graph-bg");
  rect.setAttribute("width", String(layout.width));
  rect.setAttribute("height", String(layout.height));
  rect.setAttribute("fill", "url(#grid)");
  viewport.appendChild(rect);

  for (const link of layout.links) {
    const source = layout.byId.get(link.sourceId);
    const target = layout.byId.get(link.targetId);
    if (!source || !target) continue;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const isHot = seeds.size > 0 && hot.has(link.sourceId) && hot.has(link.targetId);
    line.setAttribute("x1", String(source.x));
    line.setAttribute("y1", String(source.y));
    line.setAttribute("x2", String(target.x));
    line.setAttribute("y2", String(target.y));
    line.setAttribute("stroke-width", String(Math.max(1, Math.min(4, link.weight * 2.3))));
    line.setAttribute("class", `edge${isHot ? " hot" : seeds.size > 0 ? " dim" : ""}`);
    line.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      state.selectedId = source.id;
      state.selectedCommunity = null;
      state.selectedStorageTable = null;
      renderAll();
    });
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = link.description ?? `${link.source} -> ${link.target}`;
    line.appendChild(title);
    viewport.appendChild(line);
  }

  for (const node of layout.nodes) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const isHot = hot.has(node.id);
    const isSelected = state.selectedId === node.id;
    group.setAttribute(
      "class",
      `node${isHot ? " hot" : ""}${isSelected ? " selected" : ""}${seeds.size > 0 && !isHot ? " dim" : ""}`,
    );
    group.setAttribute("data-node-id", node.id);
    group.setAttribute("transform", `translate(${node.x} ${node.y})`);
    group.addEventListener("pointerdown", (event) => {
      startNodeDrag(event, node.id);
    });
    const halo = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    halo.setAttribute("class", "halo");
    halo.setAttribute("r", String(node.r + 8));
    halo.setAttribute("fill", "none");
    halo.setAttribute("stroke", node.color);
    halo.setAttribute("stroke-width", "2");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("class", "core");
    circle.setAttribute("r", String(node.r));
    circle.setAttribute("fill", node.color);
    circle.setAttribute("stroke", "#000000");
    circle.setAttribute("stroke-width", "1.5");
    const label = truncate(node.title, labelLengthForZoom());
    const labelWidth = Math.max(34, Math.min(210, label.length * 6.2 + 12));
    const labelX = node.r + 7;
    const labelBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    labelBg.setAttribute("class", "label-bg");
    labelBg.setAttribute("x", String(labelX - 4));
    labelBg.setAttribute("y", "-9");
    labelBg.setAttribute("width", String(labelWidth));
    labelBg.setAttribute("height", "18");
    labelBg.setAttribute("rx", "3");
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("class", "node-label");
    text.setAttribute("x", String(labelX + 2));
    text.setAttribute("y", "4");
    text.textContent = label;
    group.append(halo, labelBg, circle, text);
    viewport.appendChild(group);
  }
}

function labelLengthForZoom(): number {
  if (state.view.scale < 0.7) return 22;
  if (state.view.scale < 1) return 28;
  return 42;
}

function selectedEntity(): GraphEntity | null {
  if (state.selectedId) {
    return graph.entityById.get(state.selectedId) ?? null;
  }
  const firstRetrievalEntity = Array.from(retrievalEntityIds())[0];
  return firstRetrievalEntity ? (graph.entityById.get(firstRetrievalEntity) ?? null) : null;
}

function selectedStorageTable(): DbTablePreview | null {
  if (!state.selectedStorageTable) {
    return null;
  }

  return buildDbTables().find((table) => table.name === state.selectedStorageTable) ?? null;
}

function renderStorageInspector(target: HTMLDivElement, table: DbTablePreview): void {
  const sampleRows = table.rows.slice(0, 6);
  target.innerHTML = `
    <div class="type-row">
      <span class="pill">${esc(table.group === "core" ? "Core table" : "Join table")}</span>
      <span class="pill">${table.count} rows</span>
    </div>
    <h3>${esc(table.name)}</h3>
    <p class="sub">${esc(table.purpose)}</p>
    <div class="section"><h2>Optimized For</h2><div class="source">${esc(table.optimizedFor)}</div></div>
    <div class="section"><h2>Retrieval Use</h2><div class="source">${esc(table.retrievalUse)}</div></div>
    <div class="section"><h2>Columns</h2><div class="list">
      ${table.columns
        .map(
          (column) => `
        <div class="relationship">
          <strong>${esc(column.name)}</strong>
          <p>${esc(column.kind)} · ${esc(column.note)}</p>
        </div>
      `,
        )
        .join("")}
    </div></div>
    <div class="section"><h2>Sample Rows</h2><div class="list">
      ${sampleRows.length ? sampleRows.map((row) => `<pre class="row-sample">${esc(JSON.stringify(row, null, 2))}</pre>`).join("") : `<p class="empty">No rows in the active snapshot.</p>`}
    </div></div>
    <div class="section"><h2>Retrieval Path</h2><div class="context">${esc(retrievalPlanText())}</div></div>
  `;
}

function retrievalPlanText(): string {
  return [
    "1. Recall: score grag_text_units, grag_entities, grag_relationships, grag_community_reports, and optionally grag_embeddings.",
    "2. Expand: use link tables to move from hit chunks to entities, from entities to relationships, and from communities to reports.",
    "3. Ground: pull linked text units and document metadata so answers can cite source paths.",
    "4. Synthesize: local search answers focused questions from the neighborhood; global search map-reduces community reports.",
    "5. Persist: SQL/Kysely and @farming-labs/orm store the same normalized shape, so Postgres, SQLite, MySQL, and pgvector adapters can share the contract.",
  ].join("\n");
}

function renderInspector(): void {
  const target = document.querySelector<HTMLDivElement>("#inspector");
  if (!target) return;
  const storageTable = selectedStorageTable();
  if (storageTable) {
    renderStorageInspector(target, storageTable);
    return;
  }

  const entity = selectedEntity();
  if (!entity) {
    const largest = graph.communities
      .slice()
      .sort((left, right) => right.entityIds.length - left.entityIds.length)[0];
    target.innerHTML = `
      <h3>Select a node</h3>
      <p class="sub">Click a graph node, run retrieval, search the graph, or choose a community to inspect sources and relationships.</p>
      ${largest ? `<div class="card result"><strong>Largest community: ${esc(largest.title)}</strong><p>${largest.entityIds.length} entities are grouped here.</p></div>` : ""}
    `;
    return;
  }

  const relationships = graph.relationships.filter(
    (relationship) => relationship.sourceId === entity.id || relationship.targetId === entity.id,
  );
  const community = graph.communityById.get(entity.communityId);
  const report = community?.report;
  const textUnits = (entity.textUnitIds ?? []).flatMap((id) => {
    const textUnit = graph.textUnitById.get(id);
    return textUnit ? [textUnit] : [];
  });
  target.innerHTML = `
    <div class="type-row">
      <span class="pill">${esc(entity.type)}</span>
      <span class="pill">${esc(entity.communityTitle)}</span>
    </div>
    <h3>${esc(entity.title)}</h3>
    <p class="sub">${esc(entity.description || "No description attached.")}</p>
    <div class="metrics">
      <div class="metric"><span>Degree</span><strong>${entity.degree}</strong></div>
      <div class="metric"><span>Rank</span><strong>${Math.round(entity.rank * 10) / 10}</strong></div>
    </div>
    <div class="section"><h2>Relationships</h2><div class="list">
      ${
        relationships.length
          ? relationships
              .slice(0, 8)
              .map(
                (relationship) =>
                  `<div class="relationship">${esc(relationship.description ?? `${relationship.source} -> ${relationship.target}`)}</div>`,
              )
              .join("")
          : `<p class="empty">No relationships in the current snapshot.</p>`
      }
    </div></div>
    <div class="section"><h2>Grounding</h2><div class="list">
      ${
        entity.sourcePaths.length
          ? entity.sourcePaths
              .slice(0, 8)
              .map((path) => `<div class="source">${esc(path)}</div>`)
              .join("")
          : `<p class="empty">No source paths attached.</p>`
      }
    </div></div>
    <div class="section"><h2>Text Units</h2><div class="list">
      ${
        textUnits.length
          ? textUnits
              .slice(0, 4)
              .map((unit) => `<div class="source">${esc(unit.text)}</div>`)
              .join("")
          : `<p class="empty">No linked text units.</p>`
      }
    </div></div>
    ${report ? `<div class="section"><h2>Community Report</h2><div class="result"><div class="result-title"><span>${esc(report.title)}</span><span class="score">${esc(report.rank ?? "")}</span></div><p>${esc(report.summary || report.fullContent || "")}</p></div></div>` : ""}
  `;
}

function clientRetrieve(query: string): RetrievalResult {
  const queryTokens = tokens(query);
  const entityHits = graph.entities
    .map((entity) => ({
      kind: "entity",
      id: entity.id,
      title: entity.title,
      score:
        lexicalScore(
          queryTokens,
          [
            entity.title,
            entity.type,
            entity.description,
            entity.communityTitle,
            ...entity.sourcePaths,
          ].join(" "),
        ) * 1.12,
      text: entity.description,
      sourcePaths: entity.sourcePaths,
      entityIds: [entity.id],
      relationshipIds: [],
    }))
    .filter((hit) => hit.score > 0);
  const relationshipHits = graph.relationships
    .map((relationship) => ({
      kind: "relationship",
      id: relationship.id,
      title: `${relationship.source} -> ${relationship.target}`,
      score: lexicalScore(
        queryTokens,
        [relationship.source, relationship.target, relationship.description ?? ""].join(" "),
      ),
      text: relationship.description ?? "",
      sourcePaths: sourcePaths(relationship.attributes),
      entityIds: [relationship.sourceId, relationship.targetId],
      relationshipIds: [relationship.id],
    }))
    .filter((hit) => hit.score > 0);
  const textHits = graph.textUnits
    .map((unit) => ({
      kind: "text_unit",
      id: unit.id,
      title: unit.humanReadableId?.toString() ?? unit.id,
      score: lexicalScore(queryTokens, unit.text) * 1.2,
      text: unit.text,
      sourcePaths: sourcePaths(unit.attributes),
      entityIds: unit.entityIds ?? [],
      relationshipIds: unit.relationshipIds ?? [],
    }))
    .filter((hit) => hit.score > 0);
  const reportHits = graph.communities
    .flatMap((community) => {
      if (!community.report) {
        return [];
      }
      return [
        {
          kind: "community_report",
          id: community.report.id,
          title: community.report.title,
          score:
            lexicalScore(
              queryTokens,
              [
                community.title,
                community.report.summary ?? "",
                community.report.fullContent ?? "",
              ].join(" "),
            ) * 0.92,
          text: community.report.summary || community.report.fullContent || "",
          sourcePaths: [],
          entityIds: community.entityIds,
          relationshipIds: community.relationshipIds,
        },
      ];
    })
    .filter((hit) => hit.score > 0);
  const hits = [...entityHits, ...relationshipHits, ...textHits, ...reportHits]
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, 12)
    .map((hit) => ({ ...hit, score: Math.round(hit.score * 1000) / 1000 }));

  return {
    query,
    tokens: queryTokens,
    hits,
    context: hits
      .slice(0, 8)
      .map((hit, index) => `${index + 1}. [${hit.kind}] ${hit.title} (${hit.score})\n${hit.text}`)
      .join("\n\n"),
    stats: {
      entityHits: entityHits.length,
      relationshipHits: relationshipHits.length,
      textUnitHits: textHits.length,
      communityReportHits: reportHits.length,
    },
  };
}

async function runRetrieval(): Promise<void> {
  if (!state.retrievalQuery) {
    retrieval = null;
    renderAll();
    return;
  }

  retrieval = clientRetrieve(state.retrievalQuery);
  state.focus = true;
  document.querySelector("#focus")?.classList.add("active");
  renderAll();
}

function renderRetrieval(): void {
  const target = document.querySelector<HTMLDivElement>("#retrieval-results");
  if (!target) return;
  if (!retrieval) {
    target.innerHTML = `<p class="empty">Run a retrieval query to highlight graph evidence and build context.</p>`;
    return;
  }
  target.innerHTML = `
    <div class="metrics">
      <div class="metric"><span>Hits</span><strong>${retrieval.hits.length}</strong></div>
      <div class="metric"><span>Tokens</span><strong>${retrieval.tokens.length}</strong></div>
    </div>
    ${retrieval.hits
      .slice(0, 5)
      .map(
        (hit) => `
      <button class="result result-button" type="button" data-hit-entity="${esc(hit.entityIds[0] ?? "")}">
        <div class="result-title"><span>${esc(hit.title)}</span><span class="score">${hit.score}</span></div>
        <p>${esc(hit.kind)} · ${esc(truncate(hit.text, 120))}</p>
      </button>
    `,
      )
      .join("")}
    <div class="section"><h2>Context</h2><div class="context">${esc(retrieval.context || "No context built.")}</div></div>
  `;
  target.querySelectorAll<HTMLButtonElement>("[data-hit-entity]").forEach((button) => {
    button.addEventListener("click", () => {
      const entityId = button.dataset.hitEntity;
      if (!entityId || !graph.entityById.has(entityId)) {
        return;
      }
      state.selectedId = entityId;
      state.selectedCommunity = null;
      state.selectedStorageTable = null;
      state.focus = true;
      document.querySelector("#focus")?.classList.add("active");
      renderAll();
    });
  });
}

function renderAll(): void {
  computeLayout();
  renderSourceState();
  renderMetrics();
  renderCommunities();
  renderStorageTables();
  renderLegend();
  renderGraph();
  renderRetrieval();
  renderInspector();
}

async function loadSnapshot(): Promise<GraphRagSnapshot> {
  if (window.__GRAG_SNAPSHOT__) {
    return window.__GRAG_SNAPSHOT__;
  }

  const response = await fetch("/snapshot.json");
  if (!response.ok) {
    throw new Error(`Failed to load snapshot: ${response.status}`);
  }
  return (await response.json()) as GraphRagSnapshot;
}

async function loadCapabilities(): Promise<StudioCapabilities> {
  try {
    const response = await fetch("/health");
    if (!response.ok) {
      return capabilities;
    }
    const body = (await response.json()) as Record<string, unknown>;
    return {
      openaiEnabled: body.openaiEnabled === true,
      openaiModel:
        typeof body.openaiModel === "string" ? body.openaiModel : capabilities.openaiModel,
      maxUploadBytes:
        typeof body.maxUploadBytes === "number" ? body.maxUploadBytes : capabilities.maxUploadBytes,
    };
  } catch {
    return capabilities;
  }
}

async function main(): Promise<void> {
  snapshot = await loadSnapshot();
  capabilities = await loadCapabilities();
  state.documentStatus = capabilities.openaiEnabled
    ? `OpenAI automation ready on ${capabilities.openaiModel}. Import GitHub repos, upload rich files, or paste documents.`
    : "GitHub repos and text files work locally. Set OPENAI_API_KEY before starting Studio for AI extraction of repos, PDFs, images, and rich files.";
  baseSnapshot = snapshot;
  baseSourceTitle =
    window.__GRAG_STUDIO__?.title && window.__GRAG_STUDIO__?.title !== "GraphRAG Studio"
      ? window.__GRAG_STUDIO__.title
      : "Repository knowledge graph sample";
  state.sourceTitle = baseSourceTitle;
  graph = buildGraph(snapshot);
  renderShell();
  await runRetrieval();
}

window.addEventListener("resize", () => renderAll());
void main().catch((error: unknown) => {
  app.innerHTML = `<main class="sidebar"><h1>GraphRAG Studio failed</h1><p class="sub">${esc(error instanceof Error ? error.message : String(error))}</p></main>`;
});
