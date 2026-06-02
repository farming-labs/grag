import { renderSafeSql } from "@farming-labs/orm";
import { graphRagOrmSchema } from "./schema.js";

export type GraphRagOrmSqlDialect = "postgres" | "mysql" | "sqlite";

export function getGraphRagOrmMigrationSql(dialect: GraphRagOrmSqlDialect): string {
  return renderSafeSql(graphRagOrmSchema, { dialect });
}

export function getGraphRagOrmMigrationStatements(dialect: GraphRagOrmSqlDialect): string[] {
  return getGraphRagOrmMigrationSql(dialect)
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}
