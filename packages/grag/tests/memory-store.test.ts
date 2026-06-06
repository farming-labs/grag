import { describe, expect, it } from "vitest";
import { MemoryGraphRagStore } from "../src/index.js";

describe("MemoryGraphRagStore", () => {
  it("round-trips a GraphRAG snapshot", async () => {
    const store = new MemoryGraphRagStore();

    await store.upsertGraph({
      documents: [
        {
          id: "doc_1",
          title: "Support ticket",
          type: "ticket",
          text: "The billing export failed.",
          textUnitIds: ["tu_1"],
        },
      ],
      textUnits: [
        {
          id: "tu_1",
          text: "The billing export failed.",
          documentId: "doc_1",
          entityIds: ["ent_billing"],
          relationshipIds: [],
          covariateIds: [],
        },
      ],
      entities: [
        {
          id: "ent_billing",
          title: "Billing",
          description: "Billing subsystem",
          textUnitIds: ["tu_1"],
          communityIds: ["0"],
        },
      ],
      communityReports: [
        {
          id: "rep_0",
          title: "Billing failures",
          community: 0,
          level: 0,
          children: [],
          summary: "Billing exports are failing.",
          fullContent: "Billing exports are failing for support users.",
          rank: 8,
          findings: [],
        },
      ],
    });

    const snapshot = await store.getSnapshot();

    expect(snapshot.documents[0]?.textUnitIds).toEqual(["tu_1"]);
    expect(snapshot.entities[0]?.title).toBe("Billing");
    expect(snapshot.communityReports[0]?.rank).toBe(8);
  });
});
