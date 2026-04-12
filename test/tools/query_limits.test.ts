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

test("resolveQueryLimits normalizes invalid row caps and timeouts", () => {
  assert.deepEqual(
    resolveQueryLimits(
      { rowCap: 0, timeoutMs: Number.NaN },
      { maxRows: 200, maxTimeoutMs: 10_000 },
    ),
    {
      rowCap: 200,
      timeoutMs: 10_000,
    },
  );

  assert.deepEqual(
    resolveQueryLimits(
      { rowCap: -5, timeoutMs: Number.POSITIVE_INFINITY },
      { maxRows: 200, maxTimeoutMs: 10_000 },
    ),
    {
      rowCap: 200,
      timeoutMs: 10_000,
    },
  );

  assert.deepEqual(
    resolveQueryLimits(
      { rowCap: 0.5, timeoutMs: 0.25 },
      { maxRows: 200, maxTimeoutMs: 10_000 },
    ),
    {
      rowCap: 1,
      timeoutMs: 1,
    },
  );
});
