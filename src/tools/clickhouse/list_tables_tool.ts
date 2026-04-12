// ABOUTME: Lists ClickHouse tables from the requested database through an injected runner.
// ABOUTME: Keeps table discovery coarse and independent from runtime wiring.
export function createClickHouseListTablesTool(
  runQuery: (sql: string) => Promise<Array<{ name: string }>>,
) {
  return {
    async execute(input: { database: string }) {
      assertIdentifierLike(input.database, "ClickHouse database");
      const rows = await runQuery(
        `select name from system.tables where database = '${input.database}' order by name`,
      );
      return rows.map((row) => row.name);
    },
  };
}

function assertIdentifierLike(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}
