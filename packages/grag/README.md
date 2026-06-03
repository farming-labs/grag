# @farming-labs/grag

TypeScript primitives for building GraphRAG-style applications with relational database storage.

Microsoft GraphRAG is currently a Python project. This package starts a TypeScript path around the same core artifacts: documents, text units, entities, relationships, covariates, communities, community reports, and embeddings.

## What This Gives You

- A strict TypeScript object model for GraphRAG artifacts.
- An in-memory store for tests and prototypes.
- A SQL/Kysely store designed for relational databases.
- A `@farming-labs/orm` schema/store adapter exposed from `@farming-labs/grag/orm`.
- SQL migrations for Postgres and SQLite-compatible schemas.
- Helpers for turning relational rows into documents.
- Chunking, basic search, local search context, and global search orchestration.
- A dashboard-ready retrieval SDK with `ask`, `searchGraph`, citations, source cards, graph highlight ids, context, stats, and timings.
- A standard indexing pipeline skeleton that mirrors Microsoft GraphRAG phases.

## Install

```bash
npm install @farming-labs/grag kysely
```

Install the database driver for your runtime separately:

```bash
npm install pg
npm install better-sqlite3
npm install mysql2
```

## Relational Database Setup

```ts
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import {
  applyGraphRagMigrations,
  SqlGraphRagStore,
  type GraphRagSqlDatabase
} from "@farming-labs/grag";

const db = new Kysely<GraphRagSqlDatabase>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: process.env.DATABASE_URL })
  })
});

await applyGraphRagMigrations(db, "postgres");

const store = new SqlGraphRagStore({ db });
```

The SQL adapter stores graph artifacts in normalized tables and stores JSON/vector-shaped fields as JSON text. That keeps the first adapter portable across Postgres, SQLite, MySQL-style Kysely dialects, and hosted relational databases. Later, database-specific vector indexing can be added beside this base schema.

## Using `@farming-labs/orm`

This repo can also use the optional Farming Labs ORM package:

```bash
npm install @farming-labs/orm
```

The ORM integration is exported separately so users who only want the lightweight core package do not need to load the ORM runtime:

```ts
import { createMemoryDriver, createOrm } from "@farming-labs/orm";
import {
  graphRagOrmSchema,
  getGraphRagOrmMigrationSql,
  OrmGraphRagStore
} from "@farming-labs/grag/orm";

const orm = createOrm({
  schema: graphRagOrmSchema,
  driver: createMemoryDriver<typeof graphRagOrmSchema>()
});

const store = new OrmGraphRagStore({ orm });

console.log(getGraphRagOrmMigrationSql("postgres"));
```

For Kysely, Drizzle, Prisma, direct SQL, or another Farming Labs ORM driver, keep the same `graphRagOrmSchema` and swap the driver.

## From Relational Rows To GraphRAG Documents

```ts
import { chunkDocuments, relationalRowsToDocuments, MemoryGraphRagStore } from "@farming-labs/grag";

const rows = [
  { id: 1, customer: "Acme", body: "The billing export failed after the migration." },
  { id: 2, customer: "Globex", body: "Password reset worked." }
];

const documents = relationalRowsToDocuments({
  tableName: "support_tickets",
  rows,
  idColumn: "id",
  titleColumn: "customer",
  textColumn: "body"
});

const { documents: linkedDocuments, textUnits } = chunkDocuments(documents);

const store = new MemoryGraphRagStore();
await store.upsertGraph({ documents: linkedDocuments, textUnits });
```

## Query Modes

For app and dashboard code, use the service-level retrieval SDK:

```ts
import { createGraphRagService } from "@farming-labs/grag";
import { OpenAiChatModel, OpenAiEmbeddingModel } from "@farming-labs/grag/openai";

const grag = createGraphRagService({
  store,
  model: new OpenAiChatModel(),
  embeddingModel: new OpenAiEmbeddingModel()
});

const answer = await grag.ask("How does storage support retrieval?", {
  limit: 12,
  responseStyle: "short answer with citations"
});

console.log(answer.answer);
console.log(answer.citations);
console.log(answer.graph.entityIds); // highlight these in a dashboard
```

Use `grag.searchGraph(query)` when you want ranked evidence, citations, context, graph ids, stats, and timings without answer generation. `grag.ask(query)` works without a model too; it returns an extractive cited answer until you pass a `ChatModel`.

`basicSearch` scores text units directly. Without embeddings it uses lexical scoring; with an `EmbeddingModel`, it can use cosine similarity.

`LocalSearchEngine` builds a local context from matching entities, relationships, and text units, then asks your chat model to answer.

`GlobalSearchEngine` follows the GraphRAG global pattern: map over community reports, then reduce partial answers into a final answer.

```ts
import { GlobalSearchEngine, type ChatModel } from "@farming-labs/grag";

const model: ChatModel = {
  async complete(messages) {
    // Wire this to OpenAI, Azure OpenAI, Vercel AI SDK, etc.
    return "answer";
  }
};

const engine = new GlobalSearchEngine({ store, model });
const result = await engine.search("What problems are customers reporting?");
```

