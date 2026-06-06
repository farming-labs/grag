import {
  completionContent,
  type ChatCompletion,
  type ChatMessage,
  type ChatModel,
  type ChatOptions,
  type EmbeddingModel,
} from "../llm.js";
import type { Entity, GraphRagSnapshot, JsonObject, Relationship, TextUnit } from "../model.js";
import type { GraphRagStore } from "../storage/types.js";
import { basicSearch, type BasicSearchOptions } from "./basic-search.js";
import {
  retrieveFromGraphRagSnapshot,
  type GraphRagRetrievalHit,
  type GraphRagRetrievalHitKind,
} from "../studio/retrieval.js";
import {
  planGraphRagQuery,
  summarizeGraphRagQueryPlan,
  type GraphRagQueryPlan,
} from "./planner.js";

export type GraphRagHitChannel = "graph" | "lexical" | "neighbor" | "reference" | "vector";
export type GraphRagAnswerMode = "model" | "extractive";

export interface GraphRagRetrieverOptions {
  store: GraphRagStore;
  model?: ChatModel;
  embeddingModel?: EmbeddingModel;
}

export interface GraphRagSearchOptions {
  /** Number of merged hits to return. Default: 12. */
  limit?: number;
  /** Number of graph/entity/relationship/text-unit hits to load before merging. Default: limit. */
  graphLimit?: number;
  /** Number of direct text-unit hits to load before merging. Default: limit. */
  textLimit?: number;
  /** Include direct lexical/vector text search beside graph retrieval. Default: true. */
  includeTextSearch?: boolean;
  /** Options for direct text-unit search. The retriever-level embedding model is used by default. */
  basicSearch?: BasicSearchOptions;
  /** Maximum rendered context size. Default: 12,000 characters. */
  maxContextChars?: number;
  /** Pass an explicit query plan or let the retriever infer one. */
  queryPlan?: GraphRagQueryPlan;
  /** Maximum entity ids returned for graph highlighting. Default: 64. */
  maxGraphEntities?: number;
  /** Maximum relationship ids returned for graph highlighting. Default: 96. */
  maxGraphRelationships?: number;
  /** Maximum text unit ids returned for graph highlighting. Default: 24. */
  maxGraphTextUnits?: number;
}

export interface GraphRagAskOptions extends GraphRagSearchOptions {
  /** Override the retriever-level model for this call. */
  model?: ChatModel;
  /** Throw if no model is available instead of returning an extractive answer. */
  requireModel?: boolean;
  /** Extra instruction appended to the grounded answer prompt. */
  systemPrompt?: string;
  /** User-facing response style. Example: "short dashboard answer" or "bullets with citations". */
  responseStyle?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GraphRagCitation {
  id: string;
  title: string;
  sourcePaths: string[];
  snippets: string[];
  hitIds: string[];
  entityIds: string[];
  relationshipIds: string[];
}

export interface GraphRagSearchHit {
  id: string;
  kind: GraphRagRetrievalHitKind;
  title: string;
  score: number;
  text: string;
  channels: GraphRagHitChannel[];
  sourcePaths: string[];
  entityIds: string[];
  relationshipIds: string[];
  citationIds: string[];
}

export interface GraphRagGraphSelection {
  entityIds: string[];
  relationshipIds: string[];
  textUnitIds: string[];
  communityIds: string[];
}

export interface GraphRagSearchStats {
  graphHitCount: number;
  textHitCount: number;
  mergedHitCount: number;
  citationCount: number;
  snapshot: {
    documents: number;
    textUnits: number;
    entities: number;
    relationships: number;
    communities: number;
    communityReports: number;
    embeddings: number;
  };
}

export interface GraphRagSearchTimings {
  loadSnapshotMs: number;
  graphSearchMs: number;
  textSearchMs: number;
  totalMs: number;
}

export interface GraphRagRetrievalTraceStep {
  stage: string;
  detail: string;
  count?: number;
  durationMs?: number;
}

export interface GraphRagSearchResult {
  query: string;
  plan: GraphRagQueryPlan;
  hits: GraphRagSearchHit[];
  citations: GraphRagCitation[];
  context: string;
  graph: GraphRagGraphSelection;
  stats: GraphRagSearchStats;
  timings: GraphRagSearchTimings;
  trace: GraphRagRetrievalTraceStep[];
}

export interface GraphRagAskResult extends GraphRagSearchResult {
  answer: string;
  mode: GraphRagAnswerMode;
  usage?: ChatCompletion["usage"];
}

interface MutableSearchHit {
  id: string;
  kind: GraphRagRetrievalHitKind;
  title: string;
  score: number;
  text: string;
  channels: Set<GraphRagHitChannel>;
  sourcePaths: Set<string>;
  entityIds: Set<string>;
  relationshipIds: Set<string>;
}

interface CitationSeed {
  title: string;
  sourcePaths: Set<string>;
  snippets: string[];
  hitIds: Set<string>;
  entityIds: Set<string>;
  relationshipIds: Set<string>;
}

const defaultLimit = 12;
const defaultContextChars = 12_000;

export class GraphRagRetriever {
  private readonly store: GraphRagStore;
  private readonly model: ChatModel | undefined;
  private readonly embeddingModel: EmbeddingModel | undefined;

  constructor(options: GraphRagRetrieverOptions) {
    this.store = options.store;
    this.model = options.model;
    this.embeddingModel = options.embeddingModel;
  }

