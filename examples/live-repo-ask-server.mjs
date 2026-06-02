#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import {
  AnthropicChatModel,
  OpenAiChatModel,
  OpenAiEmbeddingModel,
  createMemoryGraphRagService,
  createStableId,
  indexRepository,
  summarizeGraphRagQueryPlan
} from "../dist/index.js";

const port = Number(process.env.PORT ?? 4477);
const host = process.env.HOST ?? "127.0.0.1";
const defaultRepoPath = path.resolve(process.env.DEFAULT_REPO_PATH ?? process.cwd());
const embeddingModelName = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
const answerProvider = process.env.ANTHROPIC_API_KEY
  ? "claude"
  : process.env.OPENAI_API_KEY
    ? "openai"
    : "extractive";

const state = {
  status: "idle",
  repoPath: defaultRepoPath,
  indexedRepoPath: null,
  remoteRef: process.env.DEFAULT_REPO_REF ?? "",
  indexedAt: null,
  selectedFileCount: 0,
  sourceProvider: "auto",
  stats: null,
  error: null,
  logs: [],
  service: null,
  indexingPromise: null,
  provider: {
    answer: answerProvider,
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    openAiEmbeddings: Boolean(process.env.OPENAI_API_KEY)
  }
};

function log(message) {
  state.logs = [
    ...state.logs.slice(-80),
    {
      at: new Date().toISOString(),
      message
    }
  ];
  console.log(message);
}

function jsonResponse(response, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  response.end(body);
}

function htmlResponse(response, body) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "pragma": "no-cache",
    "expires": "0"
  });
  response.end(body);
}

function textResponse(response, status, body) {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8"
  });
  response.end(body);
}

function htmlAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      throw new Error("Request body is too large.");
    }
  }
  if (!body.trim()) return {};
  return JSON.parse(body);
}

function createAnswerModel() {
  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicChatModel({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
      maxTokens: Number(process.env.GRAG_LIVE_MAX_TOKENS ?? 1400)
    });
  }

  if (process.env.OPENAI_API_KEY) {
    return new OpenAiChatModel({
      model: process.env.OPENAI_MODEL ?? process.env.GRAG_OPENAI_ANSWER_MODEL ?? "gpt-4o-mini"
    });
  }

  return undefined;
}

function sourcePathForTextUnit(textUnit) {
  const sourcePath = textUnit.attributes?.sourcePath;
  return typeof sourcePath === "string" ? sourcePath : textUnit.humanReadableId?.toString() ?? textUnit.id;
}

function embeddingTextForTextUnit(textUnit) {
  return [
    `Source path: ${sourcePathForTextUnit(textUnit)}`,
    textUnit.text.slice(0, 8_000)
  ].join("\n\n");
}

async function embedTextUnits(service, embeddingModel) {
  const textUnits = await service.store.listTextUnits();
  const inputs = textUnits.map(embeddingTextForTextUnit);
  const vectors = await embeddingModel.embed(inputs);
  const records = textUnits.flatMap((textUnit, index) => {
    const vector = vectors[index];
    if (!vector) return [];
    return [{
      id: createStableId(["text_unit", textUnit.id, embeddingModelName], "emb"),
      targetKind: "text_unit",
      targetId: textUnit.id,
      vector,
      model: embeddingModelName,
      dimensions: vector.length,
      text: inputs[index],
      metadata: { sourcePath: sourcePathForTextUnit(textUnit) }
    }];
  });

  await service.store.upsertEmbeddings(records);
  return records.length;
}

