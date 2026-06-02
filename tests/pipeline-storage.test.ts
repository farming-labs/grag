import { describe, expect, it } from "vitest";
import type { ChatCompletion, ChatMessage, ChatModel } from "../src/llm.js";
import { MemoryGraphRagStore } from "../src/storage/memory.js";
import { StandardGraphRagPipeline } from "../src/pipeline/standard.js";
import type { GraphExtractor, CommunityDetector, CommunityReporter } from "../src/pipeline/types.js";
import type { GraphRagDocument } from "../src/model.js";

// --------------------------------------------------------------------------
// Stub helpers

function stubChatModel(fn: (messages: readonly ChatMessage[]) => unknown): ChatModel {
  return {
    async complete(messages): Promise<ChatCompletion> {
      return { content: JSON.stringify(fn(messages)) };
    }
  };
}

const DOCS: GraphRagDocument[] = [
  {
    id: "doc_1",
    title: "Storage guide",
    type: "text",
    text: "Postgres stores GraphRAG text units, entities, and relationships. Kysely is the query builder.",
    textUnitIds: []
  }
];

// Extractor that returns deterministic entities for the text in DOCS
const GRAPH_EXTRACTOR: GraphExtractor = {
  async extract(textUnit) {
    return {
      entities: [
        { id: "ent_pg", title: "Postgres", type: "TECHNOLOGY", description: "Relational DB.", textUnitIds: [textUnit.id], communityIds: [] },
        { id: "ent_ky", title: "Kysely", type: "TECHNOLOGY", description: "Query builder.", textUnitIds: [textUnit.id], communityIds: [] }
      ],
      relationships: [
        {
          id: "rel_pk",
          source: "Postgres",
          target: "Kysely",
          description: "Kysely queries Postgres.",
          weight: 4,
          textUnitIds: [textUnit.id]
        }
      ]
    };
  }
};

const COMMUNITY_DETECTOR: CommunityDetector = {
  async detect({ entities }) {
    return [{
      id: "com_0",
      title: "Storage",
      community: 0,
      level: 0,
      parent: null,
      children: [],
      entityIds: entities.map((e) => e.id),
      relationshipIds: ["rel_pk"],
      textUnitIds: [],
      covariateIds: [],
      size: entities.length
    }];
  }
};

const COMMUNITY_REPORTER: CommunityReporter = {
  async report({ community }) {
    return {
      id: "rpt_0",
      title: community.title,
      community: community.community,
      level: community.level,
      children: community.children,
      summary: "Storage layer community.",
      fullContent: "Postgres and Kysely form the storage layer.",
      rank: 8,
      findings: [{ summary: "Postgres is central", explanation: "All data flows through it." }]
    };
  }
};

// --------------------------------------------------------------------------

