import {
  createGraphRagService,
  createMemoryGraphRagService,
  type GraphRagSnapshot,
  type GraphRagStore
} from "../src/index.js";

// In another service, keep application code on this shape:
export async function createAppRagService(input: {
  store?: GraphRagStore;
  snapshot?: GraphRagSnapshot;
}) {
  const service = input.store
    ? createGraphRagService({ store: input.store })
    : createMemoryGraphRagService();

  if (input.snapshot) {
    await service.ingestSnapshot(input.snapshot);
  }

  return service;
}

const service = await createAppRagService({});

await service.ingestTextDocuments({
  title: "Storage integration note",
  sourcePath: "docs/storage.md",
  text: "The app can persist GraphRAG snapshots in Postgres through SqlGraphRagStore or through @farming-labs/orm when a portable storage layer is useful."
});

const retrieval = await service.retrieve("How should the app persist GraphRAG?", {
  useBasicSearch: true,
  limit: 5
});

console.log({
  stats: await service.stats(),
  topHit: retrieval.hits[0]?.title,
  context: retrieval.context
});