See [docs/RETRIEVAL_SDK.md](docs/RETRIEVAL_SDK.md) for dashboard/API examples and the full result shape.

## GraphRAG Studio

The package ships a built-in CLI Studio for inspecting snapshots without wiring up an app first.

```bash
grag studio ./snapshot.json --port 3333 --open
```

Aliases are available when you just want a fast preview:

```bash
grag preview ./snapshot.json
grag --preview ./snapshot.json
```

If you omit the snapshot path, Studio opens with built-in complex sample data. The viewer shows entities, relationships, communities, community reports, node details, source grounding, search highlighting, neighborhood focus, and a retrieval panel that builds context from the graph.

Studio can also turn uploaded files into an active graph. Plain text, Markdown, JSON, CSV, HTML, XML, logs, and code files work locally in the browser. If `OPENAI_API_KEY` is set on the CLI server, Studio can also send PDFs, images, and other rich files to OpenAI and receive an extracted GraphRAG snapshot with entities, relationships, communities, reports, suggested queries, and queryable text units. The key stays on the local server and is never sent to the browser.

```bash
OPENAI_API_KEY=<your-key> grag studio --port 3333
GRAG_OPENAI_MODEL=gpt-5.4-mini grag studio
```

The graph canvas supports node selection, edge selection, node dragging, panning, zooming, reflow, community filtering, and result-driven highlighting.

The same document helper is exported for prototypes:

```ts
import { buildDocumentGraphRagSnapshot } from "@farming-labs/grag";

const snapshot = buildDocumentGraphRagSnapshot(markdown, {
  title: "Support playbook",
  sourcePath: "docs/support.md"
});
```

You can also emit a standalone HTML file:

```bash
grag studio ./snapshot.json --export-html graph.html
```

You can also test retrieval directly from the CLI:

```bash
grag retrieve ./snapshot.json "How does graph expansion help retrieval?"
```

When Studio is serving a snapshot, dashboards can use HTTP endpoints:

```bash
curl "http://127.0.0.1:3333/search.json?query=storage%20retrieval"
curl "http://127.0.0.1:3333/ask.json?query=how%20does%20studio%20work"
```

## Repository Index

Build and query a repository index for any local repo or Git URL:

```bash
grag repo . --ask "What does this repository do?" --snapshot repo.snapshot.json
grag repo https://github.com/microsoft/graphrag.git --ask "What are the indexing concepts?"
```

If `OPENAI_API_KEY` is set, the repo command uses OpenAI automatically for graph extraction and the final answer. Use `--no-openai` for deterministic local extraction, or `--studio --open` to inspect the generated graph visually.

See [docs/REPO_DEMO.md](docs/REPO_DEMO.md) for the full flow.

## Development

```bash
pnpm install
pnpm --filter @farming-labs/grag check
pnpm --filter @farming-labs/grag test
pnpm --filter @farming-labs/grag build
```

From the monorepo root, `pnpm build` compiles the SDK, CLI, Studio assets, and docs app. No separate Studio dev-server config is required.

## Roadmap

- Graph extraction adapters for LLM providers.
- Community detection helpers.
- Import/export for Microsoft GraphRAG parquet/CSV outputs.
- Postgres `pgvector` embedding adapter.
- Streaming global/local search responses.
- Incremental indexing workflows for relational source tables.
- ORM runtime examples for Kysely, direct SQL, and Postgres.

See [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) for the first app flow.
See [docs/GITHUB_SAAS.md](docs/GITHUB_SAAS.md) for indexing GitHub repos in a SaaS and powering docs, search, and Ask AI.
See [docs/SERVICE_INTEGRATION.md](docs/SERVICE_INTEGRATION.md) for integrating GRAG into another service.
See [docs/STORAGE_CONFIGURATION.md](docs/STORAGE_CONFIGURATION.md) for choosing and configuring memory, Postgres, SQLite, ORM, or custom storage.
See [docs/RETRIEVAL_SDK.md](docs/RETRIEVAL_SDK.md) for the production retrieval/ask SDK.
See [docs/MICROSOFT_GRAPHRAG_REPLICATION.md](docs/MICROSOFT_GRAPHRAG_REPLICATION.md) for the end-to-end parity plan.
See [docs/STORAGE_AND_RETRIEVAL.md](docs/STORAGE_AND_RETRIEVAL.md) for the relational storage and retrieval model.

This package is not affiliated with Microsoft. It is a TypeScript implementation path inspired by the GraphRAG data model and query architecture.

## References

- Microsoft GraphRAG repository: https://github.com/microsoft/graphrag
- GraphRAG query overview: https://microsoft.github.io/graphrag/query/overview/
- GraphRAG global search: https://microsoft.github.io/graphrag/query/global_search/
- GraphRAG local search: https://microsoft.github.io/graphrag/query/local_search/
