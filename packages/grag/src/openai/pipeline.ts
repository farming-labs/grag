import { StandardGraphRagPipeline } from "../pipeline/standard.js";
import type { GraphRagStore } from "../storage/types.js";
import { OpenAiChatModel } from "./chat.js";
import { LabelPropagationCommunityDetector } from "./community-detector.js";
import { OpenAiCommunityReporter } from "./community-reporter.js";
import { OpenAiEmbeddingModel } from "./embeddings.js";
import { OpenAiGraphExtractor } from "./extractor.js";

export interface CreateOpenAiPipelineOptions {
  store: GraphRagStore;
  /** OpenAI API key. Falls back to OPENAI_API_KEY env var. */
  apiKey?: string;
  /** Model for graph extraction and community reports. Default: gpt-4o-mini. */
  extractionModel?: string;
  /** Model for answer generation (used when you wire a ChatModel to search engines). Default: same as extractionModel. */
  answerModel?: string;
  /** Embedding model. Default: text-embedding-3-small. */
  embeddingModel?: string;
  /** Custom entity types for extraction. */
  entityTypes?: readonly string[];
  /** Whether to generate embeddings. Default: true. */
  embeddings?: boolean;
  /** OpenAI base URL override (for Azure, proxies, etc.). */
  baseUrl?: string;
}

/**
 * Creates a fully wired StandardGraphRagPipeline backed by OpenAI.
 *
 * @example
 * ```ts
 * import { MemoryGraphRagStore } from "@farming-labs/grag";
 * import { createOpenAiPipeline } from "@farming-labs/grag/openai";
 *
 * const pipeline = createOpenAiPipeline({ store: new MemoryGraphRagStore() });
 * const result = await pipeline.indexDocuments(documents);
 * ```
 */
export function createOpenAiPipeline(
  options: CreateOpenAiPipelineOptions,
): StandardGraphRagPipeline {
  const { store, apiKey, baseUrl, entityTypes } = options;
  const useEmbeddings = options.embeddings ?? true;

  const chatModel = new OpenAiChatModel({
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(options.extractionModel !== undefined ? { model: options.extractionModel } : {}),
  });

  const embeddingModel = useEmbeddings
    ? new OpenAiEmbeddingModel({
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(options.embeddingModel !== undefined ? { model: options.embeddingModel } : {}),
      })
    : undefined;

  return new StandardGraphRagPipeline({
    store,
    graphExtractor: new OpenAiGraphExtractor({
      model: chatModel,
      ...(entityTypes !== undefined ? { entityTypes } : {}),
    }),
    communityDetector: new LabelPropagationCommunityDetector(),
    communityReporter: new OpenAiCommunityReporter({ model: chatModel }),
    ...(embeddingModel !== undefined ? { embeddingModel } : {}),
  });
}
