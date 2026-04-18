// ABOUTME: Covers the shared live query checker parsing contract used by oh-my-pi helpers.
// ABOUTME: Keeps fenced JSON handling stable while the runtime glue moves out of test helpers.
import assert from "node:assert/strict";
import test from "node:test";

import { parseQueryCheckResult } from "../helpers/oh_my_pi_workspace.ts";

test("parseQueryCheckResult accepts fenced JSON returned by live checker calls", () => {
  const result = parseQueryCheckResult(
    '```json\n{"verdict":"safe","rewrittenQuery":"select 1","notes":["ok"]}\n```',
  );

  assert.equal(result.verdict, "safe");
  assert.equal(result.rewrittenQuery, "select 1");
  assert.deepEqual(result.notes, ["ok"]);
});