async function indexRepo(repoPath, options = {}) {
  if (state.indexingPromise) {
    return state.indexingPromise;
  }

  state.status = "indexing";
  state.error = null;
  state.repoPath = String(repoPath || defaultRepoPath);
  state.indexedRepoPath = null;
  state.remoteRef = String(options.remoteRef ?? "");
  state.sourceProvider = options.provider ?? "auto";
  state.indexedAt = null;
  state.selectedFileCount = 0;
  state.stats = null;
  state.service = null;

  state.indexingPromise = (async () => {
    try {
      log(`Indexing repo: ${state.repoPath}${state.remoteRef ? ` @ ${state.remoteRef}` : ""}`);
      const remoteOptions = {
        ...(state.remoteRef ? { ref: state.remoteRef } : {}),
        ...(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {})
      };
      const indexed = await indexRepository({
        source: state.repoPath,
        provider: options.provider ?? "auto",
        ...(Object.keys(remoteOptions).length > 0 ? { remote: remoteOptions } : {}),
        scan: {
          maxFiles: "all"
        },
        extraction: {
          provider: "local"
        }
      });
      const selectedFiles = indexed.files;
      const snapshot = indexed.snapshot;
      const mode = indexed.mode;
      state.indexedRepoPath = indexed.repoPath;
      state.sourceProvider = indexed.provider;
      state.selectedFileCount = selectedFiles.length;
      log(`Scanned ${selectedFiles.length} non-ignored text/source files from ${indexed.provider}.`);
      log(`Built ${mode} graph snapshot.`);

      const answerModel = createAnswerModel();
      const embeddingModel = options.useEmbeddings && process.env.OPENAI_API_KEY
        ? new OpenAiEmbeddingModel({
            model: embeddingModelName,
            batchSize: Number(process.env.GRAG_LIVE_EMBED_BATCH_SIZE ?? 128)
          })
        : undefined;
      const service = createMemoryGraphRagService({
        ...(answerModel ? { model: answerModel } : {}),
        ...(embeddingModel ? { embeddingModel } : {})
      });

      await service.ingestSnapshot(snapshot);
      if (embeddingModel) {
        log(`Embedding ${selectedFiles.length} text units with OpenAI.`);
        const embedded = await embedTextUnits(service, embeddingModel);
        log(`Stored ${embedded} OpenAI embedding records.`);
      } else if (options.useEmbeddings) {
        log("OpenAI embeddings requested, but OPENAI_API_KEY is not set.");
      }

      state.service = service;
      state.stats = await service.stats();
      state.indexedAt = new Date().toISOString();
      state.status = "ready";
      log(`Ready: ${state.stats.documents} documents, ${state.stats.entities} entities, ${state.stats.relationships} relationships.`);
      return snapshot;
    } catch (error) {
      state.status = "error";
      state.error = error instanceof Error ? error.message : String(error);
      log(`Index failed: ${state.error}`);
      throw error;
    } finally {
      state.indexingPromise = null;
    }
  })();

  return state.indexingPromise;
}

function requireReady() {
  if (!state.service || state.status !== "ready") {
    throw new Error("No ready repo index yet. Index a repo first.");
  }
  return state.service;
}

function shapeHit(hit) {
  return {
    id: hit.id,
    kind: hit.kind,
    title: hit.title,
    score: hit.score,
    channels: hit.channels,
    sourcePaths: hit.sourcePaths,
    citationIds: hit.citationIds,
    text: compact(hit.text).slice(0, 900)
  };
}

function shapeGraphResult(result) {
  const hits = result.hits.map(shapeHit);
  return {
    query: result.query,
    mode: result.mode,
    answer: result.answer ?? buildSearchSummary(result.query, hits),
    usage: result.usage,
    plan: summarizeGraphRagQueryPlan(result.plan),
    hitCount: hits.length,
    hits,
    citations: result.citations,
    trace: result.trace,
    stats: result.stats,
    timings: result.timings,
    graph: result.graph
  };
}

function buildSearchSummary(query, hits) {
  if (hits.length === 0) {
    return `Search found 0 hits for "${query}". Try a symbol, file path, package name, route, or domain term from the indexed repo.`;
  }

  const topFiles = hits.slice(0, 5).map((hit, index) => {
    const source = hit.sourcePaths[0] || hit.title;
    return `${index + 1}. ${source} (${hit.channels.join("+")}, score ${hit.score})`;
  });

  return [
    `Search found ${hits.length} hit${hits.length === 1 ? "" : "s"} for "${query}".`,
    "",
    "Top files:",
    ...topFiles
  ].join("\n");
}

