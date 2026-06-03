import type {
  Community,
  CommunityReport,
  Entity,
  GraphRagDocument,
  GraphRagSnapshot,
  JsonObject,
  Relationship,
  TextUnit
} from "../model.js";

export interface BuildDocumentGraphOptions {
  title?: string;
  sourcePath?: string;
  maxEntities?: number;
  maxRelationships?: number;
}

export interface DocumentGraphExtractionTextUnit {
  title: string;
  text: string;
}

export interface DocumentGraphExtractionEntity {
  title: string;
  type: string;
  description: string;
  textUnitIndexes: number[];
}

export interface DocumentGraphExtractionRelationship {
  sourceTitle: string;
  targetTitle: string;
  description: string;
  weight: number;
  textUnitIndexes: number[];
}

export interface DocumentGraphExtractionCommunity {
  title: string;
  summary: string;
  entityTitles: string[];
}

export interface DocumentGraphExtraction {
  title: string;
  summary: string;
  textUnits: DocumentGraphExtractionTextUnit[];
  entities: DocumentGraphExtractionEntity[];
  relationships: DocumentGraphExtractionRelationship[];
  communities: DocumentGraphExtractionCommunity[];
  suggestedQueries: string[];
}

export interface BuildExtractedDocumentGraphOptions {
  title?: string;
  sourcePath?: string;
  sourceText?: string;
  generatedBy?: string;
}

interface Candidate {
  title: string;
  key: string;
  score: number;
  frequency: number;
}

interface CommunityBucket {
  id: string;
  title: string;
  community: number;
}

const EXAMPLE_SUPPORT_DOCUMENT = `# Support GraphRAG Playbook

The docs platform support system ingests markdown guides, API reference pages, incident runbooks, release notes, and customer ticket exports. The ingestion pipeline chunks documents, preserves source paths, and sends each text unit into entity extraction.

Graph indexing creates entities for services, packages, owners, features, failure modes, and database tables. Relationships connect @farming-labs/grag, @farming-labs/orm, Postgres, pgvector, Studio, CLI preview, retrieval context, citations, and support workflows.

Relational storage keeps documents, text units, entities, relationships, communities, reports, covariates, and embeddings in normalized tables. @farming-labs/orm adapts the storage layer to Postgres, SQLite, MySQL, and other SQL engines while keeping the GraphRAG snapshot shape stable.

Hybrid retrieval starts with a user question, runs lexical search and vector recall, expands through nearby graph relationships, reads community reports, and builds cited context. Local search answers focused questions about a ticket or page. Global search summarizes a community such as storage, retrieval, or documentation operations.

Studio lets maintainers upload a document, inspect generated entities, drag graph nodes, select relationships, filter communities, and run retrieval queries. The support team uses this to understand why a customer cannot deploy the docs platform, which table owns the missing embedding, and which package should be fixed.

Operational workflows include nightly indexing, pull request previews, migration checks, stale embedding cleanup, and incident investigation. When retrieval misses an answer, the graph highlights missing source coverage so the team can add docs or improve extraction.`;

const stopWords = new Set([
  "about",
  "after",
  "also",
  "and",
  "another",
  "are",
  "because",
  "been",
  "before",
  "being",
  "between",
  "both",
  "but",
  "can",
  "cannot",
  "could",
  "each",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "into",
  "its",
  "may",
  "more",
  "most",
  "not",
  "other",
  "our",
  "should",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "this",
  "through",
  "use",
  "used",
  "uses",
  "using",
  "was",
  "were",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "your"
]);

const knownTerms = [
  "@farming-labs/grag",
  "@farming-labs/orm",
  "api reference",
  "citation builder",
  "cli preview",
  "community report",
  "database table",
  "docs platform",
  "embedding",
  "entity extraction",
  "global search",
  "graph expansion",
  "graph indexing",
  "hybrid retrieval",
  "incident investigation",
  "ingestion pipeline",
  "kysely",
  "lexical search",
  "local search",
  "markdown",
  "migration",
  "mysql",
  "normalized tables",
  "pgvector",
  "postgres",
  "pull request preview",
  "relational storage",
  "retrieval context",
  "sqlite",
  "studio",
  "support workflow",
  "text unit",
  "vector recall"
];

