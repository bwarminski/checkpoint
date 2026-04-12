// ABOUTME: Inspects PostgreSQL table columns from information_schema through an injected runner.
// ABOUTME: Leaves runtime wiring and connection ownership to the caller.
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
      return runQuery(
        "select column_name, data_type " +
          "from information_schema.columns " +
          `where table_schema = '${input.schema}' and table_name in (${tables}) ` +
          "order by ordinal_position",
      );
    },
  };
}

function assertIdentifierLike(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}