function shapeDatabase(snapshot, limit = 5) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 5, 25));
  const table = (name, rows, mapper) => ({
    name,
    count: rows.length,
    rows: rows.slice(0, boundedLimit).map(mapper)
  });
  const joinTable = (name, rows) => ({
    name,
    count: rows.length,
    rows: rows.slice(0, boundedLimit)
  });

  const documentTextUnitRows = snapshot.documents.flatMap((document) =>
    document.textUnitIds.map((textUnitId, position) => ({
      document_id: document.id,
      text_unit_id: textUnitId,
      position
    }))
  );
  const textUnitEntityRows = snapshot.textUnits.flatMap((textUnit) =>
    textUnit.entityIds.map((entityId, position) => ({
      text_unit_id: textUnit.id,
      entity_id: entityId,
      position
    }))
  );
  const textUnitRelationshipRows = snapshot.textUnits.flatMap((textUnit) =>
    textUnit.relationshipIds.map((relationshipId, position) => ({
      text_unit_id: textUnit.id,
      relationship_id: relationshipId,
      position
    }))
  );
  const entityCommunityRows = snapshot.entities.flatMap((entity) =>
    entity.communityIds.map((communityId, position) => ({
      entity_id: entity.id,
      community_id: communityId,
      position
    }))
  );
  const entityTextUnitRows = snapshot.entities.flatMap((entity) =>
    entity.textUnitIds.map((textUnitId, position) => ({
      entity_id: entity.id,
      text_unit_id: textUnitId,
      position
    }))
  );
  const relationshipTextUnitRows = snapshot.relationships.flatMap((relationship) =>
    relationship.textUnitIds.map((textUnitId, position) => ({
      relationship_id: relationship.id,
      text_unit_id: textUnitId,
      position
    }))
  );
  const communityEntityRows = snapshot.communities.flatMap((community) =>
    community.entityIds.map((entityId, position) => ({
      community_id: community.id,
      entity_id: entityId,
      position
    }))
  );
  const communityRelationshipRows = snapshot.communities.flatMap((community) =>
    community.relationshipIds.map((relationshipId, position) => ({
      community_id: community.id,
      relationship_id: relationshipId,
      position
    }))
  );
  const communityTextUnitRows = snapshot.communities.flatMap((community) =>
    community.textUnitIds.map((textUnitId, position) => ({
      community_id: community.id,
      text_unit_id: textUnitId,
      position
    }))
  );

  return {
    repoPath: state.repoPath,
    indexedRepoPath: state.indexedRepoPath,
    remoteRef: state.remoteRef,
    indexedAt: state.indexedAt,
    summary: {
      documents: snapshot.documents.length,
      textUnits: snapshot.textUnits.length,
      entities: snapshot.entities.length,
      relationships: snapshot.relationships.length,
      communities: snapshot.communities.length,
      communityReports: snapshot.communityReports.length,
      embeddings: snapshot.embeddings.length
    },
    tables: [
      table("grag_documents", snapshot.documents, (document) => ({
        id: document.id,
        title: document.title,
        source_path: sourcePathFromAttributes(document.attributes) ?? document.humanReadableId ?? "",
        type: document.type,
        text_chars: document.text.length,
        text_units: document.textUnitIds.length
      })),
      table("grag_text_units", snapshot.textUnits, (textUnit) => ({
        id: textUnit.id,
        document_id: textUnit.documentId ?? "",
        source_path: sourcePathFromAttributes(textUnit.attributes) ?? textUnit.humanReadableId ?? "",
        text_chars: textUnit.text.length,
        entities: textUnit.entityIds.length,
        relationships: textUnit.relationshipIds.length,
        preview: compact(textUnit.text).slice(0, 180)
      })),
      table("grag_entities", snapshot.entities, (entity) => ({
        id: entity.id,
        title: entity.title,
        type: entity.type ?? "",
        frequency: entity.frequency ?? "",
        degree: entity.degree ?? "",
        rank: entity.rank ?? "",
        text_units: entity.textUnitIds.length,
        communities: entity.communityIds.length,
        description: compact(entity.description ?? "").slice(0, 180)
      })),
      table("grag_relationships", snapshot.relationships, (relationship) => ({
        id: relationship.id,
        source: relationship.source,
        target: relationship.target,
        weight: relationship.weight,
        rank: relationship.rank ?? "",
        text_units: relationship.textUnitIds.length,
        description: compact(relationship.description ?? "").slice(0, 180)
      })),
      table("grag_communities", snapshot.communities, (community) => ({
        id: community.id,
        title: community.title,
        community: community.community,
        level: community.level,
        size: community.size ?? "",
        entities: community.entityIds.length,
        relationships: community.relationshipIds.length,
        text_units: community.textUnitIds.length
      })),
      table("grag_community_reports", snapshot.communityReports, (report) => ({
        id: report.id,
        title: report.title,
        community: report.community,
        level: report.level,
        rank: report.rank,
        summary: compact(report.summary).slice(0, 220)
      })),
      table("grag_embeddings", snapshot.embeddings, (embedding) => ({
        id: embedding.id,
        target_kind: embedding.targetKind,
        target_id: embedding.targetId,
        model: embedding.model ?? "",
        dimensions: embedding.dimensions ?? embedding.vector.length,
        text: compact(embedding.text ?? "").slice(0, 180)
      })),
      joinTable("grag_document_text_units", documentTextUnitRows),
      joinTable("grag_text_unit_entities", textUnitEntityRows),
      joinTable("grag_text_unit_relationships", textUnitRelationshipRows),
      joinTable("grag_entity_communities", entityCommunityRows),
      joinTable("grag_entity_text_units", entityTextUnitRows),
      joinTable("grag_relationship_text_units", relationshipTextUnitRows),
      joinTable("grag_community_entities", communityEntityRows),
      joinTable("grag_community_relationships", communityRelationshipRows),
      joinTable("grag_community_text_units", communityTextUnitRows)
    ]
  };
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sourcePathFromAttributes(attributes) {
  return typeof attributes?.sourcePath === "string" ? attributes.sourcePath : undefined;
}

