import { createMemoryDriver, createOrm } from "@farming-labs/orm";
import { describe, expect, it } from "vitest";
import {
  getGraphRagOrmMigrationSql,
  graphRagOrmSchema,
  OrmGraphRagStore,
} from "../src/orm/index.js";

describe("OrmGraphRagStore", () => {
  it("round-trips graph artifacts through farming-labs/orm", async () => {
    const orm = createOrm({
      schema: graphRagOrmSchema,
      driver: createMemoryDriver<typeof graphRagOrmSchema>(),
    });
    const store = new OrmGraphRagStore({ orm });

    await store.upsertGraph({
      documents: [
        {
          id: "doc_1",
          title: "Support ticket",
          type: "ticket",
          text: "Billing exports fail.",
          textUnitIds: ["tu_1"],
        },
      ],
      textUnits: [
        {
          id: "tu_1",
          text: "Billing exports fail.",
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
          rank: 2,
          communityIds: ["community_0"],
          textUnitIds: ["tu_1"],
        },
      ],
      communityReports: [
        {
          id: "rep_0",
          title: "Billing issues",
          community: 0,
          level: 0,
          children: [],
          summary: "Billing exports fail.",
          fullContent: "Support tickets mention failed billing exports.",
          rank: 9,
          findings: [],
        },
      ],
    });

    const snapshot = await store.getSnapshot();

    expect(snapshot.documents[0]?.textUnitIds).toEqual(["tu_1"]);
    expect(snapshot.textUnits[0]?.entityIds).toEqual(["ent_billing"]);
    expect(snapshot.entities[0]?.rank).toBe(2);
    expect(snapshot.communityReports[0]?.rank).toBe(9);
  });

  it("renders SQL from the GraphRAG ORM schema", () => {
    const sql = getGraphRagOrmMigrationSql("postgres");

    expect(sql).toContain('create table if not exists "grag_documents"');
    expect(sql).toContain('create table if not exists "grag_community_reports"');
    expect(sql).toContain('create index if not exists "grag_embeddings_target_kind_target_id_idx"');
  });
});
