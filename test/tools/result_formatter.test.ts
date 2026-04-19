// ABOUTME: Verifies shared query-result rendering stays deterministic and readable.
// ABOUTME: Locks down the text contract used by the coarse SQL query tools.
import assert from "node:assert/strict";
import test from "node:test";

import { formatQueryResult } from "../../src/tools/shared/result_formatter.ts";

test("formatQueryResult renders multiple rows with headers", () => {
  const rendered = formatQueryResult([
    { id: 1, name: "Ada" },
    { id: 2, name: "Grace" },
  ]);

  assert.match(rendered, /^id \| name/m);
  assert.match(rendered, /^1 \| Ada/m);
  assert.match(rendered, /^2 \| Grace/m);
});

test("formatQueryResult renders an explicit empty result", () => {
  assert.equal(formatQueryResult([]), "(no rows)");
});

test("formatQueryResult preserves column names when rendering values", () => {
  const rendered = formatQueryResult([
    { fingerprint: "abc", mean_exec_time_ms: 12.5, notes: null },
  ]);

  assert.match(rendered, /^fingerprint \| mean_exec_time_ms \| notes/m);
  assert.match(rendered, /^abc \| 12\.5 \| null/m);
});
