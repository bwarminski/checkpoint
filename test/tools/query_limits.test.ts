// ABOUTME: Verifies SQL tools clamp row counts and expose per-query timeout settings.
// ABOUTME: Keeps Postgres and ClickHouse query limits consistent.
import assert from "node:assert/strict";
import test from "node:test";

import { resolveQueryLimits } from "../../src/tools/shared/query_limits.ts";

test("resolveQueryLimits clamps row caps and timeout values", () => {
  assert.deepEqual(
    resolveQueryLimits(
      { rowCap: 5_000, timeoutMs: 90_000 },
      { maxRows: 200, maxTimeoutMs: 10_000 },
    ),
    {
      rowCap: 200,
      timeoutMs: 10_000,
    },
  );
});
