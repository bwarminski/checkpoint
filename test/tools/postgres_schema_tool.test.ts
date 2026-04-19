// ABOUTME: Verifies Postgres schema inspection renders schema and sample rows.
// ABOUTME: Confirms the tool keeps identifier validation while returning plain text.
import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresSchemaTool } from "../../src/tools/postgres/schema_tool.ts";

test("postgres schema tool returns formatted schema text for the requested tables", async () => {
  const received: Array<string> = [];
  const tool = createPostgresSchemaTool(async (sql) => {
    received.push(sql);
    if (sql.includes("information_schema.columns")) {
      return [
        { table_name: "todos", column_name: "id", data_type: "integer" },
        { table_name: "todos", column_name: "title", data_type: "text" },
        { table_name: "users", column_name: "id", data_type: "integer" },
      ];
    }

    if (sql.includes('"public"."todos"')) {
      return [{ id: 1, title: "ship it" }];
    }

    if (sql.includes('"public"."users"')) {
      return [{ id: 2 }];
    }

    return [];
  });

  const text = await tool.execute({ schema: "public", tables: ["todos", "users"] });

  assert.match(text, /^Table: todos/m);
  assert.match(text, /^- id: integer/m);
  assert.match(text, /^- title: text/m);
  assert.match(text, /^1 \| ship it/m);
  assert.match(text, /^Table: users/m);
  assert.match(text, /^2$/m);
  assert.equal(received.length, 3);
  assert.match(received[0] ?? "", /information_schema\.columns/);
});

test("postgres schema tool rejects empty table lists", async () => {
  const tool = createPostgresSchemaTool(async () => []);

  await assert.rejects(
    () => tool.execute({ schema: "public", tables: [] }),
    /table list/i,
  );
});

test("postgres schema tool rejects non-identifier table names", async () => {
  const tool = createPostgresSchemaTool(async () => []);

  await assert.rejects(
    () => tool.execute({ schema: "public", tables: ["todos;drop"] }),
    /invalid.*table/i,
  );
});
