# Getting Started With GRAG

GRAG is easiest to understand as a five-step flow:

1. Ingest documents or rows.
2. Build GraphRAG artifacts: documents, text units, entities, relationships, communities, reports, embeddings.
3. Persist those artifacts through a `GraphRagStore`.
4. Retrieve from the store with lexical, vector, graph, and community search.
5. Visualize the same stored snapshot in Studio.

The important abstraction is `GraphRagStore`. Your app should depend on that interface, not on Postgres, SQLite, Kysely, or an ORM directly.

```ts
import { createGraphRagService, type GraphRagStore } from "@farming-labs/grag";

export async function answerSupportQuestion(store: GraphRagStore, query: string) {
  const grag = createGraphRagService({ store });
  return grag.ask(query);
}
```

## The Minimal Local Flow

Use memory when you are learning or testing:

```ts
import {
  MemoryGraphRagStore,
  basicSearch,
  buildDocumentGraphRagSnapshot,
} from "@farming-labs/grag";

const snapshot = buildDocumentGraphRagSnapshot(markdownText, {
  title: "Support playbook",
  sourcePath: "docs/support.md",
});

const store = new MemoryGraphRagStore();
await store.upsertGraph(snapshot);

const hits = await basicSearch(store, "how does pgvector help retrieval?");
console.log(hits.map((hit) => hit.textUnit.text));
```

Or use the service facade:

```ts
import { createMemoryGraphRagService } from "@farming-labs/grag";

const grag = createMemoryGraphRagService();

await grag.ingestTextDocuments({
  title: "Support playbook",
  sourcePath: "docs/support.md",
  text: markdownText,
});

const result = await grag.retrieve("how does pgvector help retrieval?", {
  useBasicSearch: true,
});
```

For a dashboard or API route, use the polished retrieval surface:

```ts
const result = await grag.ask("how does pgvector help retrieval?", {
  limit: 10,
  responseStyle: "short answer with citations",
});

return {
  answer: result.answer,
  citations: result.citations,
  graph: result.graph,
  timings: result.timings,
};
```

## Loading Multiple Sources Into One Graph

You can build one GraphRAG store from more than one source type. For example, a
repo plus local design docs:

```ts
import {
  DataSourceLoader,
  MemoryGraphRagStore,
  createGraphRagService,
  source,
} from "@farming-labs/grag";

const loader = new DataSourceLoader([
  source.repo({
    url: "https://github.com/farming-labs/grag",
    maxFiles: 80,
    label: "grag repo",
  }),
  source.document({
    files: ["./docs/design.md"],
    label: "design notes",
  }),
]);

const { documents, textUnits } = await loader.load();

const store = new MemoryGraphRagStore();
await store.upsertGraph({ documents, textUnits });

const grag = createGraphRagService({ store });
const answer = await grag.ask("How does the retrieval layer work?", {
  limit: 12,
});
```

Today, source selection happens when you load and index the graph rather than as
an `ask()` option. The resulting retrieval output still keeps source paths and
citations, so answers can be grounded across multiple sources without losing
where the evidence came from.

The `document` source reads files as UTF-8 text, so it is right for `.md`,
`.txt`, `.ts`, `.json`, and similar text files. For PDFs or other rich/binary
files, extract text first or use a custom source loader.

## Postgres Path

If you want Postgres now, the most direct production path is the SQL/Kysely store.

```ts
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import {
  SqlGraphRagStore,
  applyGraphRagMigrations,
  type GraphRagSqlDatabase,
} from "@farming-labs/grag";

const db = new Kysely<GraphRagSqlDatabase>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: process.env.DATABASE_URL }),
  }),
});

await applyGraphRagMigrations(db, "postgres");

const store = new SqlGraphRagStore({ db });
await store.upsertGraph(snapshot);
```

This creates normalized tables such as:

- `grag_documents`
- `grag_text_units`
- `grag_entities`
- `grag_relationships`
- `grag_communities`
- `grag_community_reports`
- `grag_embeddings`
- link tables such as `grag_text_unit_entities`, `grag_entity_communities`, and `grag_relationship_text_units`

