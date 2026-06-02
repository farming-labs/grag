import { MemoryGraphRagStore, basicSearch, chunkDocuments, relationalRowsToDocuments } from "../src/index.js";

const rows = [
  {
    id: 101,
    customer: "Acme",
    status: "open",
    body: "The billing export fails after the migration. The support team needs a workaround."
  },
  {
    id: 102,
    customer: "Globex",
    status: "closed",
    body: "Password reset email arrived after two minutes."
  }
];

const documents = relationalRowsToDocuments({
  tableName: "support_tickets",
  rows,
  idColumn: "id",
  titleColumn: "customer",
  textColumn: "body",
  attributeColumns: ["status"]
});

const graph = chunkDocuments(documents, { chunkSize: 60, overlap: 10 });
const store = new MemoryGraphRagStore();

await store.upsertGraph(graph);

const hits = await basicSearch(store, "billing migration workaround", { limit: 3 });

console.log(hits.map((hit) => ({ score: hit.score, text: hit.textUnit.text })));
