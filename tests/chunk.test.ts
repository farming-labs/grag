import { describe, expect, it } from "vitest";
import { chunkDocuments, type GraphRagDocument } from "../src/index.js";

describe("chunkDocuments", () => {
  it("creates stable text units and links them back to the document", () => {
    const document: GraphRagDocument = {
      id: "doc_1",
      humanReadableId: "orders:1",
      title: "Order note",
      type: "relational-row",
      text: "alpha beta gamma delta epsilon zeta eta theta",
      textUnitIds: []
    };

    const result = chunkDocuments([document], { chunkSize: 4, overlap: 1 });

    expect(result.textUnits).toHaveLength(3);
    expect(result.documents[0]?.textUnitIds).toEqual(result.textUnits.map((unit) => unit.id));
    expect(result.textUnits[1]?.text).toBe("delta epsilon zeta eta");
    expect(result.textUnits[0]?.documentId).toBe("doc_1");
  });
});
