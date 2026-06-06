import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRepositoryIndexSnapshot,
  buildRepositoryCorpus,
  createMemoryGraphRagService,
  indexRepository,
  scanRepository,
} from "../src/index.js";

describe("repository index API", () => {
  it("scans a repository and builds a queryable local graph", async () => {
    const repo = await mkdtemp(join(tmpdir(), "grag-demo-repo-"));
    await mkdir(join(repo, "src"));
    await mkdir(join(repo, "docs"));
    await writeFile(
      join(repo, "README.md"),
      "# Demo Repo\n\nThis repository has a GraphRAG docs engine and OpenAI indexing workflow.",
      "utf8",
    );
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({
        name: "demo-repo",
        scripts: {
          index: "node src/index.ts",
        },
      }),
      "utf8",
    );
    await writeFile(
      join(repo, "src", "index.ts"),
      [
        "export function buildDocsGraph() {",
        "  return 'Postgres stores GraphRAG entities, relationships, and text units';",
        "}",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(repo, "docs", "storage.md"),
      [
        "# Storage",
        "",
        "The docs engine uses Postgres and @farming-labs/orm for durable GraphRAG storage.",
      ].join("\n"),
      "utf8",
    );

    const result = await indexRepository({
      source: repo,
      provider: "local",
      scan: { maxFiles: 8 },
      extraction: { provider: "local" },
    });
    const service = createMemoryGraphRagService();
    await service.ingestSnapshot(result.snapshot);
    const stats = await service.stats();
    const retrieval = await service.retrieve("How does the repo store GraphRAG data?", {
      useBasicSearch: true,
      limit: 12,
      basicSearch: { limit: 8 },
    });

    expect(result.mode).toBe("local");
    expect(result.files.map((file) => file.path)).toContain("README.md");
    expect(stats.entities).toBeGreaterThan(0);
    expect(retrieval.hits.length).toBeGreaterThan(0);

    const entityTitles = result.snapshot.entities.map((entity) => entity.title);
    expect(entityTitles).toContain("README.md");
    expect(entityTitles).toContain("src/index.ts");
    expect(entityTitles).toContain("docs/storage.md");
    expect(entityTitles).toContain("demo-repo");
    expect(entityTitles).toContain("buildDocsGraph");
    expect(entityTitles).toContain("Relational Storage");
    expect(entityTitles).not.toContain("Promise");
    expect(entityTitles).not.toContain("z.string");
    expect(result.snapshot.relationships.length).toBeGreaterThan(4);
  });

  it("builds a repo corpus with source provenance headings", async () => {
    const repo = await mkdtemp(join(tmpdir(), "grag-corpus-repo-"));
    await writeFile(join(repo, "README.md"), "# Demo\n\nGraphRAG indexes source files.", "utf8");

    const scanned = await scanRepository({ source: repo, provider: "local" });
    const files = scanned.files;
    const corpus = buildRepositoryCorpus({
      repoName: "demo",
      repoPath: repo,
      files,
    });

    expect(corpus).toContain("## File: README.md");
    expect(corpus).toContain("Preserve the File path as source provenance");
    expect(corpus).toContain("Repository Index Corpus");
    expect(corpus).not.toContain("Repository GraphRAG Corpus");
  });

  it("exposes provider-aware generic repository scanning and indexing APIs", async () => {
    const repo = await mkdtemp(join(tmpdir(), "grag-generic-repo-"));
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(join(repo, "README.md"), "# Generic Index\n", "utf8");
    await writeFile(join(repo, "src", "index.ts"), "export const search = 'repo ask ai';", "utf8");

    const scanned = await scanRepository({
      source: repo,
      provider: "local",
      maxFiles: "all",
    });

    try {
      expect(scanned.provider).toBe("local");
      expect(scanned.repoPath).toBe(repo);
      expect(scanned.files.map((file) => file.path)).toContain("src/index.ts");

      const built = await buildRepositoryIndexSnapshot({
        repoPath: scanned.repoPath,
        files: scanned.files,
        extraction: { provider: "local" },
      });

      expect(built.mode).toBe("local");
      expect(built.snapshot.documents.length).toBe(scanned.files.length);
    } finally {
      await scanned.cleanup();
    }

    const indexed = await indexRepository({
      source: repo,
      provider: "local",
      scan: { maxFiles: "all" },
      extraction: { provider: "local" },
    });

    expect(indexed.provider).toBe("local");
    expect(indexed.mode).toBe("local");
    expect(indexed.files.map((file) => file.path)).toContain("README.md");
    expect(indexed.snapshot.entities.length).toBeGreaterThan(0);
  });

  it("clones remote repository sources with branch or tag selection", async () => {
    const repo = await mkdtemp(join(tmpdir(), "grag-remote-repo-"));
    await runGit(repo, ["init", "--initial-branch=main"]);
    await writeFile(join(repo, "README.md"), "# Main\n", "utf8");
    await runGit(repo, ["add", "."]);
    await runGit(repo, [
      "-c",
      "user.name=GRAG Test",
      "-c",
      "user.email=grag@example.com",
      "commit",
      "-m",
      "main",
    ]);
    await runGit(repo, ["checkout", "-b", "docs"]);
    await mkdir(join(repo, "docs"), { recursive: true });
    await writeFile(
      join(repo, "docs", "github.md"),
      "# GitHub SaaS\n\nAsk AI indexes this branch.",
      "utf8",
    );
    await runGit(repo, ["add", "."]);
    await runGit(repo, [
      "-c",
      "user.name=GRAG Test",
      "-c",
      "user.email=grag@example.com",
      "commit",
      "-m",
      "docs branch",
    ]);

    const indexed = await indexRepository({
      source: repo,
      provider: "git",
      remote: { ref: "docs" },
      scan: { maxFiles: "all" },
      extraction: { provider: "local" },
    });

    expect(indexed.provider).toBe("git");
    expect(indexed.clonedFrom).toBe(repo);
    expect(indexed.files.map((file) => file.path)).toContain("docs/github.md");
  });

  it("indexes every eligible repository file by default", async () => {
    const repo = await mkdtemp(join(tmpdir(), "grag-all-files-repo-"));
    await mkdir(join(repo, "src"), { recursive: true });
    await mkdir(join(repo, "docs"), { recursive: true });
    await mkdir(join(repo, "node_modules", "ignored"), { recursive: true });

    await writeFile(join(repo, "README.md"), "# Demo\n", "utf8");
    await writeFile(join(repo, "src", "index.ts"), "export const index = true;", "utf8");
    await writeFile(join(repo, "src", "auth.ts"), "export const auth = true;", "utf8");
    await writeFile(join(repo, "docs", "guide.md"), "# Guide\n", "utf8");
    await writeFile(
      join(repo, "node_modules", "ignored", "package.json"),
      JSON.stringify({ name: "ignored" }),
      "utf8",
    );

    const scanned = await scanRepository({ source: repo, provider: "local" });
    const files = scanned.files;
    const paths = files.map((file) => file.path);

    expect(paths).toContain("README.md");
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("src/auth.ts");
    expect(paths).toContain("docs/guide.md");
    expect(paths).not.toContain("node_modules/ignored/package.json");
  });

  it("balances large repo scans so docs and examples do not crowd out package source", async () => {
    const repo = await mkdtemp(join(tmpdir(), "grag-balanced-repo-"));
    await mkdir(join(repo, "docs", "content", "docs"), { recursive: true });
    await mkdir(join(repo, "examples", "web", "src"), { recursive: true });
    await mkdir(join(repo, "packages", "core", "src", "plugins"), { recursive: true });
    await mkdir(join(repo, "packages", "cli", "src", "commands"), { recursive: true });
    await mkdir(join(repo, "packages", "cli", "src", "generators"), { recursive: true });
    await writeFile(join(repo, "README.md"), "# Workspace\n", "utf8");
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({ name: "example-workspace" }),
      "utf8",
    );
    await writeFile(
      join(repo, "packages", "cli", "src", "commands", "migrate.ts"),
      "export const migrate = 'run migrations';",
      "utf8",
    );
    await writeFile(
      join(repo, "packages", "cli", "src", "generators", "prisma.ts"),
      "export const prisma = 'generate prisma schema';",
      "utf8",
    );

    for (let index = 0; index < 80; index += 1) {
      await writeFile(
        join(repo, "docs", "content", "docs", `guide-${index}.mdx`),
        `# Guide ${index}\n\nAuth docs.`,
        "utf8",
      );
      await writeFile(
        join(repo, "examples", "web", "src", `screen-${index}.tsx`),
        `export const Screen${index} = '${index}';`,
        "utf8",
      );
      await writeFile(
        join(repo, "packages", "core", "src", "plugins", `plugin-${index}.ts`),
        `export function plugin${index}() { return 'session adapter oauth'; }`,
        "utf8",
      );
    }

    const scanned = await scanRepository({
      source: repo,
      provider: "local",
      maxFiles: 60,
      maxFileBytes: 8_000,
    });
    const files = scanned.files;
    const paths = files.map((file) => file.path);

    expect(
      paths.filter((path) => path.startsWith("packages/core/src/")).length,
    ).toBeGreaterThanOrEqual(16);
    expect(paths.filter((path) => path.startsWith("docs/content/docs/")).length).toBeLessThan(30);
    expect(paths).toContain("README.md");
    expect(paths).toContain("packages/cli/src/commands/migrate.ts");
    expect(paths).toContain("packages/cli/src/generators/prisma.ts");
  });
});

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolveCommand, rejectCommand) => {
    const child = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
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
          `git ${args.join(" ")} failed with exit code ${code ?? "unknown"}.\n${Buffer.concat(stderr).toString("utf8").trim()}`,
        ),
      );
    });
  });
}