  async search(query: string, options: GraphRagSearchOptions = {}): Promise<GraphRagSearchResult> {
    const started = Date.now();
    const plan = options.queryPlan ?? planGraphRagQuery(query);
    const trace: GraphRagRetrievalTraceStep[] = [
      {
        stage: "plan",
        detail: summarizeGraphRagQueryPlan(plan),
        count: plan.entities.length,
      },
    ];
    const snapshotStarted = Date.now();
    const snapshot = await this.store.getSnapshot();
    const loadSnapshotMs = Date.now() - snapshotStarted;
    trace.push({
      stage: "load_snapshot",
      detail: "Loaded GraphRAG snapshot from the configured store.",
      count: snapshot.textUnits.length,
      durationMs: loadSnapshotMs,
    });
    const limit = normalizeLimit(options.limit);

    const graphStarted = Date.now();
    const graphLimit = normalizeLimit(
      options.graphLimit ?? Math.ceil(limit * plan.searchFocus.graphLimitMultiplier),
    );
    const graphResult = retrieveFromGraphRagSnapshot(snapshot, query, {
      limit: graphLimit,
    });
    const graphSearchMs = Date.now() - graphStarted;
    trace.push({
      stage: "graph_search",
      detail: `Searched entities, relationships, text units, and community reports with graph limit ${graphLimit}.`,
      count: graphResult.hits.length,
      durationMs: graphSearchMs,
    });

    const textStarted = Date.now();
    const includeTextSearch = options.includeTextSearch ?? plan.searchFocus.includeTextSearch;
    const textHits =
      includeTextSearch === false
        ? []
        : await basicSearch(this.store, query, this.basicSearchOptions(options, limit, plan));
    const textSearchMs = Date.now() - textStarted;
    trace.push({
      stage: includeTextSearch === false ? "text_search_skipped" : "text_search",
      detail:
        includeTextSearch === false
          ? "Skipped direct text-unit search for this query."
          : "Searched text units directly with lexical or vector search.",
      count: textHits.length,
      durationMs: textSearchMs,
    });

    const referenceStarted = Date.now();
    const referenceHits = referenceSearch(snapshot, query, plan, normalizeLimit(limit * 3));
    trace.push({
      stage: "reference_search",
      detail:
        "Resolved exact code references, source-path aliases, and high-salience query phrases.",
      count: referenceHits.length,
      durationMs: Date.now() - referenceStarted,
    });

    const neighborStarted = Date.now();
    const neighborHits = expandNeighborHits(
      snapshot,
      [
        ...graphResult.hits.map((hit) => fromGraphHit(hit)),
        ...textHits.map((hit) => fromTextUnitHit(hit.textUnit, hit.score, hit.scoreType)),
        ...referenceHits,
      ],
      query,
      plan,
      normalizeLimit(limit * 4),
    );
    trace.push({
      stage: "neighbor_expand",
      detail:
        "Expanded from seed hits into graph-linked entities, relationships, and related source chunks.",
      count: neighborHits.length,
      durationMs: Date.now() - neighborStarted,
    });

    const hits = mergeHits(
      [
        ...graphResult.hits.map((hit) => fromGraphHit(hit)),
        ...textHits.map((hit) => fromTextUnitHit(hit.textUnit, hit.score, hit.scoreType)),
        ...referenceHits,
        ...neighborHits,
      ],
      limit,
      plan,
    );
    trace.push({
      stage: "merge",
      detail: "Merged graph, lexical, and vector channels into ranked hits.",
      count: hits.length,
    });
    const { citations, citationIdsByHitId } = buildCitations(hits);
    trace.push({
      stage: "citations",
      detail: "Grouped hits by source path into answer citations.",
      count: citations.length,
    });
    const hitsWithCitations = hits.map((hit) => ({
      ...hit,
      citationIds: citationIdsByHitId.get(hit.id) ?? [],
    }));
    const context = buildDashboardContext(
      hitsWithCitations,
      citations,
      options.maxContextChars ?? plan.searchFocus.maxContextChars ?? defaultContextChars,
    );
    const graph = buildGraphSelection(snapshot, hitsWithCitations, options);
    trace.push({
      stage: "graph_selection",
      detail: "Selected graph nodes, edges, communities, and text units for UI highlighting.",
      count:
        graph.entityIds.length +
        graph.relationshipIds.length +
        graph.textUnitIds.length +
        graph.communityIds.length,
    });

    return {
      query,
      plan,
      hits: hitsWithCitations,
      citations,
      context,
      graph,
      stats: {
        graphHitCount: graphResult.hits.length,
        textHitCount: textHits.length,
        mergedHitCount: hitsWithCitations.length,
        citationCount: citations.length,
        snapshot: {
          documents: snapshot.documents.length,
          textUnits: snapshot.textUnits.length,
          entities: snapshot.entities.length,
          relationships: snapshot.relationships.length,
          communities: snapshot.communities.length,
          communityReports: snapshot.communityReports.length,
          embeddings: snapshot.embeddings.length,
        },
      },
      timings: {
        loadSnapshotMs,
        graphSearchMs,
        textSearchMs,
        totalMs: Date.now() - started,
      },
      trace,
    };
  }

