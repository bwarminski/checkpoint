// ABOUTME: Lists ClickHouse tables from the requested database through an injected runner.
// ABOUTME: Keeps table discovery coarse and independent from runtime wiring.
import { assertIdentifierLike } from "../shared/identifier.ts";

export function createClickHouseListTablesTool(
  runQuery: (sql: string) => Promise<Array<{ name: string }>>,
) {
  return {
    async execute(input: { database: string }) {
      assertIdentifierLike(input.database, "ClickHouse database");
      const rows = await runQuery(
        `select name from system.tables where database = '${input.database}' order by name`,
      );
      return rows.map((row) => row.name).join(", ");
    },
  };
}
