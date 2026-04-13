// ABOUTME: Verifies shared schema rendering stays deterministic across SQL tools.
// ABOUTME: Locks down the schema-plus-sample-rows text contract.
import assert from "node:assert/strict";
import test from "node:test";

import { formatSchemaTables } from "../../src/tools/shared/schema_formatter.ts";

test("formatSchemaTables renders one table with columns and sample rows", () => {
  const rendered = formatSchemaTables([
    {
      tableName: "users",
      columns: [
        { name: "id", type: "bigint" },
        { name: "name", type: "character varying" },
      ],
      sampleRows: [{ id: 1, name: "Ada" }],
    },
  ]);

  assert.match(rendered, /^Table: users/m);
  assert.match(rendered, /^- id: bigint/m);
  assert.match(rendered, /^- name: character varying/m);
  assert.match(rendered, /^Sample rows:/m);
  assert.match(rendered, /^id \| name/m);
  assert.match(rendered, /^1 \| Ada/m);
});

test("formatSchemaTables renders multiple table blocks deterministically", () => {
  const rendered = formatSchemaTables([
    {
      tableName: "todos",
      columns: [{ name: "id", type: "bigint" }],
      sampleRows: [],
    },
    {
      tableName: "users",
      columns: [{ name: "id", type: "bigint" }],
      sampleRows: [],
    },
  ]);

  assert.ok(rendered.indexOf("Table: todos") < rendered.indexOf("Table: users"));
});

test("formatSchemaTables renders a stable empty sample section", () => {
  const rendered = formatSchemaTables([
    {
      tableName: "query_events",
      columns: [{ name: "fingerprint", type: "String" }],
      sampleRows: [],
    },
  ]);

  assert.match(rendered, /^Sample rows:/m);
  assert.match(rendered, /^\(no rows\)$/m);
});
