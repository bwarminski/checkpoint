// ABOUTME: Inspects ClickHouse table columns from system.columns through an injected runner.
// ABOUTME: Leaves connection ownership and runtime concerns to the caller.
import { assertIdentifierLike } from "../shared/identifier.ts";
import { formatSchemaTables } from "../shared/schema_formatter.ts";

export function createClickHouseSchemaTool(
  runQuery: (sql: string) => Promise<Array<Record<string, unknown>>>,
) {
  return {
    async execute(input: { database: string; tables: Array<string> }) {
      assertIdentifierLike(input.database, "ClickHouse database");
      if (input.tables.length === 0) {
        throw new Error("Table list must not be empty");
      }

      const tables = input.tables
        .map((table) => {
          assertIdentifierLike(table, "ClickHouse table");
          return `'${table}'`;
        })
        .join(", ");
      const columnRows = await runQuery(
        "select table, name, type " +
          "from system.columns " +
          `where database = '${input.database}' and table in (${tables}) ` +
          "order by table, position",
      );

      const columnsByTable = new Map<string, Array<{ name: string; type: string }>>();
      for (const row of columnRows) {
        const tableName = String(row.table);
        const columns = columnsByTable.get(tableName) ?? [];
        columns.push({
          name: String(row.name),
          type: String(row.type),
        });
        columnsByTable.set(tableName, columns);
      }

      const formattedTables = [];
      for (const tableName of input.tables) {
        const sampleRows = await runQuery(
          `select * from ${input.database}.${tableName} limit 3`,
        );
        formattedTables.push({
          tableName,
          columns: columnsByTable.get(tableName) ?? [],
          sampleRows,
        });
      }

      return formatSchemaTables(formattedTables);
    },
  };
}
