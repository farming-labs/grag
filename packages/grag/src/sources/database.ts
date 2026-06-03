import type { GraphRagDocument } from "../model.js";
import { relationalRowsToDocuments } from "../ingest/relational.js";
import type { DatabaseSourceConfig } from "./types.js";

export async function loadDatabaseSource(config: DatabaseSourceConfig): Promise<GraphRagDocument[]> {
  const docs = relationalRowsToDocuments({
    tableName: config.tableName,
    rows: config.rows,
    ...(config.idColumn !== undefined ? { idColumn: config.idColumn } : {}),
    ...(config.titleColumn !== undefined ? { titleColumn: config.titleColumn } : {}),
    ...(config.textColumns !== undefined ? { textColumns: config.textColumns } : {}),
    ...(config.attributeColumns !== undefined ? { attributeColumns: config.attributeColumns } : {}),
    ...(config.documentType !== undefined ? { documentType: config.documentType } : {})
  });

  if (config.label === undefined) {
    return docs;
  }

  const sourceLabel = config.label;
  return docs.map((doc) => ({
    ...doc,
    attributes: {
      ...(doc.attributes ?? {}),
      sourceLabel
    }
  }));
}
