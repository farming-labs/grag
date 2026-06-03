import { describe, expect, it } from "vitest";
import {
  MemoryGraphRagStore,
  StandardGraphRagPipeline,
  type CommunityDetector,
  type CommunityReporter,
  type GraphExtractor
} from "../src/index.js";

describe("StandardGraphRagPipeline", () => {
  it("runs the Microsoft-style indexing phases with pluggable providers", async () => {
    const store = new MemoryGraphRagStore();
    const graphExtractor: GraphExtractor = {
      async extract(textUnit) {
        return {
          entities: [
            {
              id: "ent_billing",
              title: "Billing",
              description: "Billing subsystem",
              textUnitIds: [textUnit.id],
              communityIds: []
            }
          ],
          relationships: []
        };
      }
    };
    const communityDetector: CommunityDetector = {
      async detect({ entities, textUnits }) {
        return [
          {
            id: "community_0",
            title: "Billing",
            community: 0,
            level: 0,
            children: [],
            entityIds: entities.map((entity) => entity.id),
            relationshipIds: [],
            textUnitIds: textUnits.map((textUnit) => textUnit.id),
            covariateIds: []
          }
        ];
      }
    };
    const communityReporter: CommunityReporter = {
      async report({ community }) {
        return {
          id: "report_0",
          title: community.title,
          community: community.community,
          level: community.level,
          children: community.children,
          summary: "Billing issues are present.",
          fullContent: "Billing issues are present in support tickets.",
          rank: 1,
          findings: []
        };
      }
    };
    const pipeline = new StandardGraphRagPipeline({
      store,
      graphExtractor,
      communityDetector,
      communityReporter,
      embeddingModel: {
        async embed(texts) {
          return texts.map(() => [1, 0, 0]);
        }
      }
    });

    const result = await pipeline.indexDocuments(
      [
        {
          id: "doc_1",
          title: "Ticket",
          type: "ticket",
          text: "The billing export failed for Acme.",
          textUnitIds: []
        }
      ],
      { chunkSize: 20, chunkOverlap: 0 }
    );

    expect(result.steps.map((step) => step.name)).toEqual([
      "compose_text_units",
      "link_documents",
      "extract_graph",
      "extract_claims",
      "detect_communities",
      "generate_community_reports",
      "generate_embeddings"
    ]);
    expect(result.entities).toHaveLength(1);
    expect(result.communityReports).toHaveLength(1);
    expect(result.embeddings.length).toBeGreaterThan(0);
  });
});
