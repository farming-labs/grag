import { chunkDocuments, type ChunkDocumentOptions } from "./ingest/chunk.js";
import {
  relationalRowsToDocuments,
  type RelationalRow,
  type RelationalRowsToDocumentsOptions,
} from "./ingest/relational.js";
import type { ChatModel, EmbeddingModel } from "./llm.js";
import type { GraphRagDocument, GraphRagSnapshot, PartialGraphRagSnapshot } from "./model.js";
import { StandardGraphRagPipeline } from "./pipeline/standard.js";
import type {
  StandardGraphRagIndexOptions,
  StandardGraphRagIndexResult,
  StandardGraphRagPipelineOptions,
} from "./pipeline/types.js";
import { basicSearch, type BasicSearchHit, type BasicSearchOptions } from "./query/basic-search.js";
import { buildLocalContext, type LocalContextOptions } from "./query/context.js";
import {
  GlobalSearchEngine,
  type GlobalSearchOptions,
  type GlobalSearchResult,
} from "./query/global-search.js";
import { LocalSearchEngine, type LocalSearchResult } from "./query/local-search.js";
import {
  loadGraphRagNeighborhood,
  type GraphRagNeighborhood,
  type GraphRagNeighborhoodOptions,
} from "./query/neighborhood.js";
import {
  GraphRagRetriever,
  type GraphRagAskOptions,
  type GraphRagAskResult,
  type GraphRagRetrieverOptions,
  type GraphRagSearchOptions,
  type GraphRagSearchResult,
} from "./query/retriever.js";
import { MemoryGraphRagStore } from "./storage/memory.js";
import type { GraphRagStore } from "./storage/types.js";
import { buildDocumentGraphRagSnapshot } from "./studio/document.js";
import {
  retrieveFromGraphRagSnapshot,
  type GraphRagRetrievalResult,
  type RetrieveGraphRagSnapshotOptions,
} from "./studio/retrieval.js";
import { createStableId } from "./utils/ids.js";

export interface GraphRagServiceOptions {
  store?: GraphRagStore;
  model?: ChatModel;
  embeddingModel?: EmbeddingModel;
}

export interface IngestDocumentsOptions extends ChunkDocumentOptions {
  mode?: "chunk-only" | "document-graph";
}

export interface IngestTextDocumentInput {
  id?: string;
  title: string;
  text: string;
  sourcePath?: string;
  type?: string;
  attributes?: GraphRagDocument["attributes"];
}

export interface GraphRagServiceStats {
  documents: number;
  textUnits: number;
  entities: number;
  relationships: number;
  covariates: number;
  communities: number;
  communityReports: number;
  embeddings: number;
}

export interface GraphRagServiceRetrieveOptions extends RetrieveGraphRagSnapshotOptions {
  useBasicSearch?: boolean;
  basicSearch?: BasicSearchOptions;
}

export interface GraphRagServiceRetrieveResult extends GraphRagRetrievalResult {
  basicSearchHits?: BasicSearchHit[];
}

export type GraphRagServiceRetrieverOptions = Partial<Omit<GraphRagRetrieverOptions, "store">>;

export class GraphRagService {
  readonly store: GraphRagStore;
  private readonly model: ChatModel | undefined;
  private readonly embeddingModel: EmbeddingModel | undefined;

  constructor(options: GraphRagServiceOptions = {}) {
    this.store = options.store ?? new MemoryGraphRagStore();
    this.model = options.model;
    this.embeddingModel = options.embeddingModel;
  }

  async ingestSnapshot(snapshot: PartialGraphRagSnapshot): Promise<GraphRagSnapshot> {
    await this.store.upsertGraph(snapshot);
    return this.snapshot();
  }

  async ingestDocuments(
    documents: readonly GraphRagDocument[],
    options: IngestDocumentsOptions = {},
  ): Promise<GraphRagSnapshot> {
    if (options.mode === "document-graph") {
      for (const document of documents) {
        await this.store.upsertGraph(
          buildDocumentGraphRagSnapshot(document.text, {
            title: document.title,
            sourcePath:
              document.attributes?.sourcePath?.toString() ??
              document.humanReadableId?.toString() ??
              document.id,
          }),
        );
      }
      return this.snapshot();
    }

    const { documents: linkedDocuments, textUnits } = chunkDocuments(documents, options);
    await this.store.upsertGraph({
      documents: linkedDocuments,
      textUnits,
    });
    return this.snapshot();
  }

  async ingestTextDocuments(
    input: IngestTextDocumentInput | readonly IngestTextDocumentInput[],
    options: IngestDocumentsOptions = { mode: "document-graph" },
  ): Promise<GraphRagSnapshot> {
    const documents = (Array.isArray(input) ? input : [input]).map((entry) => toDocument(entry));
    return this.ingestDocuments(documents, options);
  }

  async ingestRows<Row extends RelationalRow>(
    options: RelationalRowsToDocumentsOptions<Row> & IngestDocumentsOptions,
  ): Promise<GraphRagSnapshot> {
    const { chunkSize, overlap, tokenCounter, mode, ...documentOptions } = options;
    return this.ingestDocuments(relationalRowsToDocuments(documentOptions), {
      ...(chunkSize === undefined ? {} : { chunkSize }),
      ...(overlap === undefined ? {} : { overlap }),
      ...(tokenCounter === undefined ? {} : { tokenCounter }),
      ...(mode === undefined ? {} : { mode }),
    });
  }

