import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import type { GraphRagSnapshot, JsonObject } from "../model.js";
import { extractDocumentGraphWithOpenAI } from "../studio/openai.js";
import { buildLocalRepositoryGraphRagSnapshot } from "./local-graph.js";

export type RepositoryFileLimit = number | "all";
export type RepositorySourceProvider = "auto" | "local" | "git" | "github";
export type RepositoryExtractionProvider = "auto" | "local" | "openai";

export interface RepositorySourceFile {
  path: string;
  absolutePath: string;
  kind: string;
  bytes: number;
  text: string;
}

export interface RepositoryRemoteOptions {
  /**
   * Branch or tag to clone. Omit this to use the repository default branch.
   */
  ref?: string;
  /**
   * Short-lived token for private repositories. For GitHub App installs, pass
   * the installation access token here.
   */
  token?: string;
}

export interface RepositoryScanOptions {
  source: string;
  provider?: RepositorySourceProvider;
  remote?: RepositoryRemoteOptions;
  maxFiles?: RepositoryFileLimit;
  maxFileBytes?: number;
  keepClone?: boolean;
}

export interface RepositoryScanResult {
  source: string;
  provider: Exclude<RepositorySourceProvider, "auto">;
  repoPath: string;
  clonedFrom?: string;
  files: RepositorySourceFile[];
  cleanup(): Promise<void>;
}

export interface BuildRepositoryIndexSnapshotOptions {
  repoName?: string;
  repoPath: string;
  files: readonly RepositorySourceFile[];
  extraction?: {
    provider?: RepositoryExtractionProvider;
    apiKey?: string;
    model?: string;
    maxCorpusChars?: number;
  };
}

export interface BuildRepositoryIndexSnapshotResult {
  snapshot: GraphRagSnapshot;
  mode: "openai" | "local";
  extractionModel?: string;
}

export interface IndexRepositoryOptions {
  source: string;
  provider?: RepositorySourceProvider;
  repoName?: string;
  remote?: RepositoryRemoteOptions;
  scan?: {
    maxFiles?: RepositoryFileLimit;
    maxFileBytes?: number;
    keepClone?: boolean;
  };
  extraction?: BuildRepositoryIndexSnapshotOptions["extraction"];
}

export interface IndexRepositoryResult extends BuildRepositoryIndexSnapshotResult {
  source: string;
  provider: Exclude<RepositorySourceProvider, "auto">;
  repoPath: string;
  clonedFrom?: string;
  files: RepositorySourceFile[];
}

interface PreparedRepository {
  repoPath: string;
  clonedFrom?: string;
  tempDir?: string;
  provider: Exclude<RepositorySourceProvider, "auto">;
}

const DEFAULT_MAX_FILE_BYTES = 28_000;
const DEFAULT_MAX_CORPUS_CHARS = 180_000;
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const SKIP_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".pnpm-store",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "tmp",
  "vendor",
]);
const SKIP_FILENAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const TEXT_EXTENSIONS = new Set([
  ".astro",
  ".cjs",
  ".css",
  ".go",
  ".graphql",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sql",
  ".svelte",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
]);

export async function scanRepository(
  options: RepositoryScanOptions,
): Promise<RepositoryScanResult> {
  const prepared = await prepareRepository(
    options.source,
    options.provider ?? "auto",
    options.remote,
  );
  const files = await scanRepositorySourceFiles(prepared.repoPath, {
    ...(options.maxFiles === undefined ? {} : { maxFiles: options.maxFiles }),
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
  });

  return {
    source: options.source,
    provider: prepared.provider,
    repoPath: prepared.repoPath,
    ...(prepared.clonedFrom ? { clonedFrom: prepared.clonedFrom } : {}),
    files,
    cleanup: async () => {
      if (prepared.tempDir && !options.keepClone) {
        await rm(prepared.tempDir, { recursive: true, force: true });
      }
    },
  };
}

export async function indexRepository(
  options: IndexRepositoryOptions,
): Promise<IndexRepositoryResult> {
  const scanned = await scanRepository({
    source: options.source,
    provider: options.provider ?? "auto",
    ...(options.remote ? { remote: options.remote } : {}),
    ...(options.scan?.maxFiles === undefined ? {} : { maxFiles: options.scan.maxFiles }),
    ...(options.scan?.maxFileBytes === undefined
      ? {}
      : { maxFileBytes: options.scan.maxFileBytes }),
    ...(options.scan?.keepClone === undefined ? {} : { keepClone: options.scan.keepClone }),
  });

  try {
    const result = await buildRepositoryIndexSnapshot({
      repoName: options.repoName ?? repositoryNameFromInput(options.source, scanned.repoPath),
      repoPath: scanned.repoPath,
      files: scanned.files,
      ...(options.extraction ? { extraction: options.extraction } : {}),
    });

    return {
      ...result,
      source: options.source,
      provider: scanned.provider,
      repoPath: scanned.repoPath,
      ...(scanned.clonedFrom ? { clonedFrom: scanned.clonedFrom } : {}),
      files: scanned.files,
    };
  } finally {
    await scanned.cleanup();
  }
}