const communityBuckets: CommunityBucket[] = [
  { id: "community-ingestion", title: "Ingestion Pipeline", community: 0 },
  { id: "community-graph", title: "Graph Model", community: 1 },
  { id: "community-retrieval", title: "Retrieval Flow", community: 2 },
  { id: "community-storage", title: "Relational Storage", community: 3 },
  { id: "community-studio", title: "Studio Interface", community: 4 },
  { id: "community-support", title: "Support Operations", community: 5 },
  { id: "community-concepts", title: "Document Concepts", community: 6 }
];

export function exampleSupportDocument(): string {
  return EXAMPLE_SUPPORT_DOCUMENT;
}

export function buildGraphRagSnapshotFromExtraction(
  extraction: DocumentGraphExtraction,
  options: BuildExtractedDocumentGraphOptions = {}
): GraphRagSnapshot {
  const title = cleanEntityTitle(options.title || extraction.title || "Uploaded document");
  const sourcePath = options.sourcePath?.trim() || title;
  const generatedBy = options.generatedBy ?? "@farming-labs/grag/openai";
  const extractedTextUnits = extraction.textUnits
    .filter((unit) => unit.text.trim().length > 0)
    .slice(0, 80);
  const textUnits = extractedTextUnits.length > 0
    ? extractedTextUnits.map((unit, index): TextUnit => ({
      id: `tu-${index + 1}`,
      humanReadableId: unit.title.trim() || `${sourcePath}#${index + 1}`,
      text: normalizeWhitespace(unit.text),
      entityIds: [],
      relationshipIds: [],
      covariateIds: [],
      nTokens: tokenize(unit.text).length,
      documentId: "doc-uploaded",
      attributes: {
        sourcePath,
        section: index + 1,
        generatedBy
      }
    }))
    : createTextUnits(options.sourceText || extraction.summary || title, sourcePath);
  const communityIdByEntityKey = new Map<string, string>();
  extraction.communities.slice(0, 24).forEach((community, index) => {
    const communityId = `community-ai-${slugify(community.title) || index + 1}`;
    for (const entityTitle of community.entityTitles) {
      communityIdByEntityKey.set(normalizeKey(entityTitle), communityId);
    }
  });
  const entityMap = new Map<string, Entity>();

  extraction.entities.slice(0, 80).forEach((entity, index) => {
    const cleanTitle = cleanEntityTitle(entity.title);
    if (!isUsefulPhrase(cleanTitle)) {
      return;
    }

    const key = normalizeKey(cleanTitle);
    if (entityMap.has(key)) {
      return;
    }

    const type = cleanEntityTitle(entity.type || classifyType(cleanTitle)) || "Concept";
    const fallbackCommunity = communityForType(type);
    const communityId = communityIdByEntityKey.get(key) ?? fallbackCommunity.id;
    const textUnitIds = indexedTextUnitIds(entity.textUnitIndexes, textUnits);
    entityMap.set(key, {
      id: `ent-${slugify(cleanTitle) || index + 1}`,
      humanReadableId: cleanTitle,
      title: cleanTitle,
      type,
      description: entity.description.trim() || describeEntity(cleanTitle, type, textUnits),
      communityIds: [communityId],
      textUnitIds,
      frequency: Math.max(1, textUnitIds.length),
      degree: 0,
      rank: Math.max(1, textUnitIds.length + 1),
      attributes: {
        sourcePath,
        sourcePaths: [sourcePath],
        extraction: "openai-document-upload",
        generatedBy
      }
    });
  });

  if (entityMap.size === 0) {
    return buildDocumentGraphRagSnapshot(options.sourceText || extraction.summary || title, {
      title,
      sourcePath
    });
  }

  const entities = Array.from(entityMap.values());
  const entityByKey = new Map(entities.map((entity) => [normalizeKey(entity.title), entity]));
  const relationships: Relationship[] = extraction.relationships
    .slice(0, 160)
    .flatMap((relationship, index) => {
      const source = entityByKey.get(normalizeKey(relationship.sourceTitle));
      const target = entityByKey.get(normalizeKey(relationship.targetTitle));
      if (!source || !target || source.id === target.id) {
        return [];
      }

      const textUnitIds = indexedTextUnitIds(relationship.textUnitIndexes, textUnits);
      const attributes: JsonObject = {
        sourceEntityId: source.id,
        targetEntityId: target.id,
        sourcePath,
        sourcePaths: [sourcePath],
        generatedBy
      };
      return [{
        id: `rel-ai-${index + 1}`,
        humanReadableId: `${source.title} -> ${target.title}`,
        source: source.title,
        target: target.title,
        description: relationship.description.trim() || `${source.title} is related to ${target.title}.`,
        weight: Math.max(1, Math.round(Number(relationship.weight || 1) * 100) / 100),
        combinedDegree: textUnitIds.length,
        rank: Math.max(1, Number(relationship.weight || 1)),
        textUnitIds,
        attributes
      }];
    });

  for (const relationship of relationships) {
    const sourceId = typeof relationship.attributes?.sourceEntityId === "string" ? relationship.attributes.sourceEntityId : "";
    const targetId = typeof relationship.attributes?.targetEntityId === "string" ? relationship.attributes.targetEntityId : "";
    const source = entities.find((entity) => entity.id === sourceId);
    const target = entities.find((entity) => entity.id === targetId);
    if (source) {
      source.degree = (source.degree ?? 0) + 1;
    }
    if (target) {
      target.degree = (target.degree ?? 0) + 1;
    }
  }

  for (const textUnit of textUnits) {
    textUnit.entityIds = entities
      .filter((entity) => entity.textUnitIds.includes(textUnit.id) || textContainsTerm(textUnit.text, entity.title))
      .map((entity) => entity.id);
    textUnit.relationshipIds = relationships
      .filter((relationship) => relationship.textUnitIds.includes(textUnit.id))
      .map((relationship) => relationship.id);
  }

  const communities = createExtractedCommunities(extraction.communities, entities, relationships, textUnits, generatedBy);
  const communityReports = createExtractedCommunityReports(extraction.communities, communities, entities, relationships, textUnits, generatedBy);
  const documentText = normalizeWhitespace(options.sourceText || textUnits.map((unit) => unit.text).join("\n\n"));
  const document: GraphRagDocument = {
    id: "doc-uploaded",
    humanReadableId: sourcePath,
    title,
    type: "file",
    text: documentText,
    textUnitIds: textUnits.map((unit) => unit.id),
    attributes: {
      sourcePath,
      generatedBy,
      summary: extraction.summary
    }
  };

  return {
    documents: [document],
    textUnits,
    entities,
    relationships,
    covariates: [],
    communities,
    communityReports,
    embeddings: []
  };
}