  async retrieve(
    query: string,
    options: GraphRagServiceRetrieveOptions = {},
  ): Promise<GraphRagServiceRetrieveResult> {
    const snapshot = await this.snapshot();
    const result = retrieveFromGraphRagSnapshot(snapshot, query, options);
    if (!options.useBasicSearch) {
      return result;
    }

    const basicSearchHits = await basicSearch(
      this.store,
      query,
      this.basicSearchOptions(options.basicSearch),
    );

    return {
      ...result,
      basicSearchHits,
    };
  }

  async search(query: string, options: BasicSearchOptions = {}): Promise<BasicSearchHit[]> {
    return basicSearch(this.store, query, this.basicSearchOptions(options));
  }

  retriever(options: GraphRagServiceRetrieverOptions = {}): GraphRagRetriever {
    const model = options.model ?? this.model;
    const embeddingModel = options.embeddingModel ?? this.embeddingModel;
    return new GraphRagRetriever({
      store: this.store,
      ...(model ? { model } : {}),
      ...(embeddingModel ? { embeddingModel } : {}),
    });
  }

  async searchGraph(
    query: string,
    options: GraphRagSearchOptions = {},
  ): Promise<GraphRagSearchResult> {
    return this.retriever().search(query, options);
  }

  async ask(query: string, options: GraphRagAskOptions = {}): Promise<GraphRagAskResult> {
    return this.retriever().ask(query, options);
  }

  async localContext(query: string, options: LocalContextOptions = {}): Promise<string> {
    const [entities, relationships, textUnits] = await Promise.all([
      this.store.listEntities(),
      this.store.listRelationships(),
      this.store.listTextUnits(),
    ]);
    return buildLocalContext(query, { entities, relationships, textUnits }, options);
  }

  async neighborhood(options: GraphRagNeighborhoodOptions): Promise<GraphRagNeighborhood> {
    return loadGraphRagNeighborhood(this.store, options);
  }

  async relatedTextUnits(options: GraphRagNeighborhoodOptions) {
    return (await this.neighborhood(options)).textUnits;
  }

  /**
   * Index documents using a fully configured pipeline (graph extraction,
   * community detection, community reporting, embeddings).
   *
   * Pass the pipeline-level options (minus `store`, which is taken from this service).
   * Use `createOpenAiPipeline` from `@farming-labs/grag/openai` to build the options.
   *
   * @example
   * ```ts
   * import { OpenAiGraphExtractor, LabelPropagationCommunityDetector,
   *          OpenAiCommunityReporter, OpenAiChatModel } from "@farming-labs/grag/openai";
   *
   * const model = new OpenAiChatModel();
   * const result = await service.indexWithPipeline(documents, {
   *   graphExtractor: new OpenAiGraphExtractor({ model }),
   *   communityDetector: new LabelPropagationCommunityDetector(),
   *   communityReporter: new OpenAiCommunityReporter({ model }),
   * });
   * ```
   */
  async indexWithPipeline(
    documents: readonly GraphRagDocument[] | readonly IngestTextDocumentInput[],
    pipelineOptions: Omit<StandardGraphRagPipelineOptions, "store">,
    indexOptions: StandardGraphRagIndexOptions = {},
  ): Promise<StandardGraphRagIndexResult> {
    const docs = documents.map((d) =>
      "text" in d && !("type" in d)
        ? toDocument(d as IngestTextDocumentInput)
        : (d as GraphRagDocument),
    );
    const pipeline = new StandardGraphRagPipeline({ store: this.store, ...pipelineOptions });
    return pipeline.indexDocuments(docs, indexOptions);
  }

  async answerLocal(query: string): Promise<LocalSearchResult> {
    if (!this.model) {
      throw new Error("answerLocal requires a ChatModel.");
    }

    return new LocalSearchEngine({ store: this.store, model: this.model }).search(query);
  }

  async answerGlobal(
    query: string,
    options: GlobalSearchOptions = {},
  ): Promise<GlobalSearchResult> {
    if (!this.model) {
      throw new Error("answerGlobal requires a ChatModel.");
    }

    return new GlobalSearchEngine({ store: this.store, model: this.model }).search(query, options);
  }

  async snapshot(): Promise<GraphRagSnapshot> {
    return this.store.getSnapshot();
  }

  async stats(): Promise<GraphRagServiceStats> {
    const snapshot = await this.snapshot();
    return {
      documents: snapshot.documents.length,
      textUnits: snapshot.textUnits.length,
      entities: snapshot.entities.length,
      relationships: snapshot.relationships.length,
      covariates: snapshot.covariates.length,
      communities: snapshot.communities.length,
      communityReports: snapshot.communityReports.length,
      embeddings: snapshot.embeddings.length,
    };
  }

  async toJSON(): Promise<GraphRagSnapshot> {
    return this.snapshot();
  }

  private basicSearchOptions(options: BasicSearchOptions = {}): BasicSearchOptions {
    return {
      ...options,
      ...(this.embeddingModel ? { embeddingModel: this.embeddingModel } : {}),
    };
  }
}

export function createGraphRagService(options: GraphRagServiceOptions = {}): GraphRagService {
  return new GraphRagService(options);
}

export function createMemoryGraphRagService(
  options: Omit<GraphRagServiceOptions, "store"> = {},
): GraphRagService {
  return new GraphRagService({
    ...options,
    store: new MemoryGraphRagStore(),
  });
}

function toDocument(input: IngestTextDocumentInput): GraphRagDocument {
  const sourcePath = input.sourcePath ?? input.title;
  return {
    id: input.id ?? createStableId([sourcePath, input.title, input.text], "doc"),
    humanReadableId: sourcePath,
    title: input.title,
    type: input.type ?? "text",
    text: input.text,
    textUnitIds: [],
    attributes: {
      ...input.attributes,
      sourcePath,
    },
  };
}