async function scanRepositorySourceFiles(
  repoPath: string,
  options: {
    maxFiles?: RepositoryFileLimit;
    maxFileBytes?: number;
  } = {},
): Promise<RepositorySourceFile[]> {
  const root = resolve(repoPath);
  const candidates: string[] = [];
  await walkRepository(root, root, candidates);

  const maxFiles = normalizeRepositoryFileLimit(options.maxFiles);
  const maxFileBytes = Math.max(1_000, options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
  const selected =
    maxFiles === "all"
      ? [...candidates].sort(
          (left, right) => filePriority(left) - filePriority(right) || left.localeCompare(right),
        )
      : selectRepositoryCandidates(candidates, maxFiles * 3, maxFiles);
  const files: RepositorySourceFile[] = [];

  for (const path of selected) {
    if (maxFiles !== "all" && files.length >= maxFiles) {
      break;
    }

    const absolutePath = join(root, path);
    const info = await stat(absolutePath);
    if (!info.isFile() || info.size > maxFileBytes * 8) {
      continue;
    }

    const raw = await readFile(absolutePath, "utf8");
    const text = normalizeText(raw).slice(0, maxFileBytes);
    if (!text || looksBinary(text)) {
      continue;
    }

    files.push({
      path,
      absolutePath,
      kind: classifyRepositoryFile(path),
      bytes: info.size,
      text,
    });
  }

  return files;
}

function normalizeRepositoryFileLimit(limit: RepositoryFileLimit | undefined): RepositoryFileLimit {
  if (limit === undefined || limit === "all") {
    return "all";
  }

  return Math.max(1, limit);
}

export async function buildRepositoryIndexSnapshot(
  options: BuildRepositoryIndexSnapshotOptions,
): Promise<BuildRepositoryIndexSnapshotResult> {
  const repoName = options.repoName ?? basename(options.repoPath);
  const corpus = buildRepositoryCorpus({
    repoName,
    repoPath: options.repoPath,
    files: options.files,
    maxCorpusChars: options.extraction?.maxCorpusChars ?? DEFAULT_MAX_CORPUS_CHARS,
  });
  const extractionProvider = options.extraction?.provider ?? "auto";
  const apiKey = options.extraction?.apiKey ?? process.env.OPENAI_API_KEY;
  const shouldUseOpenAI =
    extractionProvider === "openai" || (extractionProvider === "auto" && Boolean(apiKey));

  if (shouldUseOpenAI && apiKey) {
    const result = await extractDocumentGraphWithOpenAI(
      {
        filename: `${repoName}-repository-corpus.txt`,
        mimeType: "text/plain",
        text: corpus,
      },
      {
        apiKey,
        model: options.extraction?.model ?? process.env.GRAG_OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
      },
    );

    return {
      snapshot: annotateRepositorySnapshot(result.snapshot, {
        repoName,
        repoPath: options.repoPath,
        files: options.files,
        generatedBy: `openai:${result.model}`,
      }),
      mode: "openai",
      extractionModel: result.model,
    };
  }

  return {
    snapshot: annotateRepositorySnapshot(
      buildLocalRepositoryGraphRagSnapshot({
        repoName,
        repoPath: options.repoPath,
        selectedFiles: options.files,
      }),
      {
        repoName,
        repoPath: options.repoPath,
        files: options.files,
        generatedBy: "@farming-labs/grag/repository-index",
      },
    ),
    mode: "local",
  };
}

export function buildRepositoryCorpus(options: {
  repoName: string;
  repoPath: string;
  files: readonly RepositorySourceFile[];
  maxCorpusChars?: number;
}): string {
  const maxChars = Math.max(5_000, options.maxCorpusChars ?? DEFAULT_MAX_CORPUS_CHARS);
  const header = [
    `# Repository Index Corpus: ${options.repoName}`,
    `Repository path: ${options.repoPath}`,
    `Selected files: ${options.files.length}`,
    "",
    "Each section below is one source file. Preserve the File path as source provenance when extracting entities, relationships, communities, and retrieval evidence.",
    "Keep exact package names, table names, column names, function names, CLI flags, and environment variables in the extracted graph. These identifiers are core source evidence.",
  ].join("\n");
  const blocks: string[] = [header];
  let used = header.length;

  for (const file of options.files) {
    const extension = extname(file.path).replace(/^\./, "") || "txt";
    const block = [
      "",
      `## File: ${file.path}`,
      `Kind: ${file.kind}`,
      "```" + extension,
      file.text,
      "```",
    ].join("\n");
    if (used + block.length > maxChars) {
      break;
    }
    blocks.push(block);
    used += block.length;
  }

  return blocks.join("\n");
}

async function prepareRepository(
  repo: string,
  provider: RepositorySourceProvider = "auto",
  remote: RepositoryRemoteOptions = {},
): Promise<PreparedRepository> {
  const resolvedProvider = resolveRepositoryProvider(repo, provider);
  if (resolvedProvider === "local") {
    return {
      repoPath: resolve(repo),
      provider: "local",
    };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "grag-repo-"));
  const cloneUrl = resolvedProvider === "github" ? githubRemoteUrl(repo) : repo;
  const cloneArgs = [
    "clone",
    "--depth=1",
    ...(remote.ref ? ["--branch", remote.ref, "--single-branch"] : []),
    cloneUrl,
    tempDir,
  ];
  await runCommand("git", cloneArgs, {
    env: gitRemoteEnvironment(resolvedProvider, remote),
  });
  return {
    repoPath: tempDir,
    clonedFrom: cloneUrl,
    tempDir,
    provider: resolvedProvider,
  };
}