export function buildDocumentGraphRagSnapshot(
  text: string,
  options: BuildDocumentGraphOptions = {}
): GraphRagSnapshot {
  const cleanText = normalizeWhitespace(text);
  const title = options.title?.trim() || inferTitle(cleanText) || "Uploaded document";
  const sourcePath = options.sourcePath?.trim() || title;
  const textUnits = createTextUnits(cleanText, sourcePath);
  const candidates = extractCandidates(cleanText, textUnits)
    .slice(0, Math.max(8, Math.min(options.maxEntities ?? 36, 80)));
  const entities = createEntities(candidates, textUnits, sourcePath);
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const relationships = createRelationships(
    entities,
    textUnits,
    Math.max(8, Math.min(options.maxRelationships ?? 72, 160)),
    sourcePath
  );

  for (const relationship of relationships) {
    const sourceId = typeof relationship.attributes?.sourceEntityId === "string"
      ? relationship.attributes.sourceEntityId
      : "";
    const targetId = typeof relationship.attributes?.targetEntityId === "string"
      ? relationship.attributes.targetEntityId
      : "";
    const source = entityById.get(sourceId);
    const target = entityById.get(targetId);
    if (source) {
      source.degree = (source.degree ?? 0) + 1;
    }
    if (target) {
      target.degree = (target.degree ?? 0) + 1;
    }
  }

  const communities = createCommunities(entities, relationships, textUnits);
  const communityReports = createCommunityReports(communities, entities, relationships, textUnits);
  const document: GraphRagDocument = {
    id: "doc-uploaded",
    humanReadableId: sourcePath,
    title,
    type: "text",
    text: cleanText,
    textUnitIds: textUnits.map((unit) => unit.id),
    attributes: {
      sourcePath,
      generatedBy: "@farming-labs/grag/studio"
    }
  };

  return {
    documents: [document],
    textUnits,
    entities,
    relationships,
    covariates: [],
    communities,
    communityReports,
    embeddings: []
  };
}

