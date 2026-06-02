import type { GraphRagDocument, JsonObject } from "../model.js";
import type { RelationalRow } from "../ingest/relational.js";

// ---------------------------------------------------------------------------
// Shared base
// ---------------------------------------------------------------------------

export interface DataSourceMeta {
  /**
   * Stable identifier for this source.
   * Used for deduplication and incremental re-indexing.
   * If omitted, one is derived from the source config.
   */
  id?: string;

  /**
   * Human-readable label stored in every document's `attributes.sourceLabel`.
   * Shows up in the Studio inspector and retrieval grounding.
   */
  label?: string;
}

// ---------------------------------------------------------------------------
// Repo source  (local path or GitHub/GitLab URL)
// ---------------------------------------------------------------------------

export interface RepoSourceConfig extends DataSourceMeta {
  type: "repo";

  /** Local folder path (e.g. "./my-app") or a remote Git URL (https:// / git@). */
  url: string;

  /** Maximum number of files to select, or "all" to scan every non-ignored text file. Default: "all". */
  maxFiles?: number | "all";

  /** Maximum bytes read per file before truncation. Default: 28_000. */
  maxFileBytes?: number;

  /**
   * Only include files whose relative path starts with one of these prefixes.
   * Example: ["src/", "docs/", "packages/core/"]
   * All files included if omitted.
   */
  include?: string[];

  /**
   * Exclude files whose relative path starts with one of these prefixes.
   * Example: ["tests/", "examples/", "__generated__/"]
   */
  exclude?: string[];
}

// ---------------------------------------------------------------------------
// Document source  (files on disk or inline text)
// ---------------------------------------------------------------------------

export interface InlineDocument {
  title: string;
  text: string;
  /** Stable id — generated from title+text if omitted. */
  id?: string;
  /** Document type tag (default: "document"). */
  type?: string;
  /** Extra metadata stored in entity attributes. */
  attributes?: JsonObject;
}

export interface DocumentSourceConfig extends DataSourceMeta {
  type: "document";

  /** Absolute or relative file paths to read (.md, .txt, .ts, .json, …). */
  files?: string[];

  /** Inline content — pass text directly without touching the filesystem. */
  content?: InlineDocument[];

  /** Token chunk size for splitting. Default: 300. */
  chunkSize?: number;

  /** Overlap between consecutive chunks. Default: 40. */
  overlap?: number;
}

// ---------------------------------------------------------------------------
// Database / relational rows source
// ---------------------------------------------------------------------------

export type { RelationalRow };

export interface DatabaseSourceConfig extends DataSourceMeta {
  type: "database";

  /**
   * Table or collection name.
   * Used as a label and for stable document ID generation.
   */
  tableName: string;

  /**
   * Rows already fetched from your DB — you control the query and filtering.
   * Example:  rows: await db.select().from(tickets).where(...)
   */
  rows: RelationalRow[];

  /** Column to use as the document id. Default: "id". */
  idColumn?: string;

  /** Column to use as the document title. */
  titleColumn?: string;

  /**
   * Columns whose values are concatenated into the document text.
   * If omitted, all columns are serialised.
   */
  textColumns?: string[];

  /** Extra columns stored as entity attributes. */
  attributeColumns?: string[];

  /** Document type tag (default: "relational-row"). */
  documentType?: string;

  /** Token chunk size. Default: 300. */
  chunkSize?: number;
}

// ---------------------------------------------------------------------------
// URL source  (fetch and extract text from web pages)
// ---------------------------------------------------------------------------

export interface UrlSourceConfig extends DataSourceMeta {
  type: "url";

  /** URLs to fetch. Failed requests are silently skipped. */
  urls: string[];

  /** Strip HTML tags from the response body. Default: true. */
  stripHtml?: boolean;

  /** Maximum characters kept per page after stripping. Default: 50_000. */
  maxBytes?: number;

  /** Token chunk size. Default: 300. */
  chunkSize?: number;
}

// ---------------------------------------------------------------------------
// Custom / bring-your-own source
// ---------------------------------------------------------------------------

export interface CustomSourceConfig extends DataSourceMeta {
  /**
   * Any string type not matched by the built-in sources.
   * Example: "notion", "confluence", "s3", "slack"
   */
  type: string;

  /**
   * Called by DataSourceLoader when loading this source.
   * Return GraphRagDocument[] for anything not covered by built-in sources.
   */
  load: () => Promise<GraphRagDocument[]>;
}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type DataSourceConfig =
  | RepoSourceConfig
  | DocumentSourceConfig
  | DatabaseSourceConfig
  | UrlSourceConfig
  | CustomSourceConfig;
