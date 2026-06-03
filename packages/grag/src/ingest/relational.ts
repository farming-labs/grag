import type { GraphRagDocument, JsonObject, JsonValue } from "../model.js";
import { createStableId } from "../utils/ids.js";

export type RelationalRow = Record<string, unknown>;

export interface RelationalRowsToDocumentsOptions<Row extends RelationalRow = RelationalRow> {
  tableName: string;
  rows: readonly Row[];
  idColumn?: keyof Row & string;
  titleColumn?: keyof Row & string;
  textColumn?: keyof Row & string;
  textColumns?: readonly (keyof Row & string)[];
  documentType?: string;
  attributeColumns?: readonly (keyof Row & string)[];
}

export function relationalRowsToDocuments<Row extends RelationalRow>(
  options: RelationalRowsToDocumentsOptions<Row>
): GraphRagDocument[] {
  const {
    rows,
    tableName,
    idColumn = "id" as keyof Row & string,
    titleColumn,
    textColumn,
    textColumns,
    documentType = "relational-row",
    attributeColumns
  } = options;

  return rows.map((row, index) => {
    const sourceId = stringifyCell(row[idColumn]) || String(index);
    const text = resolveText(row, textColumn, textColumns);
    const title =
      (titleColumn ? stringifyCell(row[titleColumn]) : undefined) ||
      `${tableName}:${sourceId}`;

    return {
      id: createStableId([tableName, sourceId], "doc"),
      humanReadableId: `${tableName}:${sourceId}`,
      title,
      type: documentType,
      text,
      textUnitIds: [],
      attributes: collectAttributes(row, attributeColumns, [textColumn, ...(textColumns ?? [])]),
      rawData: toJsonObject(row)
    };
  });
}

function resolveText<Row extends RelationalRow>(
  row: Row,
  textColumn?: keyof Row & string,
  textColumns?: readonly (keyof Row & string)[]
): string {
  if (textColumns?.length) {
    return textColumns
      .map((column) => stringifyCell(row[column]))
      .filter(Boolean)
      .join("\n");
  }

  if (textColumn) {
    return stringifyCell(row[textColumn]);
  }

  return Object.entries(row)
    .map(([key, value]) => `${key}: ${stringifyCell(value)}`)
    .join("\n");
}

function collectAttributes<Row extends RelationalRow>(
  row: Row,
  columns: readonly (keyof Row & string)[] | undefined,
  excluded: readonly ((keyof Row & string) | undefined)[]
): JsonObject {
  const excludedSet = new Set(excluded.filter((value): value is keyof Row & string => Boolean(value)));
  const entries = Object.entries(row).filter(([key]) => {
    if (excludedSet.has(key as keyof Row & string)) return false;
    return !columns || columns.includes(key as keyof Row & string);
  });

  return Object.fromEntries(entries.map(([key, value]) => [key, toJsonValue(value)]));
}

function stringifyCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function toJsonObject(row: RelationalRow): JsonObject {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toJsonValue(value)]));
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, toJsonValue(nested)])
    );
  }

  return String(value);
}
