// ABOUTME: Lists PostgreSQL tables from the requested schema through an injected runner.
// ABOUTME: Keeps table discovery separate from schema and query execution concerns.
export function createPostgresListTablesTool(
  runQuery: (sql: string) => Promise<Array<{ table_name: string }>>,
) {
  return {
    async execute(input: { schema: string }) {
      assertIdentifierLike(input.schema, "PostgreSQL schema");
      const rows = await runQuery(
        `select table_name from information_schema.tables where table_schema = '${input.schema}' order by table_name`,
      );
      return rows.map((row) => row.table_name);
    },
  };
}

function assertIdentifierLike(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}
