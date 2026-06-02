import { describe, expect, it } from "vitest";
import {
  buildDocumentGraphRagSnapshot,
  buildGraphRagSnapshotFromExtraction,
  exampleSupportDocument
} from "../src/studio/document.js";
import { renderGraphRagStudioHtml } from "../src/studio/html.js";
import { retrieveFromGraphRagSnapshot } from "../src/studio/retrieval.js";
import { createSampleGraphRagSnapshot } from "../src/studio/sample.js";

describe("GraphRAG Studio", () => {
  it("renders a standalone HTML document with an embedded snapshot", () => {
    const html = renderGraphRagStudioHtml(createSampleGraphRagSnapshot());

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("GraphRAG Studio");
    expect(html).toContain("__GRAG_SNAPSHOT__");
    expect(html).toContain("./assets/index.js");
  });

  it("retrieves context from the sample snapshot", () => {
    const result = retrieveFromGraphRagSnapshot(
      createSampleGraphRagSnapshot(),
      "How does this repository organize GraphRAG storage, retrieval, Studio, and repo import?"
    );

    expect(result.hits.length).toBeGreaterThan(2);
    expect(result.context.toLowerCase()).toContain("storage");
    expect(result.stats.entityHits).toBeGreaterThan(0);
  });

  it("builds a queryable graph snapshot from an uploaded document", () => {
    const snapshot = buildDocumentGraphRagSnapshot(exampleSupportDocument(), {
      title: "Support GraphRAG Playbook",
      sourcePath: "support-playbook.md"
    });
    const result = retrieveFromGraphRagSnapshot(snapshot, "How does relational storage use pgvector and orm?");

    expect(snapshot.entities.length).toBeGreaterThan(10);
    expect(snapshot.relationships.length).toBeGreaterThan(10);
    expect(snapshot.communities.length).toBeGreaterThan(2);
    expect(result.hits.length).toBeGreaterThan(2);
    expect(result.context.toLowerCase()).toContain("storage");
  });

  it("builds a queryable graph snapshot from structured extraction", () => {
    const snapshot = buildGraphRagSnapshotFromExtraction({
      title: "PDF support runbook",
      summary: "A runbook explaining PDF ingestion, OpenAI extraction, and Studio graph visualization.",
      textUnits: [
        {
          title: "PDF ingestion",
          text: "Studio accepts PDF files and asks OpenAI to extract graph entities and relationships."
        },
        {
          title: "Storage retrieval",
          text: "The extracted snapshot can be stored with @farming-labs/orm and queried by retrieval."
        }
      ],
      entities: [
        {
          title: "PDF upload",
          type: "Interface",
          description: "A rich file upload path for Studio.",
          textUnitIndexes: [0]
        },
        {
          title: "OpenAI extraction",
          type: "Pipeline",
          description: "Uses structured outputs to extract graph facts.",
          textUnitIndexes: [0]
        },
        {
          title: "@farming-labs/orm",
          type: "Storage",
          description: "Stores the extracted GraphRAG snapshot.",
          textUnitIndexes: [1]
        }
      ],
      relationships: [
        {
          sourceTitle: "PDF upload",
          targetTitle: "OpenAI extraction",
          description: "PDF upload feeds OpenAI extraction.",
          weight: 2,
          textUnitIndexes: [0]
        },
        {
          sourceTitle: "OpenAI extraction",
          targetTitle: "@farming-labs/orm",
          description: "Extracted snapshots can be persisted through the ORM store.",
          weight: 1,
          textUnitIndexes: [1]
        }
      ],
      communities: [
        {
          title: "Automated Ingestion",
          summary: "Files become GraphRAG snapshots.",
          entityTitles: ["PDF upload", "OpenAI extraction"]
        },
        {
          title: "Storage",
          summary: "The ORM persists extracted graph artifacts.",
          entityTitles: ["@farming-labs/orm"]
        }
      ],
      suggestedQueries: ["How does PDF upload become a graph?"]
    });
    const result = retrieveFromGraphRagSnapshot(snapshot, "How does PDF upload use OpenAI extraction?");

    expect(snapshot.entities.length).toBe(3);
    expect(snapshot.relationships.length).toBe(2);
    expect(snapshot.communities.length).toBeGreaterThan(1);
    expect(result.context.toLowerCase()).toContain("openai");
  });
});
