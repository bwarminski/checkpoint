// ABOUTME: Renders table schemas and sample rows into deterministic plain text.
// ABOUTME: Gives coarse SQL schema tools a readable text contract like LangChain's.

import { formatQueryResult } from "./result_formatter.ts";

export type FormattedSchemaTable = {
  tableName: string;
  columns: Array<{ name: string; type: string }>;
  sampleRows: Array<Record<string, unknown>>;
};

export function formatSchemaTables(tables: Array<FormattedSchemaTable>): string {
  return tables
    .map((table) => [
      `Table: ${table.tableName}`,
      "Columns:",
      ...table.columns.map((column) => `- ${column.name}: ${column.type}`),
      "Sample rows:",
      formatQueryResult(table.sampleRows),
    ].join("\n"))
    .join("\n\n");
}
