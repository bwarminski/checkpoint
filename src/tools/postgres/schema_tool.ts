// ABOUTME: Inspects PostgreSQL table columns from information_schema through an injected runner.
// ABOUTME: Leaves runtime wiring and connection ownership to the caller.
import { assertIdentifierLike } from "../shared/identifier.ts";
import { formatSchemaTables } from "../shared/schema_formatter.ts";

export function createPostgresSchemaTool(
  runQuery: (sql: string) => Promise<Array<Record<string, unknown>>>,
) {
  return {
    async execute(input: { schema: string; tables: Array<string> }) {
      assertIdentifierLike(input.schema, "PostgreSQL schema");
      if (input.tables.length === 0) {
        throw new Error("Table list must not be empty");
      }

      const tables = input.tables.map((table) => {
        assertIdentifierLike(table, "PostgreSQL table");
        return `'${table}'`;
      }).join(", ");
      const columnRows = await runQuery(
        "select table_name, column_name, data_type " +
          "from information_schema.columns " +
          `where table_schema = '${input.schema}' and table_name in (${tables}) ` +
          "order by table_name, ordinal_position",
      );

      const columnsByTable = new Map<string, Array<{ name: string; type: string }>>();
      for (const row of columnRows) {
        const tableName = String(row.table_name);
        const columns = columnsByTable.get(tableName) ?? [];
        columns.push({
          name: String(row.column_name),
          type: String(row.data_type),
        });
        columnsByTable.set(tableName, columns);
      }

      const formattedTables = [];
      for (const tableName of input.tables) {
        const sampleRows = await runQuery(
          `select * from "${input.schema}"."${tableName}" limit 3`,
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
