import { createMemoryDriver, createOrm } from "@farming-labs/orm";
import { basicSearch, chunkDocuments, relationalRowsToDocuments } from "../src/index.js";
import { graphRagOrmSchema, OrmGraphRagStore } from "../src/orm/index.js";

const orm = createOrm({
  schema: graphRagOrmSchema,
  driver: createMemoryDriver<typeof graphRagOrmSchema>()
});

const store = new OrmGraphRagStore({ orm });

const documents = relationalRowsToDocuments({
  tableName: "support_tickets",
  rows: [
    {
      id: 101,
      customer: "Acme",
      body: "The billing export fails after the migration."
    }
  ],
  idColumn: "id",
  titleColumn: "customer",
  textColumn: "body"
});

const graph = chunkDocuments(documents);
await store.upsertGraph(graph);

const hits = await basicSearch(store, "billing migration", { limit: 1 });

console.log(hits);
