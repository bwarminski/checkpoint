// ABOUTME: Verifies the agent test wrapper keeps npm test argument routing stable.
// ABOUTME: Guards option-only, file-only, and mixed test invocations against regressions.
import assert from "node:assert/strict";
import test from "node:test";

import { buildTestCommand, getDefaultTestFiles } from "../scripts/run-tests.mjs";

test("buildTestCommand uses the default globs when no args are provided", () => {
  assert.deepEqual(buildTestCommand([]), getDefaultTestFiles());
});

test("buildTestCommand keeps default globs for option-only reporter invocations", () => {
  assert.deepEqual(buildTestCommand(["--test-reporter", "tap"]), [
    "--test-reporter",
    "tap",
    ...getDefaultTestFiles(),
  ]);
});

test("buildTestCommand keeps default globs for test concurrency invocations", () => {
  assert.deepEqual(buildTestCommand(["--test-concurrency", "1"]), [
    "--test-concurrency",
    "1",
    ...getDefaultTestFiles(),
  ]);
});

test("buildTestCommand keeps default globs for test shard invocations", () => {
  assert.deepEqual(buildTestCommand(["--test-shard", "1/1"]), [
    "--test-shard",
    "1/1",
    ...getDefaultTestFiles(),
  ]);
});

test("buildTestCommand keeps file-only invocations scoped to the requested file", () => {
  assert.deepEqual(buildTestCommand(["test/server.test.ts"]), [
    "test/server.test.ts",
  ]);
});

test("buildTestCommand keeps mixed option and file invocations scoped to the requested file", () => {
  assert.deepEqual(
    buildTestCommand([
      "--test-name-pattern",
      "schema version|validates the runtime schema",
      "test/server.test.ts",
    ]),
    [
      "--test-name-pattern",
      "schema version|validates the runtime schema",
      "test/server.test.ts",
    ],
  );
});
