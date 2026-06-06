import type { GraphRagDocument, TextUnit } from "../model.js";
import { chunkDocuments, type ChunkDocumentOptions } from "../ingest/chunk.js";
import type {
  DataSourceConfig,
  RepoSourceConfig,
  DocumentSourceConfig,
  DatabaseSourceConfig,
  UrlSourceConfig,
} from "./types.js";
import { loadRepoSource } from "./repo.js";
import { loadDocumentSource } from "./document.js";
import { loadDatabaseSource } from "./database.js";
import { loadUrlSource } from "./url.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DataSourceLoaderOptions {
  /**
   * Default chunk size (words) applied across all sources.
   * Individual sources with their own `chunkSize` override this.
   * Default: 300.
   */
  chunkSize?: number;

  /**
   * Default chunk overlap.
   * Default: 40.
   */
  overlap?: number;

  /**
   * Skip chunking entirely and return whole documents as-is.
   * Use when you pre-chunk your content or want to pass full docs to a custom pipeline.
   * Default: false.
   */
  noChunk?: boolean;

  /**
   * Load sources concurrently (default) or sequentially.
   * Set to false if sources share state or rate-limit each other.
   * Default: true.
   */
  parallel?: boolean;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface LoadedDocuments {
  /** Full document records (one per source file / row / page). */
  documents: GraphRagDocument[];
  /** Chunked text units ready to feed into pipeline.run(). */
  textUnits: TextUnit[];
  /** How many data sources were processed. */
  sourceCount: number;
  /** Total raw documents before chunking. */
  documentCount: number;
  /** Total text units produced after chunking. */
  textUnitCount: number;
}

// ---------------------------------------------------------------------------
// DataSourceLoader
// ---------------------------------------------------------------------------

export class DataSourceLoader {
  private readonly sources: DataSourceConfig[];
  private readonly options: DataSourceLoaderOptions;

  constructor(sources: DataSourceConfig[], options: DataSourceLoaderOptions = {}) {
    this.sources = sources;
    this.options = options;
  }

  /**
   * Load all sources and chunk them into documents + text units.
   * Pass the result directly into `pipeline.run()`:
   *
   * ```ts
   * const { documents, textUnits } = await loader.load();
   * await pipeline.run({ documents, textUnits });
   * ```
   */
  async load(): Promise<LoadedDocuments> {
    const rawDocs = await this.loadAllSources();

    if (this.options.noChunk) {
      return {
        documents: rawDocs,
        textUnits: [],
        sourceCount: this.sources.length,
        documentCount: rawDocs.length,
        textUnitCount: 0,
      };
    }

    const chunkOpts: ChunkDocumentOptions = {
      chunkSize: this.options.chunkSize ?? 300,
      overlap: this.options.overlap ?? 40,
    };

    const { documents, textUnits } = chunkDocuments(rawDocs, chunkOpts);

    return {
      documents,
      textUnits,
      sourceCount: this.sources.length,
      documentCount: rawDocs.length,
      textUnitCount: textUnits.length,
    };
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async loadAllSources(): Promise<GraphRagDocument[]> {
    const parallel = this.options.parallel !== false;

    if (parallel) {
      const results = await Promise.all(this.sources.map((s) => this.loadOne(s)));
      return results.flat();
    }

    const all: GraphRagDocument[] = [];
    for (const source of this.sources) {
      const docs = await this.loadOne(source);
      all.push(...docs);
    }
    return all;
  }

  private async loadOne(source: DataSourceConfig): Promise<GraphRagDocument[]> {
    if (source.type === "repo") {
      return loadRepoSource(source as RepoSourceConfig);
    }
    if (source.type === "document") {
      return loadDocumentSource(source as DocumentSourceConfig);
    }
    if (source.type === "database") {
      return loadDatabaseSource(source as DatabaseSourceConfig);
    }
    if (source.type === "url") {
      return loadUrlSource(source as UrlSourceConfig);
    }
    // Custom source — must provide a load() function
    const custom = source as { type: string; load?: () => Promise<GraphRagDocument[]> };
    if (typeof custom.load === "function") {
      return custom.load();
    }
    throw new Error(
      `Unknown data source type "${custom.type}". ` +
        `For custom sources, provide a "load" function on the config object.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Convenience factories
// ---------------------------------------------------------------------------

/**
 * Define a single typed data source config.
 *
 * @example
 * const source = defineSource({ type: "repo", url: "./my-app" });
 */
export function defineSource(config: DataSourceConfig): DataSourceConfig {
  return config;
}

/**
 * Define multiple data source configs.
 *
 * @example
 * const sources = defineSources([
 *   { type: "repo", url: "./my-app", label: "App source" },
 *   { type: "document", files: ["./CHANGELOG.md"] },
 *   { type: "url", urls: ["https://docs.example.com/api"] }
 * ]);
 */
export function defineSources(configs: DataSourceConfig[]): DataSourceConfig[] {
  return configs;
}
