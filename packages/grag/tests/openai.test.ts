import { describe, expect, it } from "vitest";
import type { ChatCompletion, ChatMessage, ChatModel, ChatOptions } from "../src/llm.js";
import { MemoryGraphRagStore } from "../src/storage/memory.js";
import { LabelPropagationCommunityDetector } from "../src/openai/community-detector.js";
import { OpenAiCommunityReporter } from "../src/openai/community-reporter.js";
import { OpenAiGraphExtractor } from "../src/openai/extractor.js";
import { createOpenAiPipeline } from "../src/openai/pipeline.js";
import type { Community } from "../src/model.js";

// Stub ChatModel that returns canned JSON responses
function stubChatModel(response: unknown): ChatModel {
  return {
    async complete(
      _messages: readonly ChatMessage[],
      _options?: ChatOptions,
    ): Promise<ChatCompletion> {
      return { content: JSON.stringify(response) };
    },
  };
}

describe("OpenAiGraphExtractor", () => {
  it("extracts entities and relationships from a text unit", async () => {
    const model = stubChatModel({
      entities: [
        { title: "Postgres", type: "TECHNOLOGY", description: "Relational database." },
        {
          title: "GraphRAG",
          type: "CONCEPT",
          description: "Graph retrieval-augmented generation.",
        },
      ],
      relationships: [
        {
          source: "Postgres",
          target: "GraphRAG",
          description: "Stores graph artifacts.",
          weight: 5,
        },
      ],
    });

    const extractor = new OpenAiGraphExtractor({ model });
    const result = await extractor.extract({
      id: "tu_1",
      humanReadableId: "doc:1",
      text: "Postgres stores GraphRAG artifacts.",
      entityIds: [],
      relationshipIds: [],
      covariateIds: [],
    });

    expect(result.entities).toHaveLength(2);
    expect(result.entities[0]?.title).toBe("Postgres");
    expect(result.entities[1]?.title).toBe("GraphRAG");
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]?.source).toBe("Postgres");
    expect(result.relationships[0]?.weight).toBe(5);
  });

  it("drops relationships whose source/target is not in the entity list", async () => {
    const model = stubChatModel({
      entities: [{ title: "Postgres", type: "TECHNOLOGY", description: "Database." }],
      relationships: [
        { source: "Postgres", target: "UnknownEntity", description: "Some link.", weight: 3 },
      ],
    });

    const extractor = new OpenAiGraphExtractor({ model });
    const result = await extractor.extract({
      id: "tu_2",
      humanReadableId: "doc:2",
      text: "Postgres is a database.",
      entityIds: [],
      relationshipIds: [],
      covariateIds: [],
    });

    expect(result.entities).toHaveLength(1);
    expect(result.relationships).toHaveLength(0);
  });

  it("returns empty result when model returns malformed JSON", async () => {
    const model: ChatModel = {
      async complete() {
        return { content: "not json at all" };
      },
    };

    const extractor = new OpenAiGraphExtractor({ model });
    const result = await extractor.extract({
      id: "tu_3",
      humanReadableId: "doc:3",
      text: "Some text.",
      entityIds: [],
      relationshipIds: [],
      covariateIds: [],
    });

    expect(result.entities).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
  });
});

describe("LabelPropagationCommunityDetector", () => {
  it("groups connected entities into communities", async () => {
    const detector = new LabelPropagationCommunityDetector();
    const entities = [
      { id: "e1", title: "Postgres", type: "TECHNOLOGY", textUnitIds: [], communityIds: [] },
      { id: "e2", title: "Kysely", type: "TECHNOLOGY", textUnitIds: [], communityIds: [] },
      { id: "e3", title: "Redis", type: "TECHNOLOGY", textUnitIds: [], communityIds: [] },
    ];
    const relationships = [
      {
        id: "r1",
        source: "Postgres",
        target: "Kysely",
        description: "ORM",
        weight: 3,
        textUnitIds: [],
      },
      // Redis is isolated
    ];

    const communities = await detector.detect({
      entities,
      relationships,
      textUnits: [],
    });

    expect(communities.length).toBeGreaterThanOrEqual(2);
    const sizes = communities.map((c) => c.entityIds.length).sort((a, b) => b - a);
    expect(sizes[0]).toBe(2); // Postgres + Kysely together
    expect(sizes[1]).toBe(1); // Redis alone
  });

  it("handles empty entity list", async () => {
    const detector = new LabelPropagationCommunityDetector();
    const communities = await detector.detect({ entities: [], relationships: [], textUnits: [] });
    expect(communities).toHaveLength(0);
  });

  it("assigns sequential community numbers", async () => {
    const detector = new LabelPropagationCommunityDetector();
    const entities = [
      { id: "e1", title: "A", textUnitIds: [], communityIds: [] },
      { id: "e2", title: "B", textUnitIds: [], communityIds: [] },
    ];
    const communities = await detector.detect({ entities, relationships: [], textUnits: [] });
    const numbers = communities.map((c) => c.community).sort((a, b) => a - b);
    expect(numbers).toEqual([0, 1]);
  });
});

