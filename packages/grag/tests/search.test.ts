import { describe, expect, it } from "vitest";
import {
  basicSearch,
  GlobalSearchEngine,
  MemoryGraphRagStore,
  planGraphRagQuery,
  type ChatModel,
} from "../src/index.js";

describe("search helpers", () => {
  it("plans codebase questions with intent, scope, and explicit references", () => {
    const plan = planGraphRagQuery("Where is OPENAI_API_KEY read in packages/ai/src/index.ts?");

    expect(plan.intent).toBe("where");
    expect(plan.scope).toBe("node");
    expect(plan.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "env", value: "OPENAI_API_KEY" }),
        expect.objectContaining({ kind: "path", value: "packages/ai/src/index.ts" }),
      ]),
    );
    expect(plan.steps.join(" ")).toContain("Resolve explicit references");
  });

  it("does not treat generic API acronyms as env vars and detects impact questions", () => {
    const plan = planGraphRagQuery(
      "If the session table schema changes, which internal adapter and API route files are likely impacted?",
    );

    expect(plan.intent).toBe("impact");
    expect(plan.entities.some((entity) => entity.kind === "env" && entity.value === "API")).toBe(
      false,
    );
  });

  it("keeps workflow acronyms out of query entities and classifies command flows", () => {
    const organizationPlan = planGraphRagQuery(
      "How do organization invitation routes enforce membership permissions, and which files define the invite CRUD and access checks?",
    );
    const migrationPlan = planGraphRagQuery(
      "What happens when the migration command runs, from CLI command to generated schema/migrations?",
    );
    const callbackPlan = planGraphRagQuery(
      "Explain the social sign-in callback path and how it decides whether to link an OAuth account, sign in, or create a session.",
    );

    expect(organizationPlan.entities.some((entity) => entity.value === "CRUD")).toBe(false);
    expect(migrationPlan.intent).toBe("how");
    expect(migrationPlan.scope).toBe("flow");
    expect(callbackPlan.intent).toBe("how");
    expect(callbackPlan.scope).toBe("flow");
    expect(callbackPlan.entities.some((entity) => entity.value === "Explain")).toBe(false);
  });

  it("runs lexical basic search over text units", async () => {
    const store = new MemoryGraphRagStore();
    await store.upsertTextUnits([
      {
        id: "tu_1",
        text: "Billing export failed for Acme",
        entityIds: [],
        relationshipIds: [],
        covariateIds: [],
      },
      {
        id: "tu_2",
        text: "Password reset succeeded",
        entityIds: [],
        relationshipIds: [],
        covariateIds: [],
      },
    ]);

    const hits = await basicSearch(store, "billing export", { limit: 1 });

    expect(hits).toHaveLength(1);
    expect(hits[0]?.textUnit.id).toBe("tu_1");
    expect(hits[0]?.scoreType).toBe("lexical");
  });

  it("maps and reduces community reports for global search", async () => {
    const store = new MemoryGraphRagStore();
    await store.upsertCommunityReports([
      {
        id: "rep_0",
        title: "Billing",
        community: 0,
        level: 0,
        children: [],
        summary: "Billing export failures",
        fullContent: "Support tickets mention failed billing exports.",
        rank: 1,
        findings: [],
      },
    ]);
    const model: ChatModel = {
      async complete(messages) {
        const lastMessage = messages[messages.length - 1]?.content ?? "";
        return lastMessage.includes("Partial answers")
          ? "Billing exports are the main support issue."
          : JSON.stringify({ answer: "Billing exports fail", confidence: 0.9 });
      },
    };

    const engine = new GlobalSearchEngine({ store, model });
    const result = await engine.search("What is happening with billing?");

    expect(result.mapResponses).toHaveLength(1);
    expect(result.answer).toContain("Billing exports");
  });
});
