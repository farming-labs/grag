#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { graphRagSnapshotSchema, type GraphRagSnapshot } from "./model.js";
import { indexRepository, type RepositoryFileLimit } from "./repo/demo.js";
import { createMemoryGraphRagService, type GraphRagService } from "./service.js";
import { OpenAiChatModel } from "./openai/chat.js";
import { injectGraphRagStudioGlobals, renderGraphRagStudioHtml } from "./studio/html.js";
import { extractDocumentGraphWithOpenAI, type OpenAiDocumentGraphInput } from "./studio/openai.js";
import { retrieveFromGraphRagSnapshot } from "./studio/retrieval.js";
import { createSampleGraphRagSnapshot } from "./studio/sample.js";

interface StudioCommand {
  command: "studio";
  host: string;
  port: number;
  snapshotPath?: string;
  open: boolean;
  exportHtmlPath?: string;
}

interface RetrieveCommand {
  command: "retrieve";
  snapshotPath?: string;
  query: string;
  limit?: number;
}

interface RepoCommand {
  command: "repo";
  repo: string;
  query?: string;
  useOpenAI: boolean | "auto";
  model?: string;
  answerModel?: string;
  maxFiles?: RepositoryFileLimit;
  maxFileBytes?: number;
  maxCorpusChars?: number;
  snapshotPath?: string;
  keepClone: boolean;
  studio: boolean;
  host: string;
  port: number;
  open: boolean;
}

type ParsedCommand = StudioCommand | RetrieveCommand | RepoCommand | { command: "help" };

const helpText = `@farming-labs/grag

Usage:
  grag studio [snapshot.json] [--port 3333] [--host 127.0.0.1] [--open]
  grag preview [snapshot.json]
  grag --preview [snapshot.json]
  grag retrieve [snapshot.json] "question"
  grag repo <path-or-git-url> --ask "question" [--openai] [--snapshot repo.snapshot.json]

Commands:
  studio       Start GraphRAG Studio for a snapshot JSON file.
  preview      Alias for studio.
  retrieve     Run simple snapshot retrieval and print context JSON.
  repo         Build and query a repository index for a local or remote Git repository.

Options:
  --snapshot   Path to a snapshot JSON file.
  --port       Port to listen on. Default: 3333.
  --host       Host to listen on. Default: 127.0.0.1.
  --open       Open the studio URL in your browser.
  --export-html Write a standalone HTML preview file before serving.
  --query      Retrieval query for the retrieve command.
  --limit      Retrieval hit limit. Default: 12.
  --ask        Repository question for the repo command.
  --repo       Repository path or Git URL for the repo command.
  --openai     Force OpenAI extraction and answer generation for the repo command.
  --no-openai  Use local deterministic extraction for the repo command.
  --model      OpenAI model for extraction. Default: GRAG_OPENAI_MODEL or gpt-5.4-mini.
  --answer-model OpenAI model for final answers. Default: GRAG_OPENAI_ANSWER_MODEL or extraction model.
  --max-files  Maximum repository files to index, or "all". Default: all non-ignored text files.
  --all-files  Index all non-ignored repository text files for the repo command.
  --studio     Open the generated repository snapshot in Studio.
  --help       Show this help.

If no snapshot is provided, Studio opens with a built-in sample graph.

Set OPENAI_API_KEY to let Studio extract graphs from PDFs, images, and rich files.
Set GRAG_OPENAI_MODEL to override the extraction model.
`;

