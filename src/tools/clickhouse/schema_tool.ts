// ABOUTME: Inspects ClickHouse table columns from system.columns through an injected runner.
// ABOUTME: Leaves connection ownership and runtime concerns to the caller.
import { assertIdentifierLike } from "../shared/identifier.ts";

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
      return runQuery(
        "select name, type " +
          "from system.columns " +
          `where database = '${input.database}' and table in (${tables}) ` +
          "order by position",
      );
    },
  };
}