function indexedTextUnitIds(indexes: number[], textUnits: TextUnit[]): string[] {
  return Array.from(new Set(indexes
    .filter((index) => Number.isInteger(index) && index >= 0 && index < textUnits.length)
    .map((index) => textUnits[index]?.id)
    .filter((id): id is string => Boolean(id))));
}

function createExtractedCommunities(
  extractedCommunities: DocumentGraphExtractionCommunity[],
  entities: Entity[],
  relationships: Relationship[],
  textUnits: TextUnit[],
  generatedBy: string
): Community[] {
  const entityByKey = new Map(entities.map((entity) => [normalizeKey(entity.title), entity]));
  const communities: Community[] = extractedCommunities
    .slice(0, 24)
    .flatMap((community, index) => {
      const entityIds = Array.from(new Set(community.entityTitles
        .map((title) => entityByKey.get(normalizeKey(title))?.id)
        .filter((id): id is string => Boolean(id))));
      if (entityIds.length === 0) {
        return [];
      }

      const entityIdSet = new Set(entityIds);
      const relationshipIds = relationships
        .filter((relationship) => {
          const sourceId = typeof relationship.attributes?.sourceEntityId === "string" ? relationship.attributes.sourceEntityId : "";
          const targetId = typeof relationship.attributes?.targetEntityId === "string" ? relationship.attributes.targetEntityId : "";
          return entityIdSet.has(sourceId) || entityIdSet.has(targetId);
        })
        .map((relationship) => relationship.id);
      const textUnitIds = textUnits
        .filter((unit) => unit.entityIds.some((entityId) => entityIdSet.has(entityId)))
        .map((unit) => unit.id);
      const id = `community-ai-${slugify(community.title) || index + 1}`;

      for (const entity of entities) {
        if (entityIds.includes(entity.id)) {
          entity.communityIds = [id];
        }
      }

      return [{
        id,
        humanReadableId: community.title,
        title: community.title,
        community: index,
        level: 0,
        parent: null,
        children: [],
        entityIds,
        relationshipIds,
        textUnitIds,
        covariateIds: [],
        attributes: {
          generatedBy,
          summary: community.summary
        },
        size: entityIds.length
      }];
    });

  const assignedEntityIds = new Set(communities.flatMap((community) => community.entityIds));
  const unassigned = entities.filter((entity) => !assignedEntityIds.has(entity.id));
  if (unassigned.length > 0) {
    const generated = createCommunities(unassigned, relationships, textUnits);
    const offset = communities.length;
    generated.forEach((community, index) => {
      const id = community.id.startsWith("community-ai-") ? community.id : `${community.id}-${offset + index}`;
      communities.push({
        ...community,
        id,
        community: offset + index,
        attributes: {
          generatedBy
        }
      });
      for (const entity of entities) {
        if (community.entityIds.includes(entity.id)) {
          entity.communityIds = [id];
        }
      }
    });
  }

  return communities.length > 0 ? communities : createCommunities(entities, relationships, textUnits);
}