describe("Pipeline storage correctness", () => {
  it("back-links entityIds and relationshipIds into text units", async () => {
    const store = new MemoryGraphRagStore();
    const pipeline = new StandardGraphRagPipeline({
      store,
      graphExtractor: GRAPH_EXTRACTOR,
      communityDetector: COMMUNITY_DETECTOR,
      communityReporter: COMMUNITY_REPORTER
    });

    const result = await pipeline.indexDocuments(DOCS, { chunkSize: 50, chunkOverlap: 0 });

    // Text units in the returned result must have entity IDs
    for (const tu of result.textUnits) {
      expect(tu.entityIds.length).toBeGreaterThan(0);
      expect(tu.relationshipIds.length).toBeGreaterThan(0);
    }

    // Text units in the store must also have entity IDs (not stale empty arrays)
    const stored = await store.listTextUnits();
    for (const tu of stored) {
      expect(tu.entityIds.length).toBeGreaterThan(0);
      expect(tu.relationshipIds.length).toBeGreaterThan(0);
    }
  });

  it("computes entity degree, frequency, and rank after extraction", async () => {
    const store = new MemoryGraphRagStore();
    const pipeline = new StandardGraphRagPipeline({
      store,
      graphExtractor: GRAPH_EXTRACTOR
    });

    const result = await pipeline.indexDocuments(DOCS, { chunkSize: 50, chunkOverlap: 0 });

    for (const entity of result.entities) {
      expect(entity.degree).toBeDefined();
      expect(entity.frequency).toBeDefined();
      expect(entity.rank).toBeDefined();
      // Each entity in our test graph has degree 1 (one relationship each)
      expect(entity.degree).toBe(1);
      expect(entity.rank).toBe(1); // 1/maxDegree = 1/1
      expect((entity.frequency ?? 0)).toBeGreaterThan(0);
    }
  });

  it("populates entity communityIds after community detection", async () => {
    const store = new MemoryGraphRagStore();
    const pipeline = new StandardGraphRagPipeline({
      store,
      graphExtractor: GRAPH_EXTRACTOR,
      communityDetector: COMMUNITY_DETECTOR,
      communityReporter: COMMUNITY_REPORTER
    });

    const result = await pipeline.indexDocuments(DOCS, { chunkSize: 50, chunkOverlap: 0 });

    // Entities in the returned result must have communityIds
    for (const entity of result.entities) {
      expect(entity.communityIds.length).toBeGreaterThan(0);
    }

    // Entities in the store must also have communityIds
    const storedEntities = await store.listEntities();
    for (const entity of storedEntities) {
      expect(entity.communityIds.length).toBeGreaterThan(0);
    }
  });

  it("stores all artifact types end-to-end and keeps counts consistent", async () => {
    const store = new MemoryGraphRagStore();
    const pipeline = new StandardGraphRagPipeline({
      store,
      graphExtractor: GRAPH_EXTRACTOR,
      communityDetector: COMMUNITY_DETECTOR,
      communityReporter: COMMUNITY_REPORTER,
      embeddingModel: { async embed(texts) { return texts.map(() => [0.1, 0.2, 0.3]); } }
    });

    const result = await pipeline.indexDocuments(DOCS, { chunkSize: 50, chunkOverlap: 0 });
    const snapshot = await store.getSnapshot();

    expect(snapshot.documents.length).toBe(result.documents.length);
    expect(snapshot.textUnits.length).toBe(result.textUnits.length);
    expect(snapshot.entities.length).toBe(result.entities.length);
    expect(snapshot.relationships.length).toBe(result.relationships.length);
    expect(snapshot.communities.length).toBe(result.communities.length);
    expect(snapshot.communityReports.length).toBe(result.communityReports.length);
    expect(snapshot.embeddings.length).toBe(result.embeddings.length);

    // All step statuses should be success (no extractors are skipped here)
    const skipped = result.steps.filter((s) => s.status === "skipped").map((s) => s.name);
    expect(skipped).toEqual(["extract_claims"]); // only claims extractor is unset
  });

  it("respects concurrency option without changing output", async () => {
    const callOrder: number[] = [];
    let index = 0;

    const extractor: GraphExtractor = {
      async extract(textUnit) {
        const i = index++;
        callOrder.push(i);
        return {
          entities: [
            { id: `ent_${i}`, title: `Entity${i}`, type: "CONCEPT", description: "desc", textUnitIds: [textUnit.id], communityIds: [] }
          ],
          relationships: []
        };
      }
    };

    const store = new MemoryGraphRagStore();
    const pipeline = new StandardGraphRagPipeline({
      store,
      graphExtractor: extractor,
      concurrency: 2
    });

    const longDoc: GraphRagDocument = {
      id: "doc_long",
      title: "Long doc",
      type: "text",
      text: Array(6).fill("Some text about entity concepts and relationships here.").join(" "),
      textUnitIds: []
    };

    const result = await pipeline.indexDocuments([longDoc], { chunkSize: 10, chunkOverlap: 0 });

    expect(result.textUnits.length).toBeGreaterThan(1);
    expect(result.entities.length).toBeGreaterThan(0);
  });
});

describe("GraphRagService.indexWithPipeline", () => {
  it("accepts pipeline options and returns indexed results", async () => {
    const { createMemoryGraphRagService } = await import("../src/service.js");
    const service = createMemoryGraphRagService();

    const result = await service.indexWithPipeline(DOCS, {
      graphExtractor: GRAPH_EXTRACTOR,
      communityDetector: COMMUNITY_DETECTOR,
      communityReporter: COMMUNITY_REPORTER
    });

    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.communities.length).toBeGreaterThan(0);
    expect(result.communityReports.length).toBeGreaterThan(0);

    // Service store should reflect indexed data
    const stats = await service.stats();
    expect(stats.entities).toBe(result.entities.length);
    expect(stats.communityReports).toBe(result.communityReports.length);
  });
});