  async ask(query: string, options: GraphRagAskOptions = {}): Promise<GraphRagAskResult> {
    const search = await this.search(query, options);
    const model = options.model ?? this.model;
    if (!model) {
      if (options.requireModel) {
        throw new Error(
          "GraphRagRetriever.ask requires a ChatModel. Pass model or set requireModel to false.",
        );
      }

      return {
        ...search,
        answer: buildExtractiveAnswer(search),
        mode: "extractive",
      };
    }

    if (search.hits.length === 0) {
      return {
        ...search,
        answer: "I could not find enough graph evidence to answer that from the current index.",
        mode: "model",
      };
    }

    const completion = await model.complete(
      buildAnswerMessages(query, search, options),
      chatOptions(options),
    );
    const usage = typeof completion === "string" ? undefined : completion.usage;

    return {
      ...search,
      answer: completionContent(completion),
      mode: "model",
      ...(usage ? { usage } : {}),
    };
  }

  private basicSearchOptions(
    options: GraphRagSearchOptions,
    limit: number,
    plan?: GraphRagQueryPlan,
  ): BasicSearchOptions {
    const plannedLimit = plan ? Math.ceil(limit * plan.searchFocus.textLimitMultiplier) : limit;
    const textLimit = normalizeLimit(
      options.textLimit ?? options.basicSearch?.limit ?? plannedLimit,
    );
    return {
      ...options.basicSearch,
      limit: textLimit,
      ...(options.basicSearch?.embeddingModel
        ? {}
        : this.embeddingModel
          ? { embeddingModel: this.embeddingModel }
          : {}),
    };
  }
}

export function createGraphRagRetriever(options: GraphRagRetrieverOptions): GraphRagRetriever {
  return new GraphRagRetriever(options);
}

function fromGraphHit(hit: GraphRagRetrievalHit): MutableSearchHit {
  return {
    id: hit.id,
    kind: hit.kind,
    title: hit.title,
    score: hit.score,
    text: hit.text,
    channels: new Set(["graph"]),
    sourcePaths: new Set(hit.sourcePaths),
    entityIds: new Set(hit.entityIds),
    relationshipIds: new Set(hit.relationshipIds),
  };
}

function fromTextUnitHit(
  textUnit: TextUnit,
  score: number,
  scoreType: "vector" | "lexical",
): MutableSearchHit {
  return {
    id: textUnit.id,
    kind: "text_unit",
    title: textUnit.humanReadableId?.toString() ?? textUnit.id,
    score: roundScore(score),
    text: textUnit.text,
    channels: new Set([scoreType]),
    sourcePaths: new Set(sourcePathsFromAttributes(textUnit.attributes)),
    entityIds: new Set(textUnit.entityIds),
    relationshipIds: new Set(textUnit.relationshipIds),
  };
}

function referenceSearch(
  snapshot: GraphRagSnapshot,
  query: string,
  plan: GraphRagQueryPlan,
  limit: number,
): MutableSearchHit[] {
  const anchors = buildQueryAnchors(query, plan);
  const terms = importantQueryTerms(query);
  const textUnitHits = snapshot.textUnits
    .map((textUnit) => ({
      textUnit,
      score: scoreTextUnitReference(textUnit, anchors, terms, plan),
    }))
    .filter((entry) => entry.score >= 1.4)
    .sort(
      (left, right) =>
        right.score - left.score ||
        textUnitTitle(left.textUnit).localeCompare(textUnitTitle(right.textUnit)),
    )
    .slice(0, limit)
    .map((entry) => ({
      id: entry.textUnit.id,
      kind: "text_unit" as const,
      title: textUnitTitle(entry.textUnit),
      score: roundScore(entry.score),
      text: entry.textUnit.text,
      channels: new Set<GraphRagHitChannel>(["reference"]),
      sourcePaths: new Set(sourcePathsFromAttributes(entry.textUnit.attributes)),
      entityIds: new Set(entry.textUnit.entityIds),
      relationshipIds: new Set(entry.textUnit.relationshipIds),
    }));

  return textUnitHits
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit);
}

