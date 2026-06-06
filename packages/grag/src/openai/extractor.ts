import { z } from "zod";
import { completionContent, type ChatModel } from "../llm.js";
import type { Entity, Relationship, TextUnit } from "../model.js";
import type { GraphExtractionResult, GraphExtractor } from "../pipeline/types.js";
import { createStableId } from "../utils/ids.js";

export interface OpenAiGraphExtractorOptions {
  model: ChatModel;
  entityTypes?: readonly string[];
}

const DEFAULT_ENTITY_TYPES = [
  "PERSON",
  "ORGANIZATION",
  "LOCATION",
  "EVENT",
  "CONCEPT",
  "PRODUCT",
  "TECHNOLOGY",
  "DOCUMENT",
  "PROCESS",
];

const extractionSchema = z.object({
  entities: z.array(
    z.object({
      title: z.string(),
      type: z.string(),
      description: z.string(),
    }),
  ),
  relationships: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      description: z.string(),
      weight: z.number().optional(),
    }),
  ),
});

export class OpenAiGraphExtractor implements GraphExtractor {
  private readonly model: ChatModel;
  private readonly entityTypes: readonly string[];
  private readonly systemPrompt: string;

  constructor(options: OpenAiGraphExtractorOptions) {
    this.model = options.model;
    this.entityTypes = options.entityTypes ?? DEFAULT_ENTITY_TYPES;
    this.systemPrompt = buildSystemPrompt(this.entityTypes);
  }

  async extract(textUnit: TextUnit): Promise<GraphExtractionResult> {
    let raw: unknown;
    try {
      const completion = await this.model.complete(
        [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: textUnit.text },
        ],
        { responseFormat: "json", temperature: 0 },
      );
      raw = JSON.parse(completionContent(completion));
    } catch {
      return { entities: [], relationships: [] };
    }

    const parsed = extractionSchema.safeParse(raw);
    if (!parsed.success) return { entities: [], relationships: [] };

    const entities: Entity[] = parsed.data.entities.map((e) => ({
      id: createStableId([e.type.toUpperCase(), e.title.toLowerCase()], "ent"),
      humanReadableId: e.title,
      title: e.title,
      type: e.type.toUpperCase(),
      description: e.description,
      textUnitIds: [textUnit.id],
      communityIds: [],
    }));

    const entityTitleToId = new Map(entities.map((e) => [e.title.toLowerCase(), e.id]));

    const relationships: Relationship[] = parsed.data.relationships
      .filter((r) => {
        return (
          entityTitleToId.has(r.source.toLowerCase()) && entityTitleToId.has(r.target.toLowerCase())
        );
      })
      .map((r) => ({
        id: createStableId([r.source.toLowerCase(), r.target.toLowerCase()], "rel"),
        source: r.source,
        target: r.target,
        description: r.description,
        weight: r.weight ?? 1,
        textUnitIds: [textUnit.id],
        attributes: {
          sourceEntityId: entityTitleToId.get(r.source.toLowerCase()) ?? "",
          targetEntityId: entityTitleToId.get(r.target.toLowerCase()) ?? "",
        },
      }));

    return { entities, relationships };
  }
}

function buildSystemPrompt(entityTypes: readonly string[]): string {
  return [
    "Extract a knowledge graph from the supplied text.",
    `Entity types to identify: ${entityTypes.join(", ")}.`,
    "",
    "Return JSON matching this exact shape:",
    '{ "entities": [{ "title": string, "type": string, "description": string }],',
    '  "relationships": [{ "source": string, "target": string, "description": string, "weight": number }] }',
    "",
    "Rules:",
    "- title: canonical name in Title Case, concise (package names and identifiers verbatim)",
    "- type: one of the listed entity types, UPPERCASE",
    "- description: 1–2 factual sentences grounded in the text",
    "- source/target: must match an entity title exactly (case-sensitive)",
    "- weight: 1–10 strength of the relationship",
    "- Only extract entities and relationships clearly supported by the text.",
    "- Preserve exact API names, file paths, function names, and table/column names as titles.",
  ].join("\n");
}