function createExtractedCommunityReports(
  extractedCommunities: DocumentGraphExtractionCommunity[],
  communities: Community[],
  entities: Entity[],
  relationships: Relationship[],
  textUnits: TextUnit[],
  generatedBy: string
): CommunityReport[] {
  const extractedByTitle = new Map(extractedCommunities.map((community) => [normalizeKey(community.title), community]));

  return createCommunityReports(communities, entities, relationships, textUnits).map((report) => {
    const extracted = extractedByTitle.get(normalizeKey(report.title.replace(/\s+report$/i, "")));
    if (!extracted) {
      return {
        ...report,
        ratingExplanation: "Generated from OpenAI-assisted document upload extraction.",
        attributes: {
          generatedBy
        }
      };
    }

    return {
      ...report,
      summary: extracted.summary || report.summary,
      fullContent: [extracted.summary, report.fullContent].filter(Boolean).join("\n\n"),
      ratingExplanation: "Generated from OpenAI-assisted document upload extraction.",
      attributes: {
        generatedBy
      }
    };
  });
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inferTitle(text: string): string {
  const heading = text.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }

  return text.split(/\n+/)[0]?.trim().slice(0, 80) ?? "";
}

function createTextUnits(text: string, sourcePath: string): TextUnit[] {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const chunks = blocks.length > 0 ? blocks : splitSentences(text);

  return chunks.slice(0, 80).map((chunk, index) => ({
    id: `tu-${index + 1}`,
    humanReadableId: `${sourcePath}#${index + 1}`,
    text: chunk,
    entityIds: [],
    relationshipIds: [],
    covariateIds: [],
    nTokens: tokenize(chunk).length,
    documentId: "doc-uploaded",
    attributes: {
      sourcePath,
      section: index + 1
    }
  }));
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[@./:_-]+/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !stopWords.has(token));
}

function extractCandidates(text: string, textUnits: TextUnit[]): Candidate[] {
  const candidates = new Map<string, Candidate>();

  for (const term of knownTerms) {
    const count = countOccurrences(text, term);
    if (count > 0) {
      addCandidate(candidates, term, count * 4, count);
    }
  }

  const phraseMatches = text.match(/@[a-z0-9][a-z0-9/_-]+|[a-z0-9]+(?:[-_/][a-z0-9]+)+|[A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3}|[a-z]+[A-Z][A-Za-z0-9]+|[a-z0-9]+(?:\.[a-z0-9]+)+/g) ?? [];
  for (const phrase of phraseMatches) {
    const normalized = phrase.replace(/^#+\s*/, "").trim();
    if (isUsefulPhrase(normalized)) {
      addCandidate(candidates, normalized, 2.4, 1);
    }
  }

  for (const unit of textUnits) {
    const words = tokenize(unit.text);
    for (let size = 1; size <= 3; size += 1) {
      for (let index = 0; index <= words.length - size; index += 1) {
        const phrase = words.slice(index, index + size).join(" ");
        if (isUsefulPhrase(phrase)) {
          addCandidate(candidates, titleCase(phrase), size === 1 ? 0.8 : 1.2 + size * 0.4, 1);
        }
      }
    }
  }

  return Array.from(candidates.values())
    .filter((candidate) => candidate.frequency > 1 || candidate.score >= 2.4 || candidate.title.includes("@"))
    .sort((left, right) => right.score - left.score || right.frequency - left.frequency || left.title.localeCompare(right.title));
}

function addCandidate(candidates: Map<string, Candidate>, title: string, score: number, frequency: number): void {
  const cleanTitle = cleanEntityTitle(title);
  if (!isUsefulPhrase(cleanTitle)) {
    return;
  }

  const key = normalizeKey(cleanTitle);
  const current = candidates.get(key);
  if (current) {
    current.score += score;
    current.frequency += frequency;
    if (cleanTitle.length > current.title.length && cleanTitle.length <= 48) {
      current.title = cleanTitle;
    }
    return;
  }

  candidates.set(key, {
    title: cleanTitle,
    key,
    score,
    frequency
  });
}

function cleanEntityTitle(value: string): string {
  return value
    .replace(/^#+\s*/, "")
    .replace(/[()[\]{}"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9@]+/g, " ").trim();
}

function isUsefulPhrase(value: string): boolean {
  const key = normalizeKey(value);
  if (!key || key.length < 3 || key.length > 64) {
    return false;
  }

  const parts = key.split(/\s+/);
  if (parts.every((part) => stopWords.has(part))) {
    return false;
  }

  if (parts.length === 1 && stopWords.has(parts[0] ?? "")) {
    return false;
  }

  return true;
}

function countOccurrences(text: string, term: string): number {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^a-z0-9@])${escaped}([^a-z0-9]|$)`, "gi");
  return [...text.matchAll(pattern)].length;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 3 || word.includes("@")) {
        return word;
      }
      return `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;
    })
    .join(" ");
}