function expandNeighborHits(
  snapshot: GraphRagSnapshot,
  seeds: readonly MutableSearchHit[],
  query: string,
  plan: GraphRagQueryPlan,
  limit: number,
): MutableSearchHit[] {
  const anchors = buildQueryAnchors(query, plan);
  const terms = importantQueryTerms(query);
  const textUnitById = new Map(snapshot.textUnits.map((textUnit) => [textUnit.id, textUnit]));
  const entityById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const relationshipsById = new Map(
    snapshot.relationships.map((relationship) => [relationship.id, relationship]),
  );
  const relationshipsByEntityId = new Map<string, Relationship[]>();
  const seedTextUnitIds = new Set<string>();
  const seedEntityIds = new Set<string>();
  const seedRelationshipIds = new Set<string>();

  for (const relationship of snapshot.relationships) {
    for (const entityId of entityIdsForRelationship(relationship)) {
      const existing = relationshipsByEntityId.get(entityId) ?? [];
      existing.push(relationship);
      relationshipsByEntityId.set(entityId, existing);
    }
  }

  for (const seed of seeds.slice(0, Math.max(8, limit))) {
    if (seed.kind === "text_unit") {
      seedTextUnitIds.add(seed.id);
    }
    if (seed.kind === "entity") {
      seedEntityIds.add(seed.id);
    }
    if (seed.kind === "relationship") {
      seedRelationshipIds.add(seed.id);
    }
    for (const entityId of seed.entityIds) seedEntityIds.add(entityId);
    for (const relationshipId of seed.relationshipIds) seedRelationshipIds.add(relationshipId);
  }

  const candidateTextUnitIds = new Set<string>();
  const addTextUnits = (ids: readonly string[]) => {
    for (const id of ids) {
      if (!seedTextUnitIds.has(id)) {
        candidateTextUnitIds.add(id);
      }
    }
  };

  for (const entityId of seedEntityIds) {
    const entity = entityById.get(entityId);
    if (entity) {
      addTextUnits(entity.textUnitIds);
    }
    for (const relationship of relationshipsByEntityId.get(entityId) ?? []) {
      seedRelationshipIds.add(relationship.id);
      addTextUnits(relationship.textUnitIds);
    }
  }

  for (const relationshipId of seedRelationshipIds) {
    const relationship = relationshipsById.get(relationshipId);
    if (!relationship) {
      continue;
    }
    addTextUnits(relationship.textUnitIds);
    for (const entityId of entityIdsForRelationship(relationship)) {
      const entity = entityById.get(entityId);
      if (entity) {
        addTextUnits(entity.textUnitIds);
      }
    }
  }

  return Array.from(candidateTextUnitIds)
    .map((id) => textUnitById.get(id))
    .filter((textUnit): textUnit is TextUnit => Boolean(textUnit))
    .map((textUnit) => ({
      textUnit,
      score: 0.72 + scoreTextUnitReference(textUnit, anchors, terms, plan) * 0.7,
    }))
    .filter((entry) => entry.score >= 1.15)
    .sort(
      (left, right) =>
        right.score - left.score ||
        textUnitTitle(left.textUnit).localeCompare(textUnitTitle(right.textUnit)),
    )
    .slice(0, limit)
    .map((entry) => ({
      id: entry.textUnit.id,
      kind: "text_unit" as const,
      title: textUnitTitle(entry.textUnit),
      score: roundScore(entry.score),
      text: entry.textUnit.text,
      channels: new Set<GraphRagHitChannel>(["neighbor"]),
      sourcePaths: new Set(sourcePathsFromAttributes(entry.textUnit.attributes)),
      entityIds: new Set(entry.textUnit.entityIds),
      relationshipIds: new Set(entry.textUnit.relationshipIds),
    }));
}

