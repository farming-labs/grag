import { completionContent, type ChatModel } from "../llm.js";
import type { GraphRagStore } from "../storage/types.js";
import { buildLocalContext, type LocalContextOptions } from "./context.js";

export interface LocalSearchOptions extends LocalContextOptions {
  /** Max entities to load from the store before scoring. Default: 2000. */
  maxEntityLoad?: number;
  /** Max relationships to load from the store before scoring. Default: 4000. */
  maxRelationshipLoad?: number;
}

export interface LocalSearchResult {
  answer: string;
  context: string;
}

export class LocalSearchEngine {
  private readonly store: GraphRagStore;
  private readonly model: ChatModel;

  constructor(input: { store: GraphRagStore; model: ChatModel }) {
    this.store = input.store;
    this.model = input.model;
  }

  async search(query: string, options: LocalSearchOptions = {}): Promise<LocalSearchResult> {
    const { maxEntityLoad = 2000, maxRelationshipLoad = 4000, ...contextOptions } = options;
    const [entities, relationships, textUnits] = await Promise.all([
      this.store.listEntities({ limit: maxEntityLoad }),
      this.store.listRelationships({ limit: maxRelationshipLoad }),
      this.store.listTextUnits(),
    ]);
    const context = buildLocalContext(
      query,
      { entities, relationships, textUnits },
      contextOptions,
    );
    const answer = completionContent(
      await this.model.complete([
        {
          role: "system",
          content: "Answer using the graph context. Cite entity names and source text when useful.",
        },
        {
          role: "user",
          content: `Question:\n${query}\n\nGraph context:\n${context}`,
        },
      ]),
    );

    return { answer, context };
  }
}
