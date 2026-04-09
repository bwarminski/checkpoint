// ABOUTME: Verifies the ClickHouse schema contract guard rejects mismatched versions.
// ABOUTME: Keeps startup validation aligned with the collector-published schema version.
import assert from "node:assert/strict";
import test from "node:test";

import { assertSchemaContractSatisfied } from "../../src/clickhouse_schema_contract.ts";

test("assertSchemaContractSatisfied rejects a mismatched schema version", async () => {
  await assert.rejects(
    () =>
      assertSchemaContractSatisfied({
        expectedVersion: "2",
        introspection: {
          schemaVersion: "1",
          tables: [{ name: "query_events", columns: ["fingerprint"] }],
        },
      }),
    /schema version/i,
  );
});