function gitRemoteEnvironment(
  provider: Exclude<RepositorySourceProvider, "auto">,
  remote: RepositoryRemoteOptions,
): Record<string, string> {
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
  };

  if (provider === "github" && remote.token) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${remote.token}`).toString("base64")}`;
  }

  return env;
}

function resolveRepositoryProvider(
  source: string,
  provider: RepositorySourceProvider,
): Exclude<RepositorySourceProvider, "auto"> {
  if (provider !== "auto") {
    return provider;
  }

  if (isGitHubRepository(source)) {
    return "github";
  }

  if (isGitRemote(source)) {
    return "git";
  }

  return "local";
}

function isGitHubRepository(value: string): boolean {
  const input = value.trim();
  if (/^https?:\/\/github\.com\//i.test(input) || /^git@github\.com:/i.test(input)) {
    return true;
  }
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+(?:\.git)?$/i.test(input);
}

function githubRemoteUrl(value: string): string {
  const input = value.trim();
  if (/^https?:\/\//i.test(input) || /^git@github\.com:/i.test(input)) {
    return input;
  }
  return `https://github.com/${input.replace(/\.git$/i, "")}.git`;
}

async function walkRepository(root: string, current: string, output: string[]): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (
        SKIP_DIRECTORIES.has(entry.name) ||
        (entry.name.startsWith(".") && entry.name !== ".github")
      ) {
        continue;
      }
      await walkRepository(root, join(current, entry.name), output);
      continue;
    }

    if (!entry.isFile() || SKIP_FILENAMES.has(entry.name)) {
      continue;
    }

    const absolutePath = join(current, entry.name);
    const path = relative(root, absolutePath).split(sep).join("/");
    if (isTextRepositoryFile(path)) {
      output.push(path);
    }
  }
}

