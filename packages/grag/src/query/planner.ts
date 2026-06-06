export type GraphRagQueryIntent =
  | "what"
  | "how"
  | "where"
  | "why"
  | "impact"
  | "debug"
  | "build"
  | "global"
  | "unknown";

export type GraphRagQueryScope = "node" | "local" | "flow" | "global";

export type GraphRagQueryEntityKind = "path" | "route" | "env" | "symbol" | "package";

export interface GraphRagQueryEntity {
  kind: GraphRagQueryEntityKind;
  value: string;
  confidence: number;
}

export interface GraphRagQuerySearchFocus {
  includeTextSearch: boolean;
  graphLimitMultiplier: number;
  textLimitMultiplier: number;
  maxContextChars: number;
  preferCommunityReports: boolean;
}

export interface GraphRagQueryPlan {
  intent: GraphRagQueryIntent;
  scope: GraphRagQueryScope;
  entities: GraphRagQueryEntity[];
  searchFocus: GraphRagQuerySearchFocus;
  steps: string[];
}

const STOPWORDS = new Set([
  "about",
  "add",
  "agent",
  "all",
  "and",
  "answer",
  "api",
  "apis",
  "are",
  "ask",
  "base",
  "based",
  "build",
  "can",
  "code",
  "codebase",
  "could",
  "crud",
  "debug",
  "does",
  "explain",
  "feature",
  "file",
  "find",
  "for",
  "from",
  "graph",
  "grag",
  "help",
  "how",
  "implemented",
  "into",
  "like",
  "local",
  "module",
  "move",
  "need",
  "node",
  "please",
  "repo",
  "repository",
  "route",
  "search",
  "service",
  "sdk",
  "smart",
  "source",
  "the",
  "this",
  "trace",
  "use",
  "uses",
  "using",
  "what",
  "where",
  "which",
  "why",
  "with",
]);

const COMMON_NON_ENV_TOKENS = new Set([
  "AI",
  "API",
  "APIS",
  "CLI",
  "CRUD",
  "CSS",
  "DOM",
  "HTML",
  "HTTP",
  "HTTPS",
  "ID",
  "JSON",
  "LLM",
  "MDX",
  "RAG",
  "SDK",
  "SQL",
  "SVG",
  "TS",
  "TSX",
  "UI",
  "URL",
  "UUID",
  "XML",
  "YAML",
]);

