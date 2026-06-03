export type {
  DataSourceConfig,
  DataSourceMeta,
  RepoSourceConfig,
  DocumentSourceConfig,
  InlineDocument,
  DatabaseSourceConfig,
  DatabaseRowsLoader,
  UrlSourceConfig,
  CustomSourceConfig,
  RelationalRow
} from "./types.js";

import type {
  CustomSourceConfig,
  DatabaseSourceConfig,
  DocumentSourceConfig,
  RelationalRow,
  RepoSourceConfig,
  UrlSourceConfig
} from "./types.js";

export {
  DataSourceLoader,
  defineSource,
  defineSources
} from "./loader.js";

export { loadDatabaseSource } from "./database.js";

export type {
  DataSourceLoaderOptions,
  LoadedDocuments
} from "./loader.js";

export const source = {
  repo(config: Omit<RepoSourceConfig, "type">): RepoSourceConfig {
    return { type: "repo", ...config };
  },

  document(config: Omit<DocumentSourceConfig, "type">): DocumentSourceConfig {
    return { type: "document", ...config };
  },

  database<Row extends RelationalRow>(
    config: Omit<DatabaseSourceConfig<Row>, "type">
  ): DatabaseSourceConfig<Row> {
    return { type: "database", ...config };
  },

  url(config: Omit<UrlSourceConfig, "type">): UrlSourceConfig {
    return { type: "url", ...config };
  },

  custom(config: CustomSourceConfig): CustomSourceConfig {
    return config;
  }
};