function parseArgs(argv: string[]): ParsedCommand {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { command: "help" };
  }

  const args = [...argv];
  const first = args[0];
  if (first === "retrieve") {
    args.shift();
    return parseRetrieveArgs(args);
  }

  if (first === "repo") {
    args.shift();
    return parseRepoArgs(args);
  }

  const command =
    first === "studio" || first === "preview"
      ? args.shift()
      : args.includes("--preview")
        ? "studio"
        : null;

  if (!command) {
    throw new Error(`Unknown command: ${first ?? ""}\n\n${helpText}`);
  }

  let host = "127.0.0.1";
  let port = 3333;
  let snapshotPath: string | undefined;
  let exportHtmlPath: string | undefined;
  let open = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || arg === "--preview") {
      continue;
    }

    if (arg === "--open") {
      open = true;
      continue;
    }

    if (arg === "--host") {
      host = requiredValue(args, ++index, "--host");
      continue;
    }

    if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length);
      continue;
    }

    if (arg === "--port") {
      port = parsePort(requiredValue(args, ++index, "--port"));
      continue;
    }

    if (arg.startsWith("--port=")) {
      port = parsePort(arg.slice("--port=".length));
      continue;
    }

    if (arg === "--snapshot") {
      snapshotPath = requiredValue(args, ++index, "--snapshot");
      continue;
    }

    if (arg.startsWith("--snapshot=")) {
      snapshotPath = arg.slice("--snapshot=".length);
      continue;
    }

    if (arg === "--export-html") {
      exportHtmlPath = requiredValue(args, ++index, "--export-html");
      continue;
    }

    if (arg.startsWith("--export-html=")) {
      exportHtmlPath = arg.slice("--export-html=".length);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    snapshotPath = arg;
  }

  return {
    command: "studio",
    host,
    port,
    open,
    ...(snapshotPath ? { snapshotPath } : {}),
    ...(exportHtmlPath ? { exportHtmlPath } : {}),
  };
}

function parseRepoArgs(args: string[]): RepoCommand {
  let repo: string | undefined;
  let query: string | undefined;
  let useOpenAI: boolean | "auto" = "auto";
  let model: string | undefined;
  let answerModel: string | undefined;
  let maxFiles: RepositoryFileLimit | undefined;
  let maxFileBytes: number | undefined;
  let maxCorpusChars: number | undefined;
  let snapshotPath: string | undefined;
  let keepClone = false;
  let studio = false;
  let open = false;
  let host = "127.0.0.1";
  let port = 3333;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--repo") {
      repo = requiredValue(args, ++index, "--repo");
      continue;
    }

    if (arg.startsWith("--repo=")) {
      repo = arg.slice("--repo=".length);
      continue;
    }

    if (arg === "--ask" || arg === "--query") {
      query = requiredValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith("--ask=")) {
      query = arg.slice("--ask=".length);
      continue;
    }

    if (arg.startsWith("--query=")) {
      query = arg.slice("--query=".length);
      continue;
    }

    if (arg === "--openai") {
      useOpenAI = true;
      continue;
    }

    if (arg === "--no-openai") {
      useOpenAI = false;
      continue;
    }

    if (arg === "--model") {
      model = requiredValue(args, ++index, "--model");
      continue;
    }

    if (arg.startsWith("--model=")) {
      model = arg.slice("--model=".length);
      continue;
    }

    if (arg === "--answer-model") {
      answerModel = requiredValue(args, ++index, "--answer-model");
      continue;
    }

    if (arg.startsWith("--answer-model=")) {
      answerModel = arg.slice("--answer-model=".length);
      continue;
    }

    if (arg === "--max-files") {
      maxFiles = parseRepositoryFileLimit(
        requiredValue(args, ++index, "--max-files"),
        "--max-files",
      );
      continue;
    }

    if (arg.startsWith("--max-files=")) {
      maxFiles = parseRepositoryFileLimit(arg.slice("--max-files=".length), "--max-files");
      continue;
    }

    if (arg === "--all-files") {
      maxFiles = "all";
      continue;
    }

    if (arg === "--max-file-bytes") {
      maxFileBytes = parsePositiveInt(
        requiredValue(args, ++index, "--max-file-bytes"),
        "--max-file-bytes",
      );
      continue;
    }

    if (arg.startsWith("--max-file-bytes=")) {
      maxFileBytes = parsePositiveInt(arg.slice("--max-file-bytes=".length), "--max-file-bytes");
      continue;
    }

    if (arg === "--max-corpus-chars") {
      maxCorpusChars = parsePositiveInt(
        requiredValue(args, ++index, "--max-corpus-chars"),
        "--max-corpus-chars",
      );
      continue;
    }

    if (arg.startsWith("--max-corpus-chars=")) {
      maxCorpusChars = parsePositiveInt(
        arg.slice("--max-corpus-chars=".length),
        "--max-corpus-chars",
      );
      continue;
    }

    if (arg === "--snapshot") {
      snapshotPath = requiredValue(args, ++index, "--snapshot");
      continue;
    }

    if (arg.startsWith("--snapshot=")) {
      snapshotPath = arg.slice("--snapshot=".length);
      continue;
    }

    if (arg === "--keep-clone") {
      keepClone = true;
      continue;
    }

    if (arg === "--studio") {
      studio = true;
      continue;
    }

    if (arg === "--open") {
      open = true;
      continue;
    }

    if (arg === "--host") {
      host = requiredValue(args, ++index, "--host");
      continue;
    }

    if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length);
      continue;
    }

    if (arg === "--port") {
      port = parsePort(requiredValue(args, ++index, "--port"));
      continue;
    }

    if (arg.startsWith("--port=")) {
      port = parsePort(arg.slice("--port=".length));
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (!repo) {
      repo = arg;
      continue;
    }

    query = arg;
  }

  if (!repo) {
    throw new Error(
      'repo requires a repository path or Git URL. Example: grag repo . --ask "What does this repo do?"',
    );
  }

  return {
    command: "repo",
    repo,
    useOpenAI,
    keepClone,
    studio,
    host,
    port,
    open,
    ...(query ? { query } : {}),
    ...(model ? { model } : {}),
    ...(answerModel ? { answerModel } : {}),
    ...(maxFiles ? { maxFiles } : {}),
    ...(maxFileBytes ? { maxFileBytes } : {}),
    ...(maxCorpusChars ? { maxCorpusChars } : {}),
    ...(snapshotPath ? { snapshotPath } : {}),
  };
}