function isGitRemote(value: string): boolean {
  return /^(?:https?:\/\/|ssh:\/\/|git@)/.test(value) || /\.git(?:#.+)?$/.test(value);
}

function repositoryNameFromInput(input: string, repoPath: string): string {
  const ownerName = input.trim().match(/^[a-z0-9_.-]+\/([a-z0-9_.-]+)$/i);
  if (ownerName?.[1]) {
    return ownerName[1].replace(/\.git$/i, "");
  }

  const scpLike = input.trim().match(/^[^:]+:[^/]+\/([^/]+?)(?:\.git)?$/i);
  if (scpLike?.[1]) {
    return scpLike[1].replace(/\.git$/i, "");
  }

  try {
    const url = new URL(input);
    const repoName = url.pathname.split("/").filter(Boolean).at(-1);
    if (repoName) {
      return repoName.replace(/\.git$/i, "");
    }
  } catch {
    // Local paths fall through to the resolved directory name.
  }

  return basename(repoPath);
}

function isTextRepositoryFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  if (name === "dockerfile" || name === "makefile" || name.startsWith("readme")) {
    return true;
  }
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

function selectRepositoryCandidates(
  candidates: readonly string[],
  candidateLimit: number,
  targetFiles: number,
): string[] {
  const ranked = [...candidates].sort(
    (left, right) => filePriority(left) - filePriority(right) || left.localeCompare(right),
  );
  const selected: string[] = [];
  const seen = new Set<string>();
  const groupCounts = new Map<string, number>();
  const groupLimit = Math.max(8, Math.ceil(targetFiles * 0.18));

  const push = (path: string): boolean => {
    if (seen.has(path) || selected.length >= candidateLimit) {
      return false;
    }

    const group = repositorySelectionGroup(path);
    if (!isEssentialRepositoryFile(path) && (groupCounts.get(group) ?? 0) >= groupLimit) {
      return false;
    }

    seen.add(path);
    selected.push(path);
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
    return true;
  };

  for (const path of ranked.filter(isEssentialRepositoryFile)) {
    push(path);
  }

  const queues = new Map<string, string[]>();
  for (const path of ranked) {
    if (seen.has(path)) {
      continue;
    }

    const group = repositorySelectionGroup(path);
    queues.set(group, [...(queues.get(group) ?? []), path]);
  }

  while (selected.length < candidateLimit && queues.size > 0) {
    let progressed = false;
    const groups = [...queues.entries()].sort((left, right) => {
      const leftCount = groupCounts.get(left[0]) ?? 0;
      const rightCount = groupCounts.get(right[0]) ?? 0;
      const leftNext = left[1][0] ?? "";
      const rightNext = right[1][0] ?? "";
      return (
        leftCount - rightCount ||
        filePriority(leftNext) - filePriority(rightNext) ||
        left[0].localeCompare(right[0])
      );
    });

    for (const [group, queue] of groups) {
      while (queue.length > 0 && seen.has(queue[0] ?? "")) {
        queue.shift();
      }

      const path = queue.shift();
      if (!path) {
        queues.delete(group);
        continue;
      }

      if (push(path)) {
        progressed = true;
      }

      if (queue.length === 0) {
        queues.delete(group);
      } else {
        queues.set(group, queue);
      }

      if (selected.length >= candidateLimit) {
        break;
      }
    }

    if (!progressed) {
      for (const queue of queues.values()) {
        const path = queue.find((candidate) => !seen.has(candidate));
        if (path) {
          seen.add(path);
          selected.push(path);
          progressed = true;
          break;
        }
      }
    }

    if (!progressed) {
      break;
    }
  }

  return selected;
}

function isEssentialRepositoryFile(path: string): boolean {
  const lower = path.toLowerCase();
  const name = basename(lower);

  return (
    [
      "readme.md",
      "package.json",
      "pnpm-workspace.yaml",
      "turbo.json",
      "tsconfig.json",
      "biome.json",
      "eslint.config.js",
      "eslint.config.mjs",
    ].includes(name) ||
    /^packages\/[^/]+\/package\.json$/.test(lower) ||
    /^packages\/[^/]+\/src\/(?:index|main|server|client|handler|api|auth|plugin|adapter)\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(
      lower,
    ) ||
    /^packages\/[^/]+\/src\/(?:adapters|api|cookies|db|oauth2|social-providers|types|utils)\//.test(
      lower,
    ) ||
    /^packages\/[^/]+\/src\/(?:commands|generators)\//.test(lower) ||
    /^packages\/[^/]+\/src\/client\/plugins\//.test(lower) ||
    /^packages\/[^/]+\/src\/plugins\/(?:generic-oauth|jwt|magic-link|multi-session|oauth-proxy|oidc-provider|organization|passkey|sso|two-factor)\//.test(
      lower,
    )
  );
}

function repositorySelectionGroup(path: string): string {
  const parts = path.split("/");
  if (parts[0] === "packages" && parts[1]) {
    return `packages/${parts[1]}`;
  }

  if (parts[0] === "examples" && parts[1]) {
    return `examples/${parts[1]}`;
  }

  if (parts[0] === "docs" && parts[1] === "content" && parts[2]) {
    return `docs/content/${parts[2]}`;
  }

  if (parts[0] === "docs") {
    return parts[1] ? `docs/${parts[1]}` : "docs";
  }

  if (parts[0] === "demo" && parts[1]) {
    return `demo/${parts[1]}`;
  }

  return parts[0] ?? "root";
}