const FILE_REFERENCE_PATTERN =
  /(?:^|[\s("'`])([@a-zA-Z0-9_.-]+(?:\/[@a-zA-Z0-9_.-]+)+\.(?:cjs|css|go|html|java|js|jsx|json|md|mdx|mjs|php|prisma|py|rb|rs|scss|sql|toml|ts|tsx|yaml|yml))(?:[:#][a-zA-Z0-9_.-]+)?/g;
const ROUTE_PATTERN = /(?:^|\s)(\/(?:api\/)?[a-zA-Z0-9_./:[\]-]{2,})(?=$|\s|[),.])/g;
const ENV_PATTERN = /\b[A-Z][A-Z0-9_]{2,}\b/g;
const PACKAGE_PATTERN =
  /(?:^|\s)(@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)(?=$|\s|[),.])/g;
const BACKTICK_PATTERN = /`([^`]{2,120})`/g;
const SYMBOL_PATTERN = /\b[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?\b/g;

export function planGraphRagQuery(query: string): GraphRagQueryPlan {
  const normalized = normalizeWhitespace(query);
  const intent = classifyIntent(normalized);
  const entities = extractQueryEntities(normalized);
  const scope = inferScope(intent, entities);
  const searchFocus = searchFocusFor(intent, scope);

  return {
    intent,
    scope,
    entities,
    searchFocus,
    steps: buildPlanSteps(intent, scope, entities, searchFocus),
  };
}

export function summarizeGraphRagQueryPlan(plan: GraphRagQueryPlan): string {
  const entities = plan.entities.length
    ? plan.entities.map((entity) => `${entity.kind}:${entity.value}`).join(", ")
    : "none";

  return [
    `intent=${plan.intent}`,
    `scope=${plan.scope}`,
    `entities=${entities}`,
    `includeTextSearch=${plan.searchFocus.includeTextSearch}`,
    `preferCommunityReports=${plan.searchFocus.preferCommunityReports}`,
  ].join("; ");
}

function classifyIntent(query: string): GraphRagQueryIntent {
  const lower = query.toLowerCase();

  if (
    /\b(stack\s*trace|exception|crash|bug|broken|failing|failed|error|root cause|race condition|memory leak|null pointer)\b/.test(
      lower,
    )
  ) {
    return "debug";
  }

  if (
    /\b(impact|blast radius|depends on|dependency|dependencies|downstream|upstream|affected|what breaks|callers|called by|likely impacted|if .+ changes?)\b/.test(
      lower,
    )
  ) {
    return "impact";
  }

  if (
    /^\s*(where|which file|which module|find|locate)\b/.test(lower) ||
    /\b(defined|definition|usage|usages|lives|located)\b/.test(lower)
  ) {
    return "where";
  }

  if (
    /^\s*why\b/.test(lower) ||
    /\b(rationale|reason|decision|tradeoff|why was|why is)\b/.test(lower)
  ) {
    return "why";
  }

  if (
    /^\s*(how|explain)\b/.test(lower) ||
    /\b(what happens|flow|works|implemented|execution|lifecycle|call chain|control flow|data flow|command runs?|decides whether)\b/.test(
      lower,
    )
  ) {
    return "how";
  }

  if (/\b(add|build|create|implement|modify|change|generate|write|refactor)\b/.test(lower)) {
    return "build";
  }

  if (
    /\b(overview|summarize|summary|architecture|major concepts|themes|whole repo|entire repo|system design)\b/.test(
      lower,
    )
  ) {
    return "global";
  }

  if (/^\s*what\b/.test(lower) || /\b(what does|what is|explain)\b/.test(lower)) {
    return "what";
  }

  return "unknown";
}

function inferScope(
  intent: GraphRagQueryIntent,
  entities: readonly GraphRagQueryEntity[],
): GraphRagQueryScope {
  if (intent === "global") {
    return "global";
  }

  if (intent === "how" || intent === "impact" || intent === "debug" || intent === "build") {
    return "flow";
  }

  if (
    intent === "where" ||
    entities.some((entity) => entity.kind === "path" || entity.kind === "symbol")
  ) {
    return "node";
  }

  return "local";
}

function searchFocusFor(
  intent: GraphRagQueryIntent,
  scope: GraphRagQueryScope,
): GraphRagQuerySearchFocus {
  if (scope === "global") {
    return {
      includeTextSearch: true,
      graphLimitMultiplier: 1.8,
      textLimitMultiplier: 0.8,
      maxContextChars: 16_000,
      preferCommunityReports: true,
    };
  }

  if (intent === "impact" || intent === "debug" || intent === "build") {
    return {
      includeTextSearch: true,
      graphLimitMultiplier: 2.2,
      textLimitMultiplier: 1.1,
      maxContextChars: 18_000,
      preferCommunityReports: false,
    };
  }

  if (intent === "where") {
    return {
      includeTextSearch: true,
      graphLimitMultiplier: 1.6,
      textLimitMultiplier: 1.4,
      maxContextChars: 12_000,
      preferCommunityReports: false,
    };
  }

  if (intent === "why") {
    return {
      includeTextSearch: true,
      graphLimitMultiplier: 1.5,
      textLimitMultiplier: 1,
      maxContextChars: 14_000,
      preferCommunityReports: true,
    };
  }

  return {
    includeTextSearch: true,
    graphLimitMultiplier: scope === "flow" ? 1.8 : 1.2,
    textLimitMultiplier: 1.2,
    maxContextChars: 12_000,
    preferCommunityReports: false,
  };
}

function buildPlanSteps(
  intent: GraphRagQueryIntent,
  scope: GraphRagQueryScope,
  entities: readonly GraphRagQueryEntity[],
  searchFocus: GraphRagQuerySearchFocus,
): string[] {
  const steps = [
    `Classify the question as ${intent}/${scope}.`,
    entities.length > 0
      ? `Resolve explicit references: ${entities.map((entity) => `${entity.kind}:${entity.value}`).join(", ")}.`
      : "Search broadly for relevant graph nodes and text units.",
    searchFocus.preferCommunityReports
      ? "Include community reports for high-level synthesis."
      : "Prefer local entities, relationships, and source text.",
    searchFocus.includeTextSearch
      ? "Run direct text-unit search beside graph retrieval."
      : "Use graph retrieval only.",
    "Merge hits, build citations, and return graph highlights.",
  ];

  return steps;
}

function extractQueryEntities(query: string): GraphRagQueryEntity[] {
  const entities: GraphRagQueryEntity[] = [];
  addRegexEntities(entities, query, FILE_REFERENCE_PATTERN, "path", 0.98);
  addRegexEntities(entities, query, ROUTE_PATTERN, "route", 0.92);
  addRegexEntities(entities, query, ENV_PATTERN, "env", 0.9);
  addRegexEntities(entities, query, PACKAGE_PATTERN, "package", 0.78);

  for (const match of query.matchAll(BACKTICK_PATTERN)) {
    const value = normalizeEntityValue(match[1] ?? "");
    if (!value) {
      continue;
    }

    if (value.includes("/") && value.includes(".")) {
      addEntity(entities, "path", value, 0.99);
    } else if (value.startsWith("/")) {
      addEntity(entities, "route", value, 0.96);
    } else if (/^[A-Z][A-Z0-9_]{2,}$/.test(value) && !COMMON_NON_ENV_TOKENS.has(value)) {
      addEntity(entities, "env", value, 0.94);
    } else if (looksLikeSymbol(value)) {
      addEntity(entities, "symbol", value, 0.88);
    }
  }

  for (const match of query.matchAll(SYMBOL_PATTERN)) {
    const value = normalizeEntityValue(match[0] ?? "");
    if (looksLikeSymbol(value)) {
      addEntity(entities, "symbol", value, symbolConfidence(value));
    }
  }

  return entities.sort((left, right) => right.confidence - left.confidence).slice(0, 12);
}

function addRegexEntities(
  entities: GraphRagQueryEntity[],
  query: string,
  pattern: RegExp,
  kind: GraphRagQueryEntityKind,
  confidence: number,
): void {
  for (const match of query.matchAll(pattern)) {
    const value = normalizeEntityValue(match[1] ?? match[0] ?? "");
    if (kind === "env" && COMMON_NON_ENV_TOKENS.has(value)) {
      continue;
    }
    if (value) {
      addEntity(entities, kind, value, confidence);
    }
  }
}

function addEntity(
  entities: GraphRagQueryEntity[],
  kind: GraphRagQueryEntityKind,
  value: string,
  confidence: number,
): void {
  const key = `${kind}:${value.toLowerCase()}`;
  const existing = entities.find(
    (entity) => `${entity.kind}:${entity.value.toLowerCase()}` === key,
  );
  if (existing) {
    existing.confidence = Math.max(existing.confidence, confidence);
    return;
  }

  entities.push({
    kind,
    value,
    confidence: round(confidence),
  });
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeEntityValue(value: string): string {
  return value
    .trim()
    .replace(/^[("'`\s]+/, "")
    .replace(/[),.:"'`\s]+$/, "");
}

function looksLikeSymbol(value: string): boolean {
  if (value.length < 3 || value.length > 80 || STOPWORDS.has(value.toLowerCase())) {
    return false;
  }

  if (COMMON_NON_ENV_TOKENS.has(value.toUpperCase())) {
    return false;
  }

  if (value.includes(".")) {
    return value.split(".").every((part) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part));
  }

  return (
    /^[A-Z][A-Za-z0-9_$]*$/.test(value) ||
    /[a-z][A-Z]/.test(value) ||
    /^[a-z]+[A-Z][A-Za-z0-9_$]*$/.test(value)
  );
}

function symbolConfidence(value: string): number {
  if (value.includes(".")) {
    return 0.84;
  }

  if (/^[A-Z][A-Z0-9_]+$/.test(value)) {
    return 0.72;
  }

  return /^[A-Z]/.test(value) ? 0.76 : 0.7;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
