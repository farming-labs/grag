import { describe, expect, it } from "vitest";
import {
  MemoryGraphRagStore,
  buildDocumentGraphRagSnapshot,
  createGraphRagService,
  createMemoryGraphRagService,
  type ChatMessage,
  type ChatModel,
} from "../src/index.js";

describe("GraphRagService", () => {
  it("ingests text documents and retrieves graph evidence", async () => {
    const service = createMemoryGraphRagService();

    await service.ingestTextDocuments({
      title: "Docs platform support guide",
      sourcePath: "docs/support.md",
      text: [
        "The docs platform uses GraphRAG Studio to visualize entities and relationships.",
        "Postgres stores documents, text units, entities, relationships, and community reports.",
        "@farming-labs/orm keeps the storage layer portable across SQL drivers.",
      ].join("\n\n"),
    });

    const stats = await service.stats();
    const result = await service.retrieve("How does orm storage help docs platform retrieval?", {
      useBasicSearch: true,
    });

    expect(stats.documents).toBe(1);
    expect(stats.entities).toBeGreaterThan(3);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.basicSearchHits?.length).toBeGreaterThan(0);
  });

  it("wraps any GraphRagStore implementation", async () => {
    const store = new MemoryGraphRagStore();
    const service = createGraphRagService({ store });
    const snapshot = buildDocumentGraphRagSnapshot(
      "Hybrid retrieval uses graph expansion and citations.",
      {
        title: "Retrieval note",
        sourcePath: "docs/retrieval.md",
      },
    );

    await service.ingestSnapshot(snapshot);

    expect(await service.snapshot()).toMatchObject({
      documents: expect.any(Array),
      entities: expect.any(Array),
    });
    expect((await service.stats()).relationships).toBeGreaterThan(0);
  });

  it("loads related chunks from graph neighborhoods", async () => {
    const service = createMemoryGraphRagService();
    const snapshot = await service.ingestTextDocuments({
      title: "Storage graph",
      sourcePath: "docs/storage.md",
      text: [
        "Postgres stores GraphRAG text units, entities, relationships, and community reports.",
        "Related chunks are linked through entity text unit and relationship text unit tables.",
        "The retrieval service expands from a selected entity into nearby relationships and source chunks.",
      ].join("\n\n"),
    });
    const entity =
      snapshot.entities.find((entry) => entry.textUnitIds.length > 0) ?? snapshot.entities[0];
    expect(entity).toBeDefined();

    const neighborhood = await service.neighborhood({
      entityIds: [entity!.id],
      includeCommunityReports: true,
    });

    expect(neighborhood.entities.length).toBeGreaterThan(0);
    expect(neighborhood.textUnits.length).toBeGreaterThan(0);
    expect(neighborhood.context).toContain("Related Chunks");
    expect(await service.relatedTextUnits({ entityIds: [entity!.id] })).toEqual(
      neighborhood.textUnits,
    );
  });

  it("returns dashboard-ready search results with citations and graph highlights", async () => {
    const service = createMemoryGraphRagService();
    await service.ingestTextDocuments({
      title: "Dashboard retrieval",
      sourcePath: "docs/dashboard-retrieval.md",
      text: [
        "The dashboard calls grag.searchGraph to retrieve citations, graph highlights, and context blocks.",
        "GraphRAG retrieval links entities, relationships, text units, and source paths for explainable answers.",
      ].join("\n"),
    });

    const result = await service.searchGraph(
      "What does dashboard retrieval return for citations?",
      {
        limit: 6,
      },
    );

    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.context).toContain("[S1]");
    expect(result.graph.entityIds.length).toBeGreaterThan(0);
    expect(result.stats.mergedHitCount).toBe(result.hits.length);
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.plan.intent).toBe("what");
    expect(result.trace.map((step) => step.stage)).toContain("graph_search");
  });

  it("answers with extractive fallback or a configured chat model", async () => {
    const service = createMemoryGraphRagService();
    await service.ingestTextDocuments({
      title: "Ask SDK",
      sourcePath: "docs/ask-sdk.md",
      text: "grag.ask returns a dashboard-ready answer with citations and source-backed graph context.",
    });

    const extractive = await service.ask("What does grag.ask return?");
    expect(extractive.mode).toBe("extractive");
    expect(extractive.answer).toContain("[S1]");

    const seenMessages: ChatMessage[][] = [];
    const model: ChatModel = {
      async complete(messages) {
        seenMessages.push([...messages]);
        return {
          content: "grag.ask returns a cited dashboard answer [S1].",
          usage: { inputTokens: 12, outputTokens: 8 },
        };
      },
    };
    const modeled = await service.ask("What does grag.ask return?", {
      model,
      responseStyle: "one sentence",
    });

    expect(modeled.mode).toBe("model");
    expect(modeled.answer).toContain("[S1]");
    expect(modeled.usage?.outputTokens).toBe(8);
    expect(seenMessages[0]?.at(-1)?.content).toContain("Available citations");
  });

  it("reboosts exact code references above generic docs matches", async () => {
    const service = createMemoryGraphRagService();
    await service.ingestSnapshot({
      textUnits: [
        {
          id: "tu_origin",
          text: "originCheck verifies request headers against trustedOrigins before sensitive auth routes continue.",
          entityIds: [],
          relationshipIds: [],
          covariateIds: [],
          attributes: { sourcePath: "packages/auth-core/src/api/middlewares/origin-check.ts" },
        },
        {
          id: "tu_docs",
          text: "OAuth proxy documentation mentions OAuth requests, callback URLs, and trusted origins for previews.",
          entityIds: [],
          relationshipIds: [],
          covariateIds: [],
          attributes: { sourcePath: "docs/content/docs/plugins/oauth-proxy.mdx" },
        },
        {
          id: "tu_session",
          text: "setSessionCookie, getSessionCookie, and deleteSessionCookie manage session token cookies and custom cookie prefixes.",
          entityIds: [],
          relationshipIds: [],
          covariateIds: [],
          attributes: { sourcePath: "packages/auth-core/src/cookies/index.ts" },
        },
      ],
    });

    const origin = await service.searchGraph(
      "Where is request origin checking implemented, and how does it use trustedOrigins?",
      {
        limit: 4,
      },
    );
    expect(origin.hits[0]?.sourcePaths[0]).toBe(
      "packages/auth-core/src/api/middlewares/origin-check.ts",
    );
    expect(origin.hits[0]?.channels).toContain("reference");

    const cookies = await service.ask(
      "How do session cookies get named, read, and set, including custom prefixes?",
      {
        limit: 4,
      },
    );
    expect(cookies.hits[0]?.sourcePaths[0]).toBe("packages/auth-core/src/cookies/index.ts");
    expect(cookies.answer).toContain("Strongest evidence");
    expect(cookies.answer).toContain("setSessionCookie");
  });
});
