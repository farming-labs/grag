import type {
  Community,
  CommunityReport,
  Covariate,
  EmbeddingRecord,
  Entity,
  GraphRagDocument,
  Relationship,
  TextUnit,
} from "../model.js";
import type { EmbeddingModel } from "../llm.js";
import type { GraphRagStore } from "../storage/types.js";

export interface GraphExtractionResult {
  entities: Entity[];
  relationships: Relationship[];
}

export interface GraphExtractor {
  extract(textUnit: TextUnit): Promise<GraphExtractionResult>;
}

export interface ClaimExtractor {
  extract(textUnit: TextUnit, graph: GraphExtractionResult): Promise<Covariate[]>;
}

export interface CommunityDetector {
  detect(input: {
    entities: Entity[];
    relationships: Relationship[];
    textUnits: TextUnit[];
  }): Promise<Community[]>;
}

export interface CommunityReporter {
  report(input: {
    community: Community;
    entities: Entity[];
    relationships: Relationship[];
    covariates: Covariate[];
    textUnits: TextUnit[];
  }): Promise<CommunityReport>;
}

export interface PipelineEmbeddingOptions {
  model?: string;
  embedTextUnits?: boolean;
  embedEntities?: boolean;
  embedCommunityReports?: boolean;
}

export interface StandardGraphRagPipelineOptions {
  store: GraphRagStore;
  graphExtractor?: GraphExtractor;
  claimExtractor?: ClaimExtractor;
  communityDetector?: CommunityDetector;
  communityReporter?: CommunityReporter;
  embeddingModel?: EmbeddingModel;
  embeddings?: PipelineEmbeddingOptions;
  /** Max parallel LLM calls during extraction/reporting phases. Default: 4. */
  concurrency?: number;
}

export interface StandardGraphRagIndexOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  /** Overrides pipeline-level concurrency for this run. */
  concurrency?: number;
}

export interface PipelineStepResult {
  name: string;
  status: "skipped" | "success";
  count?: number;
}

export interface StandardGraphRagIndexResult {
  documents: GraphRagDocument[];
  textUnits: TextUnit[];
  entities: Entity[];
  relationships: Relationship[];
  covariates: Covariate[];
  communities: Community[];
  communityReports: CommunityReport[];
  embeddings: EmbeddingRecord[];
  steps: PipelineStepResult[];
}