function createEntities(candidates: Candidate[], textUnits: TextUnit[], sourcePath: string): Entity[] {
  const entities = candidates.map((candidate, index) => {
    const textUnitIds = textUnits
      .filter((unit) => textContainsTerm(unit.text, candidate.title))
      .map((unit) => unit.id);
    const type = classifyType(candidate.title);
    const community = communityForType(type);
    const description = describeEntity(candidate.title, type, textUnits);

    return {
      id: `ent-${slugify(candidate.title) || index + 1}`,
      humanReadableId: candidate.title,
      title: candidate.title,
      type,
      description,
      communityIds: [community.id],
      textUnitIds,
      frequency: candidate.frequency,
      degree: 0,
      rank: Math.round((candidate.score + textUnitIds.length) * 100) / 100,
      attributes: {
        sourcePath,
        sourcePaths: [sourcePath],
        extraction: "document-upload"
      }
    };
  });

  for (const textUnit of textUnits) {
    textUnit.entityIds = entities
      .filter((entity) => textContainsTerm(textUnit.text, entity.title))
      .map((entity) => entity.id);
  }

  return dedupeEntities(entities);
}

function dedupeEntities(entities: Entity[]): Entity[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    if (seen.has(entity.id)) {
      return false;
    }
    seen.add(entity.id);
    return true;
  });
}

function classifyType(title: string): string {
  const key = normalizeKey(title);
  if (key.includes("@") || key.includes("package") || key.includes("grag") || key.includes("orm")) {
    return "Package";
  }
  if (matchesAny(key, ["postgres", "sqlite", "mysql", "database", "relational", "table", "schema", "migration", "pgvector", "storage", "kysely"])) {
    return "Storage";
  }
  if (matchesAny(key, ["retrieval", "query", "search", "vector", "embedding", "context", "citation", "recall", "rerank"])) {
    return "Retrieval";
  }
  if (matchesAny(key, ["graph", "entity", "relationship", "community", "node", "edge", "indexing"])) {
    return "Graph";
  }
  if (matchesAny(key, ["studio", "visual", "preview", "cli", "upload", "dashboard", "api"])) {
    return "Interface";
  }
  if (matchesAny(key, ["ingest", "chunk", "extract", "pipeline", "worker", "queue", "nightly"])) {
    return "Pipeline";
  }
  if (matchesAny(key, ["ticket", "incident", "support", "customer", "deploy", "runbook", "workflow", "operation"])) {
    return "Support";
  }
  return "Concept";
}

function matchesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function communityForType(type: string): CommunityBucket {
  switch (type) {
    case "Pipeline":
      return communityBuckets[0]!;
    case "Graph":
      return communityBuckets[1]!;
    case "Retrieval":
      return communityBuckets[2]!;
    case "Storage":
    case "Package":
      return communityBuckets[3]!;
    case "Interface":
      return communityBuckets[4]!;
    case "Support":
      return communityBuckets[5]!;
    default:
      return communityBuckets[6]!;
  }
}

function describeEntity(title: string, type: string, textUnits: TextUnit[]): string {
  const sentence = textUnits
    .flatMap((unit) => splitSentences(unit.text))
    .find((entry) => textContainsTerm(entry, title));

  if (sentence) {
    return sentence.length > 220 ? `${sentence.slice(0, 217)}...` : sentence;
  }

  return `${title} was extracted as a ${type.toLowerCase()} entity from the uploaded document.`;
}

function textContainsTerm(text: string, term: string): boolean {
  const haystack = normalizeKey(text);
  const needle = normalizeKey(term);
  if (!needle) {
    return false;
  }
  return haystack.includes(needle);
}

function createRelationships(
  entities: Entity[],
  textUnits: TextUnit[],
  maxRelationships: number,
  sourcePath: string
): Relationship[] {
  const pairMap = new Map<string, {
    sourceId: string;
    targetId: string;
    weight: number;
    textUnitIds: Set<string>;
  }>();

  for (const unit of textUnits) {
    const entityIds = unit.entityIds.slice(0, 12);
    for (let leftIndex = 0; leftIndex < entityIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < entityIds.length; rightIndex += 1) {
        const sourceId = entityIds[leftIndex];
        const targetId = entityIds[rightIndex];
        if (!sourceId || !targetId || sourceId === targetId) {
          continue;
        }
        const key = [sourceId, targetId].sort().join("::");
        const existing = pairMap.get(key);
        if (existing) {
          existing.weight += 1;
          existing.textUnitIds.add(unit.id);
        } else {
          pairMap.set(key, {
            sourceId,
            targetId,
            weight: 1,
            textUnitIds: new Set([unit.id])
          });
        }
      }
    }
  }

  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const relationships = Array.from(pairMap.values())
    .sort((left, right) => right.weight - left.weight || left.sourceId.localeCompare(right.sourceId))
    .slice(0, maxRelationships)
    .map((pair, index) => {
      const source = entityById.get(pair.sourceId);
      const target = entityById.get(pair.targetId);
      const textUnitIds = Array.from(pair.textUnitIds);
      const attributes: JsonObject = {
        sourceEntityId: pair.sourceId,
        targetEntityId: pair.targetId,
        sourcePath,
        sourcePaths: [sourcePath]
      };
      return {
        id: `rel-${index + 1}`,
        humanReadableId: `${source?.title ?? pair.sourceId} -> ${target?.title ?? pair.targetId}`,
        source: source?.title ?? pair.sourceId,
        target: target?.title ?? pair.targetId,
        description: `${source?.title ?? pair.sourceId} co-occurs with ${target?.title ?? pair.targetId} in ${pair.weight} document section${pair.weight === 1 ? "" : "s"}.`,
        weight: Math.max(1, Math.round(pair.weight * 100) / 100),
        combinedDegree: textUnitIds.length,
        rank: pair.weight,
        textUnitIds,
        attributes
      };
    });

  for (const unit of textUnits) {
    unit.relationshipIds = relationships
      .filter((relationship) => relationship.textUnitIds.includes(unit.id))
      .map((relationship) => relationship.id);
  }

  return relationships;
}

