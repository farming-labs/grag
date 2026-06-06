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
  RelationalRow,
} from "./types.js";

import type {
  CustomSourceConfig,
  DatabaseSourceConfig,
  DocumentSourceConfig,
  RelationalRow,
  RepoSourceConfig,
  UrlSourceConfig,
} from "./types.js";

export { DataSourceLoader, defineSource, defineSources } from "./loader.js";

export { loadDatabaseSource } from "./database.js";

export type { DataSourceLoaderOptions, LoadedDocuments } from "./loader.js";

export const source = {
  repo(config: Omit<RepoSourceConfig, "type">): RepoSourceConfig {
    return { ...config, type: "repo" };
  },

  document(config: Omit<DocumentSourceConfig, "type">): DocumentSourceConfig {
    return { ...config, type: "document" };
  },

  database<Row extends RelationalRow>(
    config: Omit<DatabaseSourceConfig<Row>, "type">,
  ): DatabaseSourceConfig<Row> {
    return { ...config, type: "database" };
  },

  url(config: Omit<UrlSourceConfig, "type">): UrlSourceConfig {
    return { ...config, type: "url" };
  },

  custom(config: CustomSourceConfig): CustomSourceConfig {
    return config;
  },
};
