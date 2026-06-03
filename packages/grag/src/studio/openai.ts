import { z } from "zod";
import type { GraphRagSnapshot } from "../model.js";
import {
  buildGraphRagSnapshotFromExtraction,
  type DocumentGraphExtraction
} from "./document.js";

export interface OpenAiDocumentGraphInput {
  filename: string;
  mimeType?: string;
  text?: string;
  dataUrl?: string;
}

export interface OpenAiDocumentGraphOptions {
  apiKey?: string;
  model?: string;
}

export interface OpenAiDocumentGraphResult {
  snapshot: GraphRagSnapshot;
  extraction: DocumentGraphExtraction;
  model: string;
}

const DEFAULT_MODEL = "gpt-5.4-mini";

const extractionSchema = z.object({
  title: z.string(),
  summary: z.string(),
  textUnits: z.array(z.object({
    title: z.string(),
    text: z.string()
  })),
  entities: z.array(z.object({
    title: z.string(),
    type: z.string(),
    description: z.string(),
    textUnitIndexes: z.array(z.number().int())
  })),
  relationships: z.array(z.object({
    sourceTitle: z.string(),
    targetTitle: z.string(),
    description: z.string(),
    weight: z.number(),
    textUnitIndexes: z.array(z.number().int())
  })),
  communities: z.array(z.object({
    title: z.string(),
    summary: z.string(),
    entityTitles: z.array(z.string())
  })),
  suggestedQueries: z.array(z.string())
});

const extractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "textUnits", "entities", "relationships", "communities", "suggestedQueries"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    textUnits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "text"],
        properties: {
          title: { type: "string" },
          text: { type: "string" }
        }
      }
    },
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "type", "description", "textUnitIndexes"],
        properties: {
          title: { type: "string" },
          type: { type: "string" },
          description: { type: "string" },
          textUnitIndexes: {
            type: "array",
            items: { type: "integer" }
          }
        }
      }
    },
    relationships: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceTitle", "targetTitle", "description", "weight", "textUnitIndexes"],
        properties: {
          sourceTitle: { type: "string" },
          targetTitle: { type: "string" },
          description: { type: "string" },
          weight: { type: "number" },
          textUnitIndexes: {
            type: "array",
            items: { type: "integer" }
          }
        }
      }
    },
    communities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "entityTitles"],
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          entityTitles: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    },
    suggestedQueries: {
      type: "array",
      items: { type: "string" }
    }
  }
} as const;

export async function extractDocumentGraphWithOpenAI(
  input: OpenAiDocumentGraphInput,
  options: OpenAiDocumentGraphOptions = {}
): Promise<OpenAiDocumentGraphResult> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const model = options.model ?? process.env.GRAG_OPENAI_MODEL ?? DEFAULT_MODEL;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [{
        role: "user",
        content: buildInputContent(input)
      }],
      text: {
        format: {
          type: "json_schema",
          name: "grag_document_graph",
          strict: true,
          schema: extractionJsonSchema
        }
      },
      max_output_tokens: maxOutputTokens()
    })
  });

  const payload = await response.json() as unknown;
  if (!response.ok) {
    throw new Error(openAiErrorMessage(payload, response.status));
  }

  const outputText = extractOutputText(payload);
  const extraction = extractionSchema.parse(JSON.parse(outputText));
  const snapshot = buildGraphRagSnapshotFromExtraction(extraction, {
    title: input.filename,
    sourcePath: input.filename,
    generatedBy: `openai:${model}`,
    ...(input.text ? { sourceText: input.text } : {})
  });

  return {
    snapshot,
    extraction,
    model
  };
}

function buildInputContent(input: OpenAiDocumentGraphInput): Record<string, unknown>[] {
  const content: Record<string, unknown>[] = [{
    type: "input_text",
    text: [
      "Extract a GraphRAG-ready knowledge graph from the attached or pasted document.",
      "Use concise entity titles, meaningful entity types, source-grounded descriptions, weighted relationships, communities, and practical suggested queries.",
      "Preserve exact package names, file paths, API names, database table names, column names, CLI flags, environment variables, and function names as entity titles or text-unit evidence when they appear.",
      "Do not summarize away schema identifiers or code identifiers that would be needed for implementation, retrieval, or debugging.",
      "For large inputs, keep the graph compact: at most 18 text units, 60 entities, 60 relationships, 8 communities, and 8 suggested queries.",
      "Treat textUnitIndexes as zero-based indexes into the textUnits array.",
      "Prefer support, docs, infrastructure, storage, retrieval, API, database, package, people, product, and workflow concepts when present.",
      `Filename: ${input.filename}`,
      `MIME type: ${input.mimeType || "unknown"}`
    ].join("\n")
  }];

  if (input.text?.trim()) {
    content.push({
      type: "input_text",
      text: input.text.slice(0, 220_000)
    });
    return content;
  }

  if (!input.dataUrl) {
    throw new Error("Upload must include text or file data.");
  }

  if ((input.mimeType ?? "").startsWith("image/")) {
    content.push({
      type: "input_image",
      image_url: input.dataUrl,
      detail: "auto"
    });
    return content;
  }

  content.push({
    type: "input_file",
    filename: input.filename,
    file_data: input.dataUrl
  });
  return content;
}

function maxOutputTokens(): number {
  const value = Number(process.env.GRAG_OPENAI_MAX_OUTPUT_TOKENS ?? 14_000);
  return Number.isInteger(value) && value >= 1_000 ? value : 14_000;
}

function openAiErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string") {
        return `OpenAI request failed (${status}): ${message}`;
      }
    }
  }

  return `OpenAI request failed with status ${status}.`;
}

function extractOutputText(payload: unknown): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (typeof record.output_text === "string" && record.output_text.trim()) {
      return record.output_text;
    }

    const output = Array.isArray(record.output) ? record.output : [];
    for (const item of output) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const content = Array.isArray((item as Record<string, unknown>).content)
        ? (item as Record<string, unknown>).content as unknown[]
        : [];
      for (const contentItem of content) {
        if (!contentItem || typeof contentItem !== "object" || Array.isArray(contentItem)) {
          continue;
        }
        const contentRecord = contentItem as Record<string, unknown>;
        if (typeof contentRecord.text === "string" && contentRecord.text.trim()) {
          return contentRecord.text;
        }
      }
    }
  }

  throw new Error("OpenAI response did not include output text.");
}