function createCommunities(
  entities: Entity[],
  relationships: Relationship[],
  textUnits: TextUnit[]
): Community[] {
  const buckets = communityBuckets
    .map((bucket) => {
      const entityIds = entities
        .filter((entity) => entity.communityIds.includes(bucket.id))
        .map((entity) => entity.id);
      const entityIdSet = new Set(entityIds);
      const relationshipIds = relationships
        .filter((relationship) => {
          const sourceId = typeof relationship.attributes?.sourceEntityId === "string" ? relationship.attributes.sourceEntityId : "";
          const targetId = typeof relationship.attributes?.targetEntityId === "string" ? relationship.attributes.targetEntityId : "";
          return entityIdSet.has(sourceId) || entityIdSet.has(targetId);
        })
        .map((relationship) => relationship.id);
      const textUnitIds = textUnits
        .filter((unit) => unit.entityIds.some((entityId) => entityIdSet.has(entityId)))
        .map((unit) => unit.id);

      return {
        id: bucket.id,
        humanReadableId: bucket.title,
        title: bucket.title,
        community: bucket.community,
        level: 0,
        parent: null,
        children: [],
        entityIds,
        relationshipIds,
        textUnitIds,
        covariateIds: [],
        attributes: {
          generatedBy: "document-upload"
        },
        size: entityIds.length
      };
    })
    .filter((community) => community.entityIds.length > 0);

  return buckets.length > 0 ? buckets : [{
    id: "community-concepts",
    humanReadableId: "Document Concepts",
    title: "Document Concepts",
    community: 6,
    level: 0,
    parent: null,
    children: [],
    entityIds: entities.map((entity) => entity.id),
    relationshipIds: relationships.map((relationship) => relationship.id),
    textUnitIds: textUnits.map((unit) => unit.id),
    covariateIds: [],
    attributes: {
      generatedBy: "document-upload"
    },
    size: entities.length
  }];
}

function createCommunityReports(
  communities: Community[],
  entities: Entity[],
  relationships: Relationship[],
  textUnits: TextUnit[]
): CommunityReport[] {
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const relationshipById = new Map(relationships.map((relationship) => [relationship.id, relationship]));
  const textUnitById = new Map(textUnits.map((unit) => [unit.id, unit]));

  return communities.map((community) => {
    const topEntities = community.entityIds
      .map((id) => entityById.get(id))
      .filter((entity): entity is Entity => Boolean(entity))
      .sort((left, right) => (right.rank ?? 0) - (left.rank ?? 0))
      .slice(0, 5);
    const topRelationships = community.relationshipIds
      .map((id) => relationshipById.get(id))
      .filter((relationship): relationship is Relationship => Boolean(relationship))
      .slice(0, 4);
    const sourceText = community.textUnitIds
      .map((id) => textUnitById.get(id)?.text)
      .filter((value): value is string => Boolean(value))
      .slice(0, 2)
      .join(" ");
    const summary = [
      `${community.title} groups ${community.entityIds.length} extracted entities from the uploaded document.`,
      topEntities.length ? `Representative entities: ${topEntities.map((entity) => entity.title).join(", ")}.` : "",
      topRelationships.length ? `Key links: ${topRelationships.map((relationship) => `${relationship.source} -> ${relationship.target}`).join("; ")}.` : ""
    ].filter(Boolean).join(" ");

    return {
      id: `report-${community.id}`,
      humanReadableId: `${community.title} report`,
      title: `${community.title} report`,
      community: community.community,
      level: community.level,
      parent: null,
      children: [],
      summary,
      fullContent: [summary, sourceText].filter(Boolean).join("\n\n"),
      rank: Math.max(1, community.entityIds.length + community.relationshipIds.length / 2),
      ratingExplanation: "Generated from deterministic document upload extraction.",
      findings: topEntities.slice(0, 3).map((entity) => ({
        summary: entity.title,
        explanation: entity.description ?? ""
      })),
      attributes: {
        generatedBy: "document-upload"
      },
      size: community.entityIds.length
    };
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/@/g, "at-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