function parseRetrieveArgs(args: string[]): RetrieveCommand {
  let snapshotPath: string | undefined;
  let query: string | undefined;
  let limit: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--query") {
      query = requiredValue(args, ++index, "--query");
      continue;
    }

    if (arg.startsWith("--query=")) {
      query = arg.slice("--query=".length);
      continue;
    }

    if (arg === "--limit") {
      limit = parseLimit(requiredValue(args, ++index, "--limit"));
      continue;
    }

    if (arg.startsWith("--limit=")) {
      limit = parseLimit(arg.slice("--limit=".length));
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (!snapshotPath && args.length > index + 1) {
      snapshotPath = arg;
      continue;
    }

    query = arg;
  }

  if (!query) {
    throw new Error(
      'retrieve requires a query. Example: grag retrieve snapshot.json "How does retrieval work?"',
    );
  }

  return {
    command: "retrieve",
    query,
    ...(snapshotPath ? { snapshotPath } : {}),
    ...(limit ? { limit } : {}),
  };
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${option} requires a value.`);
  }

  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

function parseLimit(value: string): number {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error(`Invalid limit: ${value}`);
  }

  return limit;
}

function parsePositiveInt(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer.`);
  }

  return parsed;
}

function parseRepositoryFileLimit(value: string, option: string): RepositoryFileLimit {
  if (value.toLowerCase() === "all") {
    return "all";
  }

  return parsePositiveInt(value, option);
}

async function loadSnapshot(path?: string): Promise<GraphRagSnapshot> {
  if (!path) {
    return createSampleGraphRagSnapshot();
  }

  const absolutePath = resolve(path);
  const raw = await readFile(absolutePath, "utf8");
  return graphRagSnapshotSchema.parse(JSON.parse(raw));
}

function contentType(pathname: string): string {
  const extension = extname(pathname);
  switch (extension) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "text/html; charset=utf-8";
  }
}