function filePriority(path: string): number {
  const lower = path.toLowerCase();
  let score = 0;

  if (basename(lower).startsWith("readme")) score -= 240;
  if (basename(lower) === "package.json") score -= 220;
  if (basename(lower) === "docs.json" || basename(lower).includes("config")) score -= 120;
  if (/^packages\/[^/]+\/src\//.test(lower)) score -= 240;
  else if (lower.startsWith("src/") || lower.includes("/src/")) score -= 120;
  if (lower.startsWith("packages/")) score -= 80;
  if (lower.includes("/plugins/")) score -= 90;
  if (lower.includes("/adapters/")) score -= 80;
  if (lower.includes("/db/") || lower.includes("/database/")) score -= 70;
  if (lower.includes("/commands/") || lower.includes("/generators/")) score -= 75;
  if (lower.includes("/oauth") || lower.includes("/social")) score -= 65;
  if (lower.includes("/session")) score -= 65;
  if (lower.startsWith("docs/") || lower.includes("/docs/")) score -= 90;
  if (lower.startsWith("app/") || lower.includes("/app/")) score -= 90;
  if (lower.startsWith("examples/") || lower.includes("/examples/")) score -= 25;
  if (lower.startsWith("test") || lower.includes("/test") || lower.includes(".test.")) score += 50;
  if (lower.includes("generated") || lower.includes(".min.")) score += 300;
  if (extname(lower) === ".md" || extname(lower) === ".mdx") score -= 40;
  if (extname(lower) === ".ts" || extname(lower) === ".tsx") score -= 20;

  return score + lower.split("/").length * 4;
}

function classifyRepositoryFile(path: string): string {
  const lower = path.toLowerCase();
  if (basename(lower).startsWith("readme")) return "readme";
  if (basename(lower) === "package.json") return "package-manifest";
  if (lower.startsWith("docs/") || lower.includes("/docs/")) return "docs";
  if (lower.startsWith("examples/") || lower.includes("/examples/")) return "example";
  if (lower.includes(".test.") || lower.includes(".spec.") || lower.startsWith("test"))
    return "test";
  if (
    lower.includes("config") ||
    lower.endsWith(".json") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".toml")
  )
    return "config";
  return "source";
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
}

function looksBinary(value: string): boolean {
  if (!value) {
    return true;
  }

  const sample = value.slice(0, 2_000);
  const suspicious = [...sample].filter((char) => {
    const code = char.charCodeAt(0);
    return (code > 0 && code < 7) || (code > 14 && code < 32);
  }).length;
  return suspicious / sample.length > 0.08;
}

function annotateRepositorySnapshot(
  snapshot: GraphRagSnapshot,
  metadata: {
    repoName: string;
    repoPath: string;
    files: readonly RepositorySourceFile[];
    generatedBy: string;
  },
): GraphRagSnapshot {
  const indexedFiles = metadata.files.map((file) => file.path);
  const baseAttributes: JsonObject = {
    repositoryName: metadata.repoName,
    repositoryPath: metadata.repoPath,
    generatedBy: metadata.generatedBy,
  };

  return {
    ...snapshot,
    documents: snapshot.documents.map((document) => ({
      ...document,
      attributes: {
        ...document.attributes,
        ...baseAttributes,
        indexedFiles,
      },
    })),
    textUnits: snapshot.textUnits.map((textUnit) => ({
      ...textUnit,
      attributes: {
        ...textUnit.attributes,
        ...baseAttributes,
      },
    })),
    entities: snapshot.entities.map((entity) => ({
      ...entity,
      attributes: {
        ...entity.attributes,
        ...baseAttributes,
      },
    })),
    relationships: snapshot.relationships.map((relationship) => ({
      ...relationship,
      attributes: {
        ...relationship.attributes,
        ...baseAttributes,
      },
    })),
    communities: snapshot.communities.map((community) => ({
      ...community,
      attributes: {
        ...community.attributes,
        ...baseAttributes,
      },
    })),
    communityReports: snapshot.communityReports.map((report) => ({
      ...report,
      attributes: {
        ...report.attributes,
        ...baseAttributes,
      },
    })),
  };
}

async function runCommand(
  command: string,
  args: readonly string[],
  options: {
    env?: Record<string, string>;
  } = {},
): Promise<void> {
  await new Promise<void>((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk) => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.once("error", rejectCommand);
    child.once("close", (code) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      rejectCommand(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}.\n${Buffer.concat(stderr).toString("utf8").trim()}`,
        ),
      );
    });
  });
}