function publicState() {
  return {
    status: state.status,
    repoPath: state.repoPath,
    indexedRepoPath: state.indexedRepoPath,
    remoteRef: state.remoteRef,
    sourceProvider: state.sourceProvider,
    defaultRepoPath,
    indexedAt: state.indexedAt,
    selectedFileCount: state.selectedFileCount,
    stats: state.stats,
    error: state.error,
    logs: state.logs,
    provider: state.provider
  };
}

async function handleApi(request, response, url) {
  if (request.method === "OPTIONS") {
    jsonResponse(response, 204, {});
    return;
  }

  try {
    if (url.pathname === "/api/state" && request.method === "GET") {
      jsonResponse(response, 200, publicState());
      return;
    }

    if (url.pathname === "/api/database" && request.method === "GET") {
      const service = requireReady();
      const snapshot = await service.snapshot();
      jsonResponse(response, 200, shapeDatabase(snapshot, url.searchParams.get("limit") ?? 5));
      return;
    }

    if (url.pathname === "/api/index" && request.method === "POST") {
      const body = await readJsonBody(request);
      if (state.status === "indexing") {
        jsonResponse(response, 202, publicState());
        return;
      }

      void indexRepo(body.repoPath ?? defaultRepoPath, {
        provider: body.provider ?? "auto",
        remoteRef: body.remoteRef ?? "",
        useEmbeddings: Boolean(body.useEmbeddings)
      }).catch(() => {});
      jsonResponse(response, 202, publicState());
      return;
    }

    if (url.pathname === "/api/search" && request.method === "POST") {
      const body = await readJsonBody(request);
      const query = String(body.query ?? "").trim();
      if (!query) throw new Error("Search query is required.");
      const service = requireReady();
      const result = await service.searchGraph(query, {
        limit: Number(body.limit ?? 8),
        basicSearch: { limit: Number(body.textLimit ?? 12) },
        maxContextChars: Number(body.maxContextChars ?? 16_000)
      });
      jsonResponse(response, 200, shapeGraphResult(result));
      return;
    }

    if (url.pathname === "/api/ask" && request.method === "POST") {
      const body = await readJsonBody(request);
      const query = String(body.query ?? "").trim();
      if (!query) throw new Error("Ask AI query is required.");
      const service = requireReady();
      const result = await service.ask(query, {
        limit: Number(body.limit ?? 8),
        basicSearch: { limit: Number(body.textLimit ?? 12) },
        maxContextChars: Number(body.maxContextChars ?? 16_000),
        responseStyle: "concise engineering answer with source file citations",
        systemPrompt: `Only answer from the indexed repo at ${state.repoPath}. Do not use outside knowledge.`,
        temperature: 0,
        maxTokens: Number(process.env.GRAG_LIVE_MAX_TOKENS ?? 1400)
      });
      jsonResponse(response, 200, shapeGraphResult(result));
      return;
    }

    textResponse(response, 404, "Not found");
  } catch (error) {
    jsonResponse(response, 400, {
      error: error instanceof Error ? error.message : String(error),
      state: publicState()
    });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }

  if (
    url.pathname === "/" ||
    url.pathname === "/repo-search.html" ||
    url.pathname === "/live"
  ) {
    htmlResponse(response, appHtml);
    return;
  }

  textResponse(response, 404, "Not found");
});

