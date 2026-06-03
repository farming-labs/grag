import { completionContent, type ChatModel } from "../llm.js";
import type { CommunityReport } from "../model.js";
import type { GraphRagStore } from "../storage/types.js";
import { mapLimit } from "../utils/concurrency.js";
import { buildCommunityContext, type ContextChunk } from "./context.js";

export interface GlobalSearchOptions {
  reportLevel?: number;
  maxContextChars?: number;
  concurrency?: number;
  responseType?: string;
}

export interface GlobalSearchResult {
  answer: string;
  mapResponses: string[];
  contextChunks: ContextChunk<CommunityReport>[];
  reports: CommunityReport[];
}

export class GlobalSearchEngine {
  private readonly store: GraphRagStore;
  private readonly model: ChatModel;

  constructor(input: { store: GraphRagStore; model: ChatModel }) {
    this.store = input.store;
    this.model = input.model;
  }

  async search(query: string, options: GlobalSearchOptions = {}): Promise<GlobalSearchResult> {
    const reports = await this.store.listCommunityReports(
      options.reportLevel === undefined ? undefined : { level: options.reportLevel }
    );
    const contextChunks = buildCommunityContext(
      reports,
      options.maxContextChars === undefined ? undefined : { maxChunkChars: options.maxContextChars }
    );
    const mapResponses = await mapLimit(
      contextChunks,
      options.concurrency ?? 4,
      async (chunk) => completionContent(await this.model.complete(createMapMessages(query, chunk.text), { responseFormat: "json" }))
    );
    const answer = completionContent(
      await this.model.complete(createReduceMessages(query, mapResponses, options.responseType), {
        responseFormat: "text"
      })
    );

    return {
      answer,
      mapResponses,
      contextChunks,
      reports
    };
  }
}

function createMapMessages(query: string, context: string) {
  return [
    {
      role: "system" as const,
      content:
        "You answer questions using only the supplied community reports. Return concise JSON with keys answer, points, and confidence."
    },
    {
      role: "user" as const,
      content: `Question:\n${query}\n\nCommunity reports:\n${context}`
    }
  ];
}

function createReduceMessages(query: string, mapResponses: readonly string[], responseType = "multiple paragraphs") {
  return [
    {
      role: "system" as const,
      content: `Combine partial GraphRAG map responses into one grounded answer. Return ${responseType}.`
    },
    {
      role: "user" as const,
      content: `Question:\n${query}\n\nPartial answers:\n${mapResponses.join("\n\n---\n\n")}`
    }
  ];
}

