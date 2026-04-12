// ABOUTME: Inspects ClickHouse table columns from system.columns through an injected runner.
// ABOUTME: Leaves connection ownership and runtime concerns to the caller.
export function createClickHouseSchemaTool(
  runQuery: (sql: string) => Promise<Array<Record<string, unknown>>>,
) {
  return {
    async execute(input: { database: string; tables: Array<string> }) {
      const tables = input.tables.map((table) => `'${table}'`).join(", ");
      return runQuery(
        "select name, type " +
          "from system.columns " +
          `where database = '${input.database}' and table in (${tables}) ` +
          "order by position",
      );
    },
  };
}