function openUrl(url: string): void {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

const studioDistDir = join(dirname(fileURLToPath(import.meta.url)), "studio");

async function loadStudioIndexHtml(snapshot: GraphRagSnapshot, title: string): Promise<string> {
  try {
    const html = await readFile(join(studioDistDir, "index.html"), "utf8");
    return injectGraphRagStudioGlobals(html, { title });
  } catch {
    return renderGraphRagStudioHtml(snapshot, { title });
  }
}

async function renderExportHtml(snapshot: GraphRagSnapshot, title: string): Promise<string> {
  try {
    let html = await readFile(join(studioDistDir, "index.html"), "utf8");
    html = injectGraphRagStudioGlobals(html, { title, snapshot });
    html = await inlineStudioAssets(html);
    return html;
  } catch {
    return renderGraphRagStudioHtml(snapshot, { title });
  }
}

async function inlineStudioAssets(html: string): Promise<string> {
  let output = html;
  const scriptMatches = [
    ...output.matchAll(/<script type="module" crossorigin src="([^"]+)"><\/script>/g),
  ];
  for (const match of scriptMatches) {
    const src = match[1];
    if (!src) continue;
    const js = await readFile(join(studioDistDir, src.replace(/^\.\//, "")), "utf8");
    output = output.replace(match[0], `<script type="module">${js}</script>`);
  }

  const styleMatches = [...output.matchAll(/<link rel="stylesheet" crossorigin href="([^"]+)">/g)];
  for (const match of styleMatches) {
    const href = match[1];
    if (!href) continue;
    const css = await readFile(join(studioDistDir, href.replace(/^\.\//, "")), "utf8");
    output = output.replace(match[0], `<style>${css}</style>`);
  }

  return output;
}

async function loadDotEnv(path = resolve(".env")): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = unquoteEnvValue(trimmed.slice(separator + 1).trim());
    if (/^[A-Z_][A-Z0-9_]*$/i.test(key) && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function maxUploadBytes(): number {
  const value = Number(process.env.GRAG_UPLOAD_MAX_BYTES ?? 50 * 1024 * 1024);
  return Number.isFinite(value) && value > 0 ? value : 50 * 1024 * 1024;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const limit = maxUploadBytes();

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > Math.ceil(limit * 1.4)) {
      throw new Error(
        `Upload body is too large. Max file size is ${Math.round(limit / 1024 / 1024)}MB.`,
      );
    }
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseDocumentGraphInput(value: unknown): OpenAiDocumentGraphInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object upload payload.");
  }

  const record = value as Record<string, unknown>;
  const filename =
    typeof record.filename === "string" && record.filename.trim()
      ? record.filename.trim()
      : "uploaded-file";
  const mimeType =
    typeof record.mimeType === "string" ? record.mimeType : "application/octet-stream";
  const text = typeof record.text === "string" ? record.text : undefined;
  const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl : undefined;
  const byteSize = typeof record.byteSize === "number" ? record.byteSize : 0;
  const limit = maxUploadBytes();
  if (byteSize > limit) {
    throw new Error(`File is too large. Max file size is ${Math.round(limit / 1024 / 1024)}MB.`);
  }
  if (!text && !dataUrl) {
    throw new Error("Upload must include text or dataUrl.");
  }

  return {
    filename,
    mimeType,
    ...(text ? { text } : {}),
    ...(dataUrl ? { dataUrl } : {}),
  };
}

interface StudioRepoGraphInput {
  repo: string;
  query: string;
  useOpenAI: boolean;
  maxFiles: RepositoryFileLimit;
  maxCorpusChars: number;
}

function parseRepoGraphInput(value: unknown): StudioRepoGraphInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object repository payload.");
  }

  const record = value as Record<string, unknown>;
  const repo = typeof record.repo === "string" ? normalizeGithubRepo(record.repo) : "";
  if (!repo) {
    throw new Error("Repository must be a GitHub URL or owner/name pair.");
  }

  const query =
    typeof record.query === "string" && record.query.trim()
      ? record.query.trim()
      : "What are the important packages, plugins, storage surfaces, and auth flows in this repository?";
  const maxFiles = parseRepositoryFileLimitFromUnknown(record.maxFiles);
  const maxCorpusChars = boundedInt(record.maxCorpusChars, 10_000, 120_000, 60_000);
  const useOpenAI = record.useOpenAI === true;

  return {
    repo,
    query,
    useOpenAI,
    maxFiles,
    maxCorpusChars,
  };
}

function normalizeGithubRepo(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const ownerName = trimmed.match(/^([a-z0-9_.-]+)\/([a-z0-9_.-]+)$/i);
  if (ownerName) {
    return `https://github.com/${ownerName[1]}/${ownerName[2]}.git`;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.hostname !== "github.com") {
      return "";
    }

    const [owner, repoName] = url.pathname.replace(/^\/+/, "").split("/");
    if (!owner || !repoName) {
      return "";
    }

    return `https://github.com/${owner}/${repoName.replace(/\.git$/, "")}.git`;
  } catch {
    return "";
  }
}

function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function parseRepositoryFileLimitFromUnknown(value: unknown): RepositoryFileLimit {
  if (value === undefined || value === null || value === "" || value === "all") {
    return "all";
  }

  if (typeof value === "string" && value.toLowerCase() === "all") {
    return "all";
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    return "all";
  }

  return numeric;
}

function createRepoService(useOpenAI: boolean | "auto", model?: string): GraphRagService {
  const shouldUseModel = useOpenAI !== false && Boolean(process.env.OPENAI_API_KEY);
  return createMemoryGraphRagService((shouldUseModel
      ? {
          model: new OpenAiChatModel({
            ...(model ? { model } : {}),
          }),
        }
      : {}));
}

function writeJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function handleDocumentGraphRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    if (!process.env.OPENAI_API_KEY) {
      writeJson(response, 400, {
        error:
          "OPENAI_API_KEY is not set. Text and Markdown can still use the local browser extractor.",
      });
      return;
    }

    const upload = parseDocumentGraphInput(await readJsonBody(request));
    const result = await extractDocumentGraphWithOpenAI(upload);
    writeJson(response, 200, {
      snapshot: result.snapshot,
      extraction: result.extraction,
      model: result.model,
      suggestedQueries: result.extraction.suggestedQueries,
    });
  } catch (error) {
    writeJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleRepoGraphRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const input = parseRepoGraphInput(await readJsonBody(request));
    const result = await indexRepository({
      source: input.repo,
      provider: "auto",
      scan: { maxFiles: input.maxFiles },
      extraction: {
        provider: input.useOpenAI ? "openai" : "local",
        maxCorpusChars: input.maxCorpusChars,
      },
    });
    const service = createRepoService(input.useOpenAI);
    await service.ingestSnapshot(result.snapshot);
    const stats = await service.stats();
    const retrieval = await service.retrieve(input.query, {
      useBasicSearch: true,
      limit: 12,
      basicSearch: { limit: 8 },
    });
    const answer =
      input.useOpenAI && process.env.OPENAI_API_KEY
        ? (
            await service.ask(input.query, {
              limit: 12,
              basicSearch: { limit: 8 },
              responseStyle: "concise repository answer with source file citations",
              temperature: 0,
              maxTokens: 1_200,
            })
          ).answer
        : undefined;

    writeJson(response, 200, {
      snapshot: result.snapshot,
      repo: result.source,
      repoPath: result.repoPath,
      clonedFrom: result.clonedFrom,
      provider: result.provider,
      mode: result.mode,
      model: result.extractionModel,
      stats,
      files: result.files.map((file) => ({
        path: file.path,
        kind: file.kind,
        bytes: file.bytes,
      })),
      answer,
      retrieval,
    });
  } catch (error) {
    writeJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleStudioQueryRequest(
  service: GraphRagService,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  mode: "ask" | "search",
): Promise<void> {
  try {
    if (request.method !== "GET" && request.method !== "POST") {
      writeJson(response, 405, { error: "Use GET or POST." });
      return;
    }

    const input =
      request.method === "POST"
        ? parseStudioQueryInput(await readJsonBody(request), url)
        : parseStudioQueryInput(undefined, url);
    const result =
      mode === "ask"
        ? await service.ask(input.query, {
            limit: input.limit,
            includeTextSearch: input.includeTextSearch,
            maxContextChars: input.maxContextChars,
          })
        : await service.searchGraph(input.query, {
            limit: input.limit,
            includeTextSearch: input.includeTextSearch,
            maxContextChars: input.maxContextChars,
          });
    writeJson(response, 200, result);
  } catch (error) {
    writeJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function parseStudioQueryInput(
  value: unknown,
  url: URL,
): {
  query: string;
  limit: number;
  includeTextSearch: boolean;
  maxContextChars: number;
} {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const queryValue =
    typeof record.query === "string"
      ? record.query
      : typeof record.q === "string"
        ? record.q
        : (url.searchParams.get("query") ?? url.searchParams.get("q") ?? "");
  const query = queryValue.trim();
  if (!query) {
    throw new Error("Missing query. Pass ?query=... or a JSON body with query.");
  }

  const limitValue =
    typeof record.limit === "number" || typeof record.limit === "string"
      ? record.limit
      : (url.searchParams.get("limit") ?? "12");
  const maxContextValue =
    typeof record.maxContextChars === "number" || typeof record.maxContextChars === "string"
      ? record.maxContextChars
      : (url.searchParams.get("maxContextChars") ?? "12000");
  const includeTextValue =
    typeof record.includeTextSearch === "boolean"
      ? record.includeTextSearch
      : url.searchParams.get("includeTextSearch");

  return {
    query,
    limit: boundedInt(limitValue, 1, 50, 12),
    includeTextSearch:
      includeTextValue === null ? true : includeTextValue !== false && includeTextValue !== "false",
    maxContextChars: boundedInt(maxContextValue, 1_000, 40_000, 12_000),
  };
}

async function runStudio(command: StudioCommand): Promise<void> {
  const snapshot = await loadSnapshot(command.snapshotPath);
  const studioService = createMemoryGraphRagService();
  await studioService.ingestSnapshot(snapshot);
  const title = command.snapshotPath
    ? `GraphRAG Studio: ${command.snapshotPath}`
    : "GraphRAG Studio";
  const html = await loadStudioIndexHtml(snapshot, title);

  if (command.exportHtmlPath) {
    await writeFile(
      resolve(command.exportHtmlPath),
      await renderExportHtml(snapshot, title),
      "utf8",
    );
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${command.host}:${command.port}`);

    if (url.pathname === "/document-graph.json") {
      if (request.method !== "POST") {
        writeJson(response, 405, { error: "Use POST." });
        return;
      }
      void handleDocumentGraphRequest(request, response);
      return;
    }

    if (url.pathname === "/repo-graph.json") {
      if (request.method !== "POST") {
        writeJson(response, 405, { error: "Use POST." });
        return;
      }
      void handleRepoGraphRequest(request, response);
      return;
    }

    if (url.pathname === "/" || url.pathname === "/studio" || url.pathname === "/preview") {
      response.writeHead(200, {
        "content-type": contentType(url.pathname),
        "cache-control": "no-store",
      });
      response.end(html);
      return;
    }

    if (url.pathname.startsWith("/assets/")) {
      readFile(join(studioDistDir, url.pathname.replace(/^\//, "")))
        .then((asset) => {
          response.writeHead(200, {
            "content-type": contentType(url.pathname),
            "cache-control": "no-store",
          });
          response.end(asset);
        })
        .catch(() => {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
        });
      return;
    }

    if (url.pathname === "/snapshot.json") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(snapshot, null, 2));
      return;
    }

    if (url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify({
          ok: true,
          openaiEnabled: Boolean(process.env.OPENAI_API_KEY),
          openaiModel: process.env.GRAG_OPENAI_MODEL ?? "gpt-5.4-mini",
          maxUploadBytes: maxUploadBytes(),
        }),
      );
      return;
    }

    if (url.pathname === "/retrieval.json") {
      const query = url.searchParams.get("query") ?? url.searchParams.get("q") ?? "";
      const limit = Number(url.searchParams.get("limit") ?? "12");
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify(
          retrieveFromGraphRagSnapshot(snapshot, query, {
            limit: Number.isFinite(limit) ? limit : 12,
          }),
          null,
          2,
        ),
      );
      return;
    }

    if (url.pathname === "/search.json") {
      void handleStudioQueryRequest(studioService, request, response, url, "search");
      return;
    }

    if (url.pathname === "/ask.json") {
      void handleStudioQueryRequest(studioService, request, response, url, "ask");
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(command.port, command.host, () => resolveListen());
  });

  const url = `http://${command.host}:${command.port}`;
  console.log(`GraphRAG Studio running at ${url}`);
  console.log(
    command.snapshotPath
      ? `Snapshot: ${resolve(command.snapshotPath)}`
      : "Snapshot: built-in sample",
  );
  if (command.exportHtmlPath) {
    console.log(`HTML: ${resolve(command.exportHtmlPath)}`);
  }
  console.log("Press Ctrl+C to stop.");

  if (command.open) {
    openUrl(url);
  }
}

async function runRetrieve(command: RetrieveCommand): Promise<void> {
  const snapshot = await loadSnapshot(command.snapshotPath);
  const result = retrieveFromGraphRagSnapshot(
    snapshot,
    command.query,
    command.limit === undefined ? {} : { limit: command.limit },
  );
  console.log(JSON.stringify(result, null, 2));
}

async function runRepo(command: RepoCommand): Promise<void> {
  const snapshotPath =
    command.snapshotPath ??
    (command.studio ? join(tmpdir(), `grag-repo-${Date.now()}.snapshot.json`) : undefined);
  const result = await indexRepository({
    source: command.repo,
    provider: "auto",
    scan: {
      ...(command.maxFiles ? { maxFiles: command.maxFiles } : {}),
      ...(command.maxFileBytes ? { maxFileBytes: command.maxFileBytes } : {}),
      keepClone: command.keepClone,
    },
    extraction: {
      provider:
        command.useOpenAI === true ? "openai" : command.useOpenAI === false ? "local" : "auto",
      ...(command.model ? { model: command.model } : {}),
      ...(command.maxCorpusChars ? { maxCorpusChars: command.maxCorpusChars } : {}),
    },
  });
  const service = createRepoService(command.useOpenAI, command.answerModel ?? command.model);
  await service.ingestSnapshot(result.snapshot);
  const stats = await service.stats();
  const retrieval = command.query
    ? await service.retrieve(command.query, {
        useBasicSearch: true,
        limit: 12,
        basicSearch: { limit: 8 },
      })
    : undefined;
  const answer =
    command.query && command.useOpenAI !== false && process.env.OPENAI_API_KEY
      ? (
          await service.ask(command.query, {
            limit: 12,
            basicSearch: { limit: 8 },
            responseStyle: "concise repository answer with source file citations",
            temperature: 0,
            maxTokens: 1_200,
          })
        ).answer
      : undefined;

  if (snapshotPath) {
    await writeFile(resolve(snapshotPath), JSON.stringify(result.snapshot, null, 2), "utf8");
  }

  console.log(
    `Repository index built from ${result.files.length} files from ${result.clonedFrom ?? result.repoPath}`,
  );
  console.log(`Provider: ${result.provider}`);
  console.log(
    `Mode: ${result.mode}${result.extractionModel ? ` (${result.extractionModel})` : ""}`,
  );
  console.log(
    `Stats: ${stats.documents} documents, ${stats.textUnits} text units, ${stats.entities} entities, ${stats.relationships} relationships, ${stats.communities} communities`,
  );
  if (snapshotPath) {
    console.log(`Snapshot: ${resolve(snapshotPath)}`);
  }

  if (retrieval) {
    console.log("");
    console.log(`Question: ${command.query ?? ""}`);
    if (answer) {
      console.log("");
      console.log(answer);
    }
    console.log("");
    console.log("Top graph hits:");
    for (const [index, hit] of retrieval.hits.slice(0, 6).entries()) {
      const sources =
        hit.sourcePaths.length > 0 ? ` sources=${hit.sourcePaths.slice(0, 3).join(", ")}` : "";
      console.log(`${index + 1}. [${hit.kind}] ${hit.title} score=${hit.score}${sources}`);
    }
  }

  if (command.studio && snapshotPath) {
    console.log("");
    await runStudio({
      command: "studio",
      host: command.host,
      port: command.port,
      open: command.open,
      snapshotPath,
    });
  }
}

async function main(): Promise<void> {
  await loadDotEnv();
  const command = parseArgs(process.argv.slice(2));

  if (command.command === "help") {
    console.log(helpText);
    return;
  }

  if (command.command === "retrieve") {
    await runRetrieve(command);
    return;
  }

  if (command.command === "repo") {
    await runRepo(command);
    return;
  }

  await runStudio(command);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