describe("OpenAiCommunityReporter", () => {
  it("generates a community report from graph data", async () => {
    const model = stubChatModel({
      title: "Storage Layer",
      summary: "This community covers the storage infrastructure.",
      findings: [
        { summary: "Postgres is central", explanation: "All artifacts flow through Postgres." },
      ],
      rank: 8,
    });

    const reporter = new OpenAiCommunityReporter({ model });
    const community: Community = {
      id: "com_1",
      title: "Storage",
      community: 0,
      level: 0,
      children: [],
      entityIds: ["e1"],
      relationshipIds: [],
      textUnitIds: [],
      covariateIds: [],
    };

    const report = await reporter.report({
      community,
      entities: [],
      relationships: [],
      covariates: [],
      textUnits: [],
    });

    expect(report.title).toBe("Storage Layer");
    expect(report.summary).toContain("storage infrastructure");
    expect(report.rank).toBe(8);
    expect(report.findings).toHaveLength(1);
    expect(report.community).toBe(0);
  });

  it("falls back gracefully when model returns invalid JSON", async () => {
    const model: ChatModel = {
      async complete() {
        return { content: "oops" };
      },
    };

    const reporter = new OpenAiCommunityReporter({ model });
    const community: Community = {
      id: "com_2",
      title: "Fallback Community",
      community: 1,
      level: 0,
      children: [],
      entityIds: [],
      relationshipIds: [],
      textUnitIds: [],
      covariateIds: [],
    };

    const report = await reporter.report({
      community,
      entities: [],
      relationships: [],
      covariates: [],
      textUnits: [],
    });

    expect(report.title).toBe("Fallback Community");
    expect(report.community).toBe(1);
  });
});

describe("createOpenAiPipeline", () => {
  it("wires up a full pipeline and runs indexDocuments", async () => {
    const extractionResponse = {
      entities: [
        { title: "Docs Infra", type: "PRODUCT", description: "Documentation infrastructure." },
        { title: "GraphRAG", type: "TECHNOLOGY", description: "Graph retrieval system." },
      ],
      relationships: [
        { source: "Docs Infra", target: "GraphRAG", description: "Uses for retrieval.", weight: 7 },
      ],
    };

    const reportResponse = {
      title: "Docs Infra Community",
      summary: "Documentation and retrieval systems.",
      findings: [{ summary: "GraphRAG powers docs", explanation: "Used for search." }],
      rank: 7,
    };

    let callCount = 0;
    const model: ChatModel = {
      async complete(): Promise<ChatCompletion> {
        callCount += 1;
        return { content: JSON.stringify(callCount === 1 ? extractionResponse : reportResponse) };
      },
    };

    const store = new MemoryGraphRagStore();

    // Override the chat model by constructing manually (no API key needed for stubs)
    const { StandardGraphRagPipeline } = await import("../src/pipeline/standard.js");
    const { OpenAiGraphExtractor } = await import("../src/openai/extractor.js");
    const { LabelPropagationCommunityDetector } =
      await import("../src/openai/community-detector.js");
    const { OpenAiCommunityReporter } = await import("../src/openai/community-reporter.js");

    const pipeline = new StandardGraphRagPipeline({
      store,
      graphExtractor: new OpenAiGraphExtractor({ model }),
      communityDetector: new LabelPropagationCommunityDetector(),
      communityReporter: new OpenAiCommunityReporter({ model }),
      embeddingModel: {
        async embed(texts) {
          return texts.map(() => [0.1, 0.2, 0.3]);
        },
      },
    });

    const result = await pipeline.indexDocuments(
      [
        {
          id: "doc_1",
          title: "Docs Guide",
          type: "text",
          text: "Docs infra uses GraphRAG for retrieval.",
          textUnitIds: [],
        },
      ],
      { chunkSize: 20, chunkOverlap: 0 },
    );

    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.communities.length).toBeGreaterThan(0);
    expect(result.communityReports.length).toBeGreaterThan(0);
    expect(result.embeddings.length).toBeGreaterThan(0);
    // extract_claims is intentionally skipped (no claimExtractor wired)
    const nonSkipped = result.steps.filter((s) => s.status !== "skipped");
    expect(nonSkipped.every((s) => s.status === "success")).toBe(true);
    expect(nonSkipped.length).toBeGreaterThan(0);
  });
});