function mergeHits(
  hits: readonly MutableSearchHit[],
  limit: number,
  plan: GraphRagQueryPlan,
): Array<Omit<GraphRagSearchHit, "citationIds">> {
  const merged = new Map<string, MutableSearchHit>();
  for (const hit of hits) {
    const key = `${hit.kind}:${hit.id}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, cloneMutableHit(hit));
      continue;
    }

    existing.score = Math.max(existing.score, hit.score);
    existing.text = existing.text.length >= hit.text.length ? existing.text : hit.text;
    for (const channel of hit.channels) existing.channels.add(channel);
    for (const sourcePath of hit.sourcePaths) existing.sourcePaths.add(sourcePath);
    for (const entityId of hit.entityIds) existing.entityIds.add(entityId);
    for (const relationshipId of hit.relationshipIds) existing.relationshipIds.add(relationshipId);
  }

  return Array.from(merged.values())
    .map((hit) => ({
      id: hit.id,
      kind: hit.kind,
      title: hit.title,
      score: roundScore(plannedHitScore(hit, plan)),
      text: hit.text,
      channels: sortedStrings(hit.channels) as GraphRagHitChannel[],
      sourcePaths: sortedStrings(hit.sourcePaths),
      entityIds: sortedStrings(hit.entityIds),
      relationshipIds: sortedStrings(hit.relationshipIds),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        channelRank(right.channels) - channelRank(left.channels) ||
        left.title.localeCompare(right.title),
    )
    .slice(0, limit);
}

function plannedHitScore(hit: MutableSearchHit, plan: GraphRagQueryPlan): number {
  let score = hit.score;

  if (hit.channels.has("reference")) {
    score += 0.7;
  }

  if (hit.channels.has("neighbor")) {
    score += plan.scope === "flow" || plan.intent === "impact" ? 0.46 : 0.22;
  }

  if (plan.searchFocus.preferCommunityReports && hit.kind === "community_report") {
    score += 0.16;
  }

  if (plan.scope === "node" && (hit.kind === "entity" || hit.kind === "text_unit")) {
    score += 0.08;
  }

  if (plan.scope === "flow" && hit.kind === "relationship") {
    score += 0.14;
  }

  for (const entity of plan.entities) {
    const needle = entity.value.toLowerCase();
    const titleMatch = hit.title.toLowerCase().includes(needle);
    const sourceMatch = Array.from(hit.sourcePaths).some((sourcePath) =>
      sourcePath.toLowerCase().includes(needle),
    );
    if (titleMatch || sourceMatch) {
      score += 0.24 * entity.confidence;
    }
  }

  return score;
}

interface QueryAnchor {
  value: string;
  normalized: string;
  weight: number;
}

function scoreTextUnitReference(
  textUnit: TextUnit,
  anchors: readonly QueryAnchor[],
  terms: readonly string[],
  plan: GraphRagQueryPlan,
): number {
  const title = textUnitTitle(textUnit);
  const sourcePaths = sourcePathsFromAttributes(textUnit.attributes);
  const sourceText = sourcePaths.join(" ");
  const sourceHaystack = normalizeSearchText(`${title} ${sourceText}`);
  const contentHaystack = normalizeSearchText(textUnit.text);
  const sourceKindScore = sourceKindBoost(sourcePaths, plan);
  let score = sourceKindScore;

  for (const anchor of anchors) {
    if (!anchor.normalized) {
      continue;
    }
    if (sourceHaystack.includes(anchor.normalized)) {
      score += anchor.weight * 2.15;
    } else if (sourceHaystack.includes(anchor.normalized.replace(/\s+/g, "-"))) {
      score += anchor.weight * 2;
    }
    if (contentHaystack.includes(anchor.normalized)) {
      score += anchor.weight * 0.75;
    }
  }

  const sourceTermMatches = terms.filter((term) => sourceHaystack.includes(term)).length;
  const contentTermMatches = terms.filter((term) => contentHaystack.includes(term)).length;
  const allTermsMatchContent = terms.length > 0 && contentTermMatches / terms.length >= 0.82;
  score += sourceTermMatches * 1.05;
  score += Math.min(terms.length, contentTermMatches) * 0.32;

  if (
    terms.includes("session") &&
    (terms.includes("cookie") || terms.includes("prefix")) &&
    !/\b(cookie|cookies|session|sessiontoken|setsessioncookie|getsessioncookie|deletesessioncookie)\b/.test(
      `${sourceHaystack} ${contentHaystack}`,
    )
  ) {
    score -= 8;
  }

  if (allTermsMatchContent) {
    score += 1.2;
  }

  if (
    plan.scope === "flow" &&
    sourcePaths.some((path) =>
      /\/(?:api|plugins|adapters|db|oauth2|cookies|integrations)\//.test(path),
    )
  ) {
    score += 0.8;
  }

  return score;
}

function scoreEntityReference(
  entity: Entity,
  anchors: readonly QueryAnchor[],
  terms: readonly string[],
  plan: GraphRagQueryPlan,
): number {
  const sourcePaths = sourcePathsFromAttributes(entity.attributes);
  const haystack = normalizeSearchText(
    [entity.title, entity.type ?? "", entity.description ?? "", sourcePaths.join(" ")].join(" "),
  );
  let score = sourceKindBoost(sourcePaths, plan) * 0.72 + Number(entity.rank ?? 0) * 0.03;

  for (const anchor of anchors) {
    if (haystack.includes(anchor.normalized)) {
      score += anchor.weight * 1.55;
    }
  }

  score += terms.filter((term) => haystack.includes(term)).length * 0.62;
  return score;
}

function buildQueryAnchors(query: string, plan: GraphRagQueryPlan): QueryAnchor[] {
  const anchors: QueryAnchor[] = [];
  const terms = importantQueryTerms(query);

  for (const entity of plan.entities) {
    pushAnchor(anchors, entity.value, 2.4 * entity.confidence);
  }

  for (const term of terms) {
    pushAnchor(anchors, term, 0.42);
  }

  for (let index = 0; index < terms.length - 1; index += 1) {
    const pair = `${terms[index]} ${terms[index + 1]}`;
    pushAnchor(anchors, pair, 0.88);
    pushAnchor(anchors, pair.replace(/\s+/g, "-"), 1.05);
    pushAnchor(anchors, camelCasePhrase(pair), 1);
  }

  for (let index = 0; index < terms.length - 2; index += 1) {
    const triple = `${terms[index]} ${terms[index + 1]} ${terms[index + 2]}`;
    pushAnchor(anchors, triple.replace(/\s+/g, "-"), 0.94);
  }

  addDomainAnchors(anchors, terms);

  return anchors
    .filter((anchor) => anchor.normalized.length >= 2)
    .sort((left, right) => right.weight - left.weight || left.value.localeCompare(right.value))
    .slice(0, 48);
}

function addDomainAnchors(anchors: QueryAnchor[], terms: readonly string[]): void {
  const has = (term: string) => terms.includes(term);
  const addMany = (values: readonly string[], weight: number) => {
    for (const value of values) {
      pushAnchor(anchors, value, weight);
    }
  };

  if (has("origin") && (has("check") || has("trust"))) {
    addMany(["origin-check", "originCheck", "trustedOrigins", "middlewares/origin-check"], 2.4);
  }

  if (has("session") && (has("cookie") || has("cookies"))) {
    addMany(
      [
        "cookies/index",
        "cookies/check-cookies",
        "cookies/cookie-utils",
        "sessionToken",
        "setSessionCookie",
        "getSessionCookie",
        "deleteSessionCookie",
        "integrations/next-js",
      ],
      4.2,
    );
  }

  if (has("plugin") && (has("client") || has("api") || has("apis"))) {
    addMany(
      [
        "client/plugins/infer-plugin",
        "client/plugins/index",
        "client/plugins",
        "infer-plugin",
        "BetterAuthClientPlugin",
      ],
      2.65,
    );
  }

  if (has("prisma") && (has("schema") || has("model") || has("adapter"))) {
    addMany(["prisma-adapter", "prisma.ts", "generators/prisma", "getAuthTables"], 2.2);
  }

  if (
    has("drizzle") &&
    (has("schema") || has("model") || has("adapter") || has("generation") || has("generate"))
  ) {
    addMany(
      ["drizzle-adapter", "generators/drizzle", "generateDrizzleSchema", "commands/generate"],
      2.75,
    );
  }

  if (has("kysely") && (has("migration") || has("migrate") || has("adapter") || has("schema"))) {
    addMany(
      [
        "kysely-adapter",
        "generators/kysely",
        "db/get-migration",
        "getMigrations",
        "generateMigrations",
      ],
      2.9,
    );
  }

  if (has("session") && (has("schema") || has("table") || has("change"))) {
    addMany(["db/schema", "internal-adapter", "api/routes/session", "session.ts"], 2.2);
  }

  if (has("organization") && (has("invitation") || has("invite") || has("permission"))) {
    addMany(
      [
        "organization/routes",
        "crud-invites",
        "crud-members",
        "has-permission",
        "organization/access",
      ],
      2.2,
    );
  }

  if (has("migrate") || has("migration")) {
    addMany(["commands/migrate", "migrate.ts", "generators", "generate", "kysely"], 2.65);
    addMany(["db/get-migration", "getMigrations", "generateMigrations"], 3.05);
  }

  if (has("callback") && (has("social") || has("provider") || has("account"))) {
    addMany(
      [
        "routes/callback",
        "oauth2/link-account",
        "link-account",
        "routes/sign-in",
        "setSessionCookie",
      ],
      2.45,
    );
  }
}

function pushAnchor(anchors: QueryAnchor[], value: string, weight: number): void {
  const normalized = normalizeSearchText(value);
  if (!normalized) {
    return;
  }

  const existing = anchors.find((anchor) => anchor.normalized === normalized);
  if (existing) {
    existing.weight = Math.max(existing.weight, weight);
    return;
  }

  anchors.push({
    value,
    normalized,
    weight,
  });
}

function importantQueryTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map(stemQueryTerm)
        .filter((term) => term.length >= 2)
        .filter((term) => !QUERY_STOPWORDS.has(term)),
    ),
  ).slice(0, 20);
}

const QUERY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "be",
  "by",
  "does",
  "file",
  "files",
  "for",
  "from",
  "get",
  "how",
  "if",
  "in",
  "including",
  "is",
  "it",
  "of",
  "on",
  "or",
  "should",
  "the",
  "to",
  "use",
  "uses",
  "using",
  "what",
  "where",
  "which",
  "why",
  "with",
]);

function stemQueryTerm(term: string): string {
  if (term === "cookies") {
    return "cookie";
  }
  if (term === "prefixes") {
    return "prefix";
  }
  if (term.length > 5 && term.endsWith("ies")) {
    return `${term.slice(0, -3)}y`;
  }
  if (term.length > 5 && term.endsWith("ing")) {
    return term.slice(0, -3);
  }
  if (term.length > 4 && term.endsWith("ed")) {
    return term.slice(0, -2);
  }
  if (term.length > 4 && term.endsWith("s")) {
    return term.slice(0, -1);
  }
  return term;
}

function normalizeSearchText(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_./:-]+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function camelCasePhrase(value: string): string {
  const parts = value.split(/\s+/).filter(Boolean);
  return parts
    .map((part, index) => (index === 0 ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join("");
}

function sourceKindBoost(sourcePaths: readonly string[], plan: GraphRagQueryPlan): number {
  const joined = sourcePaths.join(" ");
  let score = 0;

  if (/packages\/[^/]+\/src\//.test(joined)) {
    score += 1.25;
  }
  if (/\/(?:api|plugins|adapters|db|oauth2|cookies|integrations)\//.test(joined)) {
    score += 0.72;
  }
  if (/packages\/cli\/src\//.test(joined)) {
    score += 0.72;
  }
  if (/packages\/[^/]+\/src\/cookies\//.test(joined)) {
    score += 2.6;
  }
  if (/packages\/[^/]+\/src\/client\/plugins\//.test(joined)) {
    score += 2.6;
  }
  if (/\.github\//.test(joined)) {
    score -= 4.5;
  }
  if (
    joined.endsWith("package.json") &&
    (plan.scope === "flow" || plan.intent === "impact" || plan.intent === "why")
  ) {
    score -= 2.2;
  }
  if (/\.(?:test|spec)\.[tj]sx?$|\/test\//.test(joined)) {
    score -= 1.15;
  }
  if (
    /docs\/content\//.test(joined) &&
    (plan.scope === "flow" || plan.intent === "impact" || plan.intent === "where")
  ) {
    score -= 0.72;
  }
  if (/examples\//.test(joined) && (plan.scope === "flow" || plan.intent === "where")) {
    score -= 2.4;
  }
  if (/demo\//.test(joined) && (plan.scope === "flow" || plan.intent === "where")) {
    score -= 2.1;
  }

  return score;
}

function textUnitTitle(textUnit: TextUnit): string {
  const sourcePath = sourcePathsFromAttributes(textUnit.attributes)[0];
  return sourcePath ?? textUnit.humanReadableId?.toString() ?? textUnit.id;
}

function entityIdsForRelationship(relationship: Relationship): string[] {
  return [
    typeof relationship.attributes?.sourceEntityId === "string"
      ? relationship.attributes.sourceEntityId
      : "",
    typeof relationship.attributes?.targetEntityId === "string"
      ? relationship.attributes.targetEntityId
      : "",
  ].filter(Boolean);
}

function cloneMutableHit(hit: MutableSearchHit): MutableSearchHit {
  return {
    id: hit.id,
    kind: hit.kind,
    title: hit.title,
    score: hit.score,
    text: hit.text,
    channels: new Set(hit.channels),
    sourcePaths: new Set(hit.sourcePaths),
    entityIds: new Set(hit.entityIds),
    relationshipIds: new Set(hit.relationshipIds),
  };
}

function buildCitations(hits: ReadonlyArray<Omit<GraphRagSearchHit, "citationIds">>): {
  citations: GraphRagCitation[];
  citationIdsByHitId: Map<string, string[]>;
} {
  const seeds = new Map<string, CitationSeed>();
  const hitKeyToCitationKey = new Map<string, string>();
  for (const hit of hits) {
    const key = hit.sourcePaths.length > 0 ? hit.sourcePaths.join("|") : `${hit.kind}:${hit.id}`;
    hitKeyToCitationKey.set(hit.id, key);
    const existing = seeds.get(key);
    const seed = existing ?? {
      title: hit.sourcePaths[0] ?? hit.title,
      sourcePaths: new Set(hit.sourcePaths),
      snippets: [],
      hitIds: new Set(),
      entityIds: new Set(),
      relationshipIds: new Set(),
    };
    seed.hitIds.add(hit.id);
    for (const sourcePath of hit.sourcePaths) seed.sourcePaths.add(sourcePath);
    for (const entityId of hit.entityIds) seed.entityIds.add(entityId);
    for (const relationshipId of hit.relationshipIds) seed.relationshipIds.add(relationshipId);
    if (hit.text && seed.snippets.length < 3) {
      seed.snippets.push(truncate(hit.text, 700));
    }
    seeds.set(key, seed);
  }

  const citationIdsByKey = new Map<string, string>();
  const citations = Array.from(seeds.entries()).map(([key, seed], index) => {
    const id = `S${index + 1}`;
    citationIdsByKey.set(key, id);
    return {
      id,
      title: seed.title,
      sourcePaths: sortedStrings(seed.sourcePaths),
      snippets: seed.snippets,
      hitIds: sortedStrings(seed.hitIds),
      entityIds: sortedStrings(seed.entityIds),
      relationshipIds: sortedStrings(seed.relationshipIds),
    };
  });

  const citationIdsByHitId = new Map<string, string[]>();
  for (const [hitId, key] of hitKeyToCitationKey) {
    const citationId = citationIdsByKey.get(key);
    if (citationId) {
      citationIdsByHitId.set(hitId, [citationId]);
    }
  }

  return { citations, citationIdsByHitId };
}

function buildDashboardContext(
  hits: readonly GraphRagSearchHit[],
  citations: readonly GraphRagCitation[],
  maxChars: number,
): string {
  const citationById = new Map(citations.map((citation) => [citation.id, citation]));
  const blocks = hits.map((hit, index) => {
    const citationLabels =
      hit.citationIds.length > 0 ? hit.citationIds.map((id) => `[${id}]`).join(" ") : "[uncited]";
    const sourcePaths = hit.citationIds
      .flatMap((id) => citationById.get(id)?.sourcePaths ?? [])
      .slice(0, 4);
    const sources = sourcePaths.length > 0 ? `\nSources: ${sourcePaths.join(", ")}` : "";
    return [
      `${index + 1}. ${citationLabels} ${hit.kind} ${hit.title} (${hit.score})`,
      hit.text,
      sources,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return truncate(blocks.join("\n\n"), Math.max(1_000, maxChars));
}

function buildGraphSelection(
  snapshot: GraphRagSnapshot,
  hits: readonly GraphRagSearchHit[],
  options: GraphRagSearchOptions,
): GraphRagGraphSelection {
  const entityIds = new Set<string>();
  const relationshipIds = new Set<string>();
  const textUnitIds = new Set<string>();
  const communityIds = new Set<string>();
  const entityById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const relationshipById = new Map(
    snapshot.relationships.map((relationship) => [relationship.id, relationship]),
  );
  const maxEntities = boundedCount(options.maxGraphEntities, 64);
  const maxRelationships = boundedCount(options.maxGraphRelationships, 96);
  const maxTextUnits = boundedCount(options.maxGraphTextUnits, 24);

  for (const hit of hits) {
    if (hit.kind === "text_unit") {
      textUnitIds.add(hit.id);
    }
    if (hit.kind === "relationship") {
      relationshipIds.add(hit.id);
    }
    for (const entityId of rankEntityIds(hit.entityIds, entityById).slice(0, 16)) {
      entityIds.add(entityId);
      for (const communityId of entityById.get(entityId)?.communityIds ?? []) {
        communityIds.add(communityId);
      }
    }
    for (const relationshipId of rankRelationshipIds(hit.relationshipIds, relationshipById).slice(
      0,
      24,
    )) {
      relationshipIds.add(relationshipId);
    }
  }

  return {
    entityIds: rankEntityIds(sortedStrings(entityIds), entityById).slice(0, maxEntities),
    relationshipIds: rankRelationshipIds(sortedStrings(relationshipIds), relationshipById).slice(
      0,
      maxRelationships,
    ),
    textUnitIds: sortedStrings(textUnitIds).slice(0, maxTextUnits),
    communityIds: sortedStrings(communityIds),
  };
}

function buildAnswerMessages(
  query: string,
  search: GraphRagSearchResult,
  options: GraphRagAskOptions,
): ChatMessage[] {
  const style = options.responseStyle ?? "a concise dashboard-ready answer with citations";
  const extra = options.systemPrompt ? `\n\nAdditional instruction:\n${options.systemPrompt}` : "";
  return [
    {
      role: "system",
      content: [
        "You are a GraphRAG answer engine.",
        "Answer only from the supplied graph context.",
        "Cite evidence with bracketed citation ids like [S1].",
        "If the context is insufficient, say what is missing instead of guessing.",
        extra,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      role: "user",
      content: [
        `Question:\n${query}`,
        `Question plan:\n${summarizeGraphRagQueryPlan(search.plan)}`,
        `Response style:\n${style}`,
        `Graph context:\n${search.context}`,
        `Available citations:\n${search.citations.map((citation) => `${citation.id}: ${citation.title} (${citation.sourcePaths.join(", ") || "no source path"})`).join("\n")}`,
      ].join("\n\n"),
    },
  ];
}

function buildExtractiveAnswer(search: GraphRagSearchResult): string {
  if (search.hits.length === 0) {
    return "I could not find enough graph evidence to answer that from the current index.";
  }

  const terms = importantQueryTerms(search.query);
  const topHits = search.hits.slice(0, 6).map((hit) => {
    const citation =
      hit.citationIds.length > 0 ? ` ${hit.citationIds.map((id) => `[${id}]`).join(" ")}` : "";
    const source = hit.sourcePaths[0] ?? hit.title;
    const channels = hit.channels.length > 0 ? ` via ${hit.channels.join("+")}` : "";
    return `- ${source}${channels}: ${relevantEvidenceSnippet(hit.text, terms, 360)}${citation}`;
  });
  return [
    `Found ${search.hits.length} relevant GraphRAG result${search.hits.length === 1 ? "" : "s"} for "${search.query}".`,
    `Plan: ${summarizeGraphRagQueryPlan(search.plan)}.`,
    "Strongest evidence:",
    ...topHits,
  ].join("\n");
}

function chatOptions(options: GraphRagAskOptions): ChatOptions {
  return {
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
  };
}

function sourcePathsFromAttributes(attributes: JsonObject | null | undefined): string[] {
  if (!attributes) {
    return [];
  }

  const sourcePath = typeof attributes.sourcePath === "string" ? [attributes.sourcePath] : [];
  return Array.from(
    new Set([
      ...arrayOfStrings(attributes.sourcePaths),
      ...arrayOfStrings(attributes.evidenceFiles),
      ...sourcePath,
    ]),
  );
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultLimit;
  }
  return Math.max(1, Math.min(Math.floor(value), 50));
}

function channelRank(channels: readonly GraphRagHitChannel[]): number {
  if (channels.includes("reference")) return 5;
  if (channels.includes("vector")) return 3;
  if (channels.includes("neighbor")) return 2.4;
  if (channels.includes("graph")) return 2;
  if (channels.includes("lexical")) return 1;
  return 0;
}

function rankEntityIds(ids: readonly string[], entityById: ReadonlyMap<string, Entity>): string[] {
  return [...ids].sort((left, right) => {
    const leftEntity = entityById.get(left);
    const rightEntity = entityById.get(right);
    const leftScore = Number(leftEntity?.rank ?? 0) + Number(leftEntity?.degree ?? 0) * 0.08;
    const rightScore = Number(rightEntity?.rank ?? 0) + Number(rightEntity?.degree ?? 0) * 0.08;
    return (
      rightScore - leftScore ||
      (leftEntity?.title ?? left).localeCompare(rightEntity?.title ?? right)
    );
  });
}

function rankRelationshipIds(
  ids: readonly string[],
  relationshipById: ReadonlyMap<string, Relationship>,
): string[] {
  return [...ids].sort((left, right) => {
    const leftRelationship = relationshipById.get(left);
    const rightRelationship = relationshipById.get(right);
    const leftScore =
      Number(leftRelationship?.rank ?? 0) +
      Number(leftRelationship?.weight ?? 0) +
      Number(leftRelationship?.combinedDegree ?? 0) * 0.04;
    const rightScore =
      Number(rightRelationship?.rank ?? 0) +
      Number(rightRelationship?.weight ?? 0) +
      Number(rightRelationship?.combinedDegree ?? 0) * 0.04;
    const leftTitle = leftRelationship
      ? `${leftRelationship.source} ${leftRelationship.target}`
      : left;
    const rightTitle = rightRelationship
      ? `${rightRelationship.source} ${rightRelationship.target}`
      : right;
    return rightScore - leftScore || leftTitle.localeCompare(rightTitle);
  });
}

function boundedCount(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.floor(value), 300));
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, Math.max(0, length - 3))}...` : value;
}

function evidenceSnippet(text: string, length: number): string {
  const cleaned = text
    .replace(/^File:\s*.+?\nKind:\s*.+?\nBytes:\s*\d+\n+/s, "")
    .replace(/\[truncated\]\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(cleaned || text.replace(/\s+/g, " ").trim(), length);
}

function relevantEvidenceSnippet(text: string, terms: readonly string[], length: number): string {
  const cleaned = text
    .replace(/^File:\s*.+?\nKind:\s*.+?\nBytes:\s*\d+\n+/s, "")
    .replace(/\[truncated\]\s*$/i, "")
    .trim();
  const lines = cleaned
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const normalizedTerms = terms.map(normalizeSearchText).filter(Boolean);
  const scored = lines
    .map((line, index) => ({
      line,
      index,
      score: normalizedTerms.filter((term) => normalizeSearchText(line).includes(term)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 3)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.line);

  if (scored.length === 0) {
    return evidenceSnippet(cleaned, length);
  }

  return truncate(scored.join(" / "), length);
}

function roundScore(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function sortedStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}
