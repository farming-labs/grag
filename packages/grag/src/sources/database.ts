import type { GraphRagDocument } from "../model.js";
import { relationalRowsToDocuments } from "../ingest/relational.js";
import type { DatabaseSourceConfig, RelationalRow } from "./types.js";

export async function loadDatabaseSource<Row extends RelationalRow>(
  config: DatabaseSourceConfig<Row>,
): Promise<GraphRagDocument[]> {
  const rows = await resolveRows(config);
  validateConfig(config, rows);

  const docs = relationalRowsToDocuments({
    tableName: config.tableName,
    rows,
    ...(config.idColumn !== undefined ? { idColumn: config.idColumn } : {}),
    ...(config.titleColumn !== undefined ? { titleColumn: config.titleColumn } : {}),
    ...(config.textColumn !== undefined ? { textColumn: config.textColumn } : {}),
    ...(config.textColumns !== undefined ? { textColumns: config.textColumns } : {}),
    ...(config.attributeColumns !== undefined ? { attributeColumns: config.attributeColumns } : {}),
    ...(config.documentType !== undefined ? { documentType: config.documentType } : {}),
  });

  return docs.map((doc, index) => ({
    ...doc,
    attributes: {
      ...(doc.attributes ?? {}),
      sourceKind: "database",
      sourceTable: config.tableName,
      sourceRowId: rowId(rows[index], index, config.idColumn),
      sourcePath: databaseSourcePath(config.tableName, rows[index], index, config.idColumn),
      ...(config.label !== undefined ? { sourceLabel: config.label } : {}),
    },
  }));
}

async function resolveRows<Row extends RelationalRow>(
  config: DatabaseSourceConfig<Row>,
): Promise<readonly Row[]> {
  const hasRows = config.rows !== undefined;
  const hasLoader = config.loadRows !== undefined;

  if (hasRows && hasLoader) {
    throw new Error("Database source must provide either rows or loadRows, not both.");
  }
  if (!hasRows && !hasLoader) {
    throw new Error("Database source must provide rows or loadRows.");
  }

  return hasRows ? config.rows! : await config.loadRows!();
}

function validateConfig<Row extends RelationalRow>(
  config: DatabaseSourceConfig<Row>,
  rows: readonly Row[],
): void {
  if (config.tableName.trim().length === 0) {
    throw new Error("Database source tableName must not be empty.");
  }
  if (config.textColumn !== undefined && config.textColumns !== undefined) {
    throw new Error("Database source must use either textColumn or textColumns, not both.");
  }

  validateColumn(rows, "idColumn", config.idColumn);
  validateColumn(rows, "titleColumn", config.titleColumn);
  validateColumn(rows, "textColumn", config.textColumn);

  for (const column of config.textColumns ?? []) {
    validateColumn(rows, "textColumns", column);
  }
  for (const column of config.attributeColumns ?? []) {
    validateColumn(rows, "attributeColumns", column);
  }
}

function validateColumn<Row extends RelationalRow>(
  rows: readonly Row[],
  optionName: string,
  column: (keyof Row & string) | undefined,
): void {
  if (column === undefined || rows.length === 0) {
    return;
  }

  const missingIndex = rows.findIndex((row) => !Object.prototype.hasOwnProperty.call(row, column));
  if (missingIndex !== -1) {
    throw new Error(
      `Database source ${optionName} "${column}" is missing from row ${missingIndex}.`,
    );
  }
}

function databaseSourcePath<Row extends RelationalRow>(
  tableName: string,
  row: Row | undefined,
  index: number,
  idColumn: (keyof Row & string) | undefined,
): string {
  return `database:${tableName}:${rowId(row, index, idColumn)}`;
}

function rowId<Row extends RelationalRow>(
  row: Row | undefined,
  index: number,
  idColumn: (keyof Row & string) | undefined,
): string {
  const column = idColumn ?? ("id" as keyof Row & string);
  const value = row?.[column];
  const text = stringifyCell(value);
  return text || String(index);
}

function stringifyCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