## Where `@farming-labs/orm` Helps

Use `@farming-labs/orm` when you want the GraphRAG schema to be portable and composable across drivers.

It is useful for:

- generating migration SQL for Postgres, MySQL, or SQLite;
- using the same schema with a memory driver in tests;
- swapping storage drivers without changing your retrieval code;
- keeping app code on the `GraphRagStore` contract;
- letting `@farming-labs/grag/orm` own the GraphRAG table mapping.

```ts
import { createMemoryDriver, createOrm } from "@farming-labs/orm";
import {
  OrmGraphRagStore,
  graphRagOrmSchema,
  getGraphRagOrmMigrationSql,
} from "@farming-labs/grag/orm";

console.log(getGraphRagOrmMigrationSql("postgres"));

const orm = createOrm({
  schema: graphRagOrmSchema,
  driver: createMemoryDriver<typeof graphRagOrmSchema>(),
});

const store = new OrmGraphRagStore({ orm });
await store.upsertGraph(snapshot);
```

For production Postgres, use the same `graphRagOrmSchema` and pass a Postgres-capable Farming Labs ORM driver into `createOrm`. The GRAG side does not need to change:

```ts
const orm = createOrm({
  schema: graphRagOrmSchema,
  driver: postgresDriver,
});

const store = new OrmGraphRagStore({ orm });
await store.upsertGraph(snapshot);
```

If you do not need the ORM abstraction, use `SqlGraphRagStore`. If you do need driver portability or generated schema ownership, use `OrmGraphRagStore`.

## Retrieval Layers

Start with the product SDK:

```ts
const answer = await grag.ask("billing migration workaround");
const evidence = await grag.searchGraph("billing migration workaround");
```

`ask` returns a cited answer plus the same evidence payload. `searchGraph` returns ranked hits, citations, context, graph highlight ids, stats, and timings without answer generation.

Drop down to primitives when you need a specific layer:

```ts
import { basicSearch } from "@farming-labs/grag";

const hits = await basicSearch(store, "billing migration workaround", {
  limit: 5,
});
```

Then add local graph search:

```ts
import { LocalSearchEngine } from "@farming-labs/grag";

const engine = new LocalSearchEngine({ store, model });
const result = await engine.search("why is the docs platform deploy failing?");

console.log(result.context);
console.log(result.answer);
```

Then add global search over community reports:

```ts
import { GlobalSearchEngine } from "@farming-labs/grag";

const global = new GlobalSearchEngine({ store, model });
const result = await global.search("summarize the main operational risks");
```

## Visualize What Is Stored

Any store can export a snapshot:

```ts
import { writeFile } from "node:fs/promises";

const snapshot = await store.getSnapshot();
await writeFile("snapshot.json", JSON.stringify(snapshot, null, 2));
```

Then run:

```bash
grag studio snapshot.json --port 3333
```

Studio shows:

- the graph;
- retrieval hits;
- community reports;
- source grounding;
- the normalized database table view.

## Production Shape

For a serious Postgres deployment:

1. Use `SqlGraphRagStore` or `OrmGraphRagStore` behind your app-specific repository.
2. Persist every indexing run with source ids and document hashes.
3. Add full-text indexes on document/text/entity fields.
4. Add `pgvector` columns beside the portable `vector_json` payload when you are ready for native vector search.
5. Use HNSW indexes for `text_unit`, `entity`, and `community_report` embeddings.
6. Keep a retrieval eval set with expected answers and citations.
7. Track extraction quality: missing entities, weak relationships, stale embeddings, and citation coverage.

The winning shape is composability: your retrieval code talks to `GraphRagStore`, your storage adapter talks to Postgres or ORM, your indexing pipeline can improve independently, and Studio can inspect the exact same graph.

See [RETRIEVAL_SDK.md](RETRIEVAL_SDK.md) for the dashboard-ready result shape.