server.listen(port, host, () => {
  log(`GRAG live repo app listening at http://${host}:${port}/repo-search.html`);
  log(`Answer provider: ${answerProvider}; OpenAI embeddings: ${process.env.OPENAI_API_KEY ? "available" : "unavailable"}.`);
  if (process.env.GRAG_AUTO_INDEX !== "0") {
    void indexRepo(defaultRepoPath).catch(() => {});
  }
});

const appHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GRAG Live Repo Search</title>
    <style>
      :root {
        --bg: #f4f7fa;
        --panel: #fff;
        --ink: #13202f;
        --muted: #66768a;
        --line: #d9e1ea;
        --blue: #1f6feb;
        --blue-dark: #185abc;
        --green: #14805e;
        --amber: #946200;
        --red: #b42318;
        --chip: #eef4fb;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      button,
      input,
      select,
      textarea,
      label {
        font: inherit;
      }

      main {
        width: min(1240px, calc(100vw - 28px));
        margin: 0 auto;
        padding: 18px 0 30px;
      }

      header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 12px;
      }

      h1 {
        margin: 0 0 5px;
        font-size: 26px;
        line-height: 1.12;
      }

      h2 {
        margin: 0 0 10px;
        font-size: 16px;
      }

      p {
        margin: 0;
      }

      .muted {
        color: var(--muted);
      }

      .status {
        min-width: 160px;
        text-align: right;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        border-radius: 999px;
        padding: 4px 11px;
        font-weight: 700;
        background: var(--chip);
        color: var(--ink);
      }

      .badge.ready {
        background: #e8f6f0;
        color: var(--green);
      }

      .badge.indexing {
        background: #fff6df;
        color: var(--amber);
      }

      .badge.error {
        background: #fff0ee;
        color: var(--red);
      }

      .layout {
        display: grid;
        grid-template-columns: 360px 1fr;
        gap: 14px;
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 14px;
      }

      .stack {
        display: grid;
        gap: 12px;
      }

      .field {
        display: grid;
        gap: 6px;
      }

      .field span {
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
      }

      input,
      select,
      textarea {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 10px 11px;
        color: var(--ink);
        background: #fff;
      }

      textarea {
        min-height: 84px;
        resize: vertical;
      }

      .row {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }

      button {
        border: 1px solid transparent;
        border-radius: 8px;
        min-height: 38px;
        padding: 8px 12px;
        background: var(--blue);
        color: white;
        font-weight: 700;
        cursor: pointer;
      }

      button.secondary {
        background: #fff;
        border-color: var(--line);
        color: var(--ink);
      }

      button:hover {
        background: var(--blue-dark);
      }

      button.secondary:hover {
        background: #f6f8fb;
      }

      button:disabled {
        opacity: 0.5;
        cursor: wait;
      }

      .metrics {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }

      .metric {
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 9px;
        background: #fbfdff;
      }

      .metric strong {
        display: block;
        font-size: 20px;
      }

      .metric span {
        color: var(--muted);
        font-size: 12px;
      }

      .result-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 330px;
        gap: 14px;
      }

      .answer {
        white-space: pre-wrap;
        line-height: 1.5;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 12px;
        background: #fbfdff;
        min-height: 128px;
      }

      .hits {
        display: grid;
        gap: 10px;
      }

      .hit {
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 11px;
        background: #fff;
      }

      .hit-title {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        font-weight: 800;
      }

      .path {
        overflow-wrap: anywhere;
      }

      .snippet {
        margin-top: 6px;
        color: #334155;
        font-size: 13px;
        line-height: 1.45;
      }

      .chips {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
        margin-top: 8px;
      }

      .chip {
        display: inline-flex;
        border-radius: 999px;
        padding: 3px 8px;
        background: var(--chip);
        color: #29425f;
        font-size: 12px;
        font-weight: 700;
      }

      .side-list {
        display: grid;
        gap: 8px;
        color: #334155;
        font-size: 13px;
      }

      .trace {
        display: grid;
        gap: 6px;
        max-height: 250px;
        overflow: auto;
      }

      .trace-row {
        border-bottom: 1px solid var(--line);
        padding-bottom: 6px;
      }

      .logs {
        display: grid;
        gap: 6px;
        max-height: 250px;
        overflow: auto;
        color: #334155;
        font-size: 13px;
      }

      .db-panel {
        margin-top: 14px;
      }

      .db-summary {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .db-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .db-table {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fff;
        overflow: hidden;
      }

      .db-table header {
        margin: 0;
        padding: 9px 10px;
        border-bottom: 1px solid var(--line);
        background: #fbfdff;
        display: flex;
        justify-content: space-between;
        gap: 10px;
      }

      .db-table strong {
        overflow-wrap: anywhere;
      }

      .db-scroll {
        overflow: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }

      th,
      td {
        border-bottom: 1px solid var(--line);
        padding: 7px 8px;
        text-align: left;
        vertical-align: top;
      }

      th {
        color: var(--muted);
        font-weight: 800;
        background: #fff;
      }

      td {
        color: #334155;
        max-width: 260px;
        overflow-wrap: anywhere;
      }

      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }

      @media (max-width: 980px) {
        .layout,
        .result-grid,
        .db-grid {
          grid-template-columns: 1fr;
        }

        header {
          display: block;
        }

        .status {
          text-align: left;
          margin-top: 10px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>GRAG Live Repo Search + Ask AI</h1>
          <p class="muted" id="scopeLine">Index a repo to start.</p>
        </div>
        <div class="status">
          <span class="badge" id="statusBadge">idle</span>
        </div>
      </header>

      <div class="layout">
        <aside class="stack">
          <section class="panel stack">
            <h2>Index</h2>
            <label class="field">
              <span>Repo source</span>
              <input id="repoPath" value="${htmlAttribute(defaultRepoPath)}" />
            </label>
            <label class="field">
              <span>Provider</span>
              <select id="sourceProvider">
                <option value="auto">auto</option>
                <option value="local">local</option>
                <option value="github">github</option>
                <option value="git">git</option>
              </select>
            </label>
            <label class="field">
              <span>Git ref</span>
              <input id="remoteRef" placeholder="default branch" />
            </label>
            <div class="row">
              <button id="indexButton">Index Repo</button>
              <button class="secondary" id="refreshButton">Refresh</button>
            </div>
            <div class="metrics">
              <div class="metric"><strong id="filesMetric">0</strong><span>files</span></div>
              <div class="metric"><strong id="entitiesMetric">0</strong><span>entities</span></div>
              <div class="metric"><strong id="relationshipsMetric">0</strong><span>relationships</span></div>
              <div class="metric"><strong id="modeMetric">extractive</strong><span>answer</span></div>
            </div>
          </section>

          <section class="panel">
            <h2>Run Log</h2>
            <div class="logs" id="logs"></div>
          </section>
        </aside>

        <section class="stack">
          <section class="panel stack">
            <h2>Query</h2>
            <label class="field">
              <span>Question</span>
              <textarea id="query">Where is Drizzle adapter validation implemented?</textarea>
            </label>
            <div class="row">
              <button id="searchButton">Search</button>
              <button id="askButton">Ask AI</button>
              <button class="secondary" id="sampleButton">Hard Question</button>
            </div>
          </section>

          <section class="result-grid">
            <div class="panel stack">
              <h2 id="answerTitle">Answer</h2>
              <div class="answer" id="answer">No answer yet.</div>
              <div class="hits" id="hits"></div>
            </div>

            <div class="stack">
              <section class="panel">
                <h2>Trace</h2>
                <div class="trace" id="trace"></div>
              </section>
              <section class="panel">
                <h2>Citations</h2>
                <div class="side-list" id="citations"></div>
              </section>
            </div>
          </section>
        </section>
      </div>

      <section class="panel stack db-panel">
        <div class="row">
          <h2>Indexed Database</h2>
          <button class="secondary" id="databaseButton">Load Database View</button>
          <span class="muted" id="databaseMeta">Shows SQL-style tables for the currently indexed repo.</span>
        </div>
        <div class="db-summary" id="databaseSummary"></div>
        <div class="db-grid" id="databaseView"></div>
      </section>
    </main>

    <script>
      const state = {
        busy: false,
        repoPathSeeded: false
      };

      const el = (id) => document.getElementById(id);

      function fmt(value) {
        return new Intl.NumberFormat().format(Number(value || 0));
      }

      function escapeHtml(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      async function api(path, options = {}) {
        const response = await fetch(path, {
          ...options,
          headers: {
            "content-type": "application/json",
            ...(options.headers || {})
          }
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Request failed.");
        }
        return payload;
      }

      async function refreshState() {
        const payload = await api("/api/state");
        applyState(payload);
        return payload;
      }

      function applyState(payload) {
        const repoPathInput = el("repoPath");
        const serverRepoPath = payload.repoPath || payload.defaultRepoPath || repoPathInput.value;
        if (!state.repoPathSeeded) {
          repoPathInput.value = serverRepoPath;
          state.repoPathSeeded = true;
        }
        el("sourceProvider").value = payload.sourceProvider || "auto";
        el("remoteRef").value = payload.remoteRef || "";
        const badge = el("statusBadge");
        badge.textContent = payload.status;
        badge.className = "badge " + payload.status;
        const stats = payload.stats || {};
        el("filesMetric").textContent = fmt(payload.selectedFileCount || stats.documents);
        el("entitiesMetric").textContent = fmt(stats.entities);
        el("relationshipsMetric").textContent = fmt(stats.relationships);
        el("modeMetric").textContent = payload.provider?.answer || "extractive";
        el("scopeLine").textContent = payload.status === "ready"
          ? "Indexed repo: " + payload.repoPath + (payload.remoteRef ? " @ " + payload.remoteRef : "")
          : "Repo target: " + (payload.repoPath || payload.defaultRepoPath);
        el("logs").innerHTML = (payload.logs || []).slice().reverse().map((entry) => (
          "<div><code>" + escapeHtml(new Date(entry.at).toLocaleTimeString()) + "</code> " + escapeHtml(entry.message) + "</div>"
        )).join("") || "<div class='muted'>No log entries yet.</div>";
        const disabled = state.busy || payload.status === "indexing";
        el("indexButton").disabled = disabled;
        el("searchButton").disabled = disabled || payload.status !== "ready";
        el("askButton").disabled = disabled || payload.status !== "ready";
      }

      async function indexRepo() {
        state.busy = true;
        try {
          await api("/api/index", {
            method: "POST",
            body: JSON.stringify({
              repoPath: el("repoPath").value,
              provider: el("sourceProvider").value,
              remoteRef: el("remoteRef").value
            })
          });
          await refreshState();
          waitForIndex();
        } catch (error) {
          el("answer").textContent = error.message;
        } finally {
          state.busy = false;
        }
      }

      async function runSearch() {
        state.busy = true;
        applyBusy();
        try {
          const result = await api("/api/search", {
            method: "POST",
            body: JSON.stringify({ query: el("query").value, limit: 8 })
          });
          renderResult(result, "Search");
        } catch (error) {
          el("answerTitle").textContent = "Search error";
          el("answer").textContent = error.message;
          el("hits").innerHTML = "";
          el("trace").innerHTML = "";
          el("citations").innerHTML = "";
        } finally {
          state.busy = false;
          await refreshState();
        }
      }

      async function runAsk() {
        state.busy = true;
        applyBusy();
        try {
          const result = await api("/api/ask", {
            method: "POST",
            body: JSON.stringify({ query: el("query").value, limit: 8 })
          });
          renderResult(result, "Ask AI");
        } catch (error) {
          el("answerTitle").textContent = "Ask AI error";
          el("answer").textContent = error.message;
          el("hits").innerHTML = "";
          el("trace").innerHTML = "";
          el("citations").innerHTML = "";
        } finally {
          state.busy = false;
          await refreshState();
        }
      }

      async function loadDatabase() {
        try {
          const database = await api("/api/database?limit=5");
          renderDatabase(database);
        } catch (error) {
          el("databaseView").innerHTML = "<p class='muted'>" + escapeHtml(error.message) + "</p>";
        }
      }

      function applyBusy() {
        el("searchButton").disabled = true;
        el("askButton").disabled = true;
        el("answerTitle").textContent = "Running";
        el("answer").textContent = "Running...";
      }

      function renderResult(result, label) {
        const hits = Array.isArray(result.hits) ? result.hits : [];
        const mode = result.mode ? " - " + result.mode : "";
        el("answerTitle").textContent = label + mode + " - " + hits.length + " hit" + (hits.length === 1 ? "" : "s");
        el("answer").textContent = result.answer || result.plan || "Search complete.";
        el("hits").innerHTML = hits.map((hit, index) => {
          const path = hit.sourcePaths[0] || hit.title;
          return "<article class='hit'>" +
            "<div class='hit-title'><span class='path'>" + escapeHtml(index + 1 + ". " + path) + "</span><span>" + escapeHtml(hit.score) + "</span></div>" +
            "<div class='snippet'>" + escapeHtml(hit.text) + "</div>" +
            "<div class='chips'>" + hit.channels.map((channel) => "<span class='chip'>" + escapeHtml(channel) + "</span>").join("") + "</div>" +
          "</article>";
        }).join("") || "<p class='muted'>No hits. Try a symbol, route, file path, package name, or exact term from the indexed repo.</p>";
        el("trace").innerHTML = (result.trace || []).map((step) => (
          "<div class='trace-row'><strong>" + escapeHtml(step.stage) + "</strong>" +
          "<div>" + escapeHtml(step.detail) + "</div>" +
          "<div class='muted'>count " + escapeHtml(step.count ?? "-") + " · " + escapeHtml(step.durationMs ?? 0) + "ms</div></div>"
        )).join("");
        el("citations").innerHTML = (result.citations || []).map((citation) => (
          "<div><strong>" + escapeHtml(citation.id) + "</strong> " + escapeHtml(citation.sourcePaths.join(", ") || citation.title) + "</div>"
        )).join("") || "<div class='muted'>No citations.</div>";
      }

      function renderDatabase(database) {
        el("databaseMeta").textContent = "Repo: " + database.repoPath + (database.remoteRef ? " @ " + database.remoteRef : "");
        el("databaseSummary").innerHTML = Object.entries(database.summary).map(([key, value]) => (
          "<span class='chip'>" + escapeHtml(key) + ": " + escapeHtml(fmt(value)) + "</span>"
        )).join("");
        el("databaseView").innerHTML = database.tables.map((tableInfo) => {
          const columns = Array.from(new Set(tableInfo.rows.flatMap((row) => Object.keys(row))));
          const header = columns.map((column) => "<th>" + escapeHtml(column) + "</th>").join("");
          const rows = tableInfo.rows.map((row) => (
            "<tr>" + columns.map((column) => "<td>" + escapeHtml(row[column] ?? "") + "</td>").join("") + "</tr>"
          )).join("");
          const empty = tableInfo.rows.length === 0 ? "<p class='muted' style='padding: 10px;'>No sample rows.</p>" : "";
          return "<article class='db-table'>" +
            "<header><strong>" + escapeHtml(tableInfo.name) + "</strong><span class='muted'>" + escapeHtml(fmt(tableInfo.count)) + " rows</span></header>" +
            "<div class='db-scroll'><table><thead><tr>" + header + "</tr></thead><tbody>" + rows + "</tbody></table>" + empty + "</div>" +
          "</article>";
        }).join("");
      }

      el("indexButton").addEventListener("click", indexRepo);
      el("refreshButton").addEventListener("click", refreshState);
      el("searchButton").addEventListener("click", runSearch);
      el("askButton").addEventListener("click", runAsk);
      el("databaseButton").addEventListener("click", loadDatabase);
      el("sampleButton").addEventListener("click", () => {
        el("query").value = "Where is Drizzle adapter validation implemented, and what functions guard bad schema fields?";
      });

      async function waitForIndex() {
        const payload = await refreshState();
        if (payload.status === "indexing") {
          setTimeout(waitForIndex, 1000);
        }
      }

      refreshState();
    </script>
  </body>
</html>`;
