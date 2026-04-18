// ABOUTME: Verifies the generated oh-my-pi workspace exists outside the main checkout.
// ABOUTME: Confirms the generated workspace skeleton and live-session harness behave as expected.
import assert from "node:assert/strict";
import { lstat, mkdtemp, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  getWorkspaceRoot,
  runWorkspaceChecker,
  resetWorkspace,
  runWorkspaceSession,
  setupWorkspace,
} from "../helpers/oh_my_pi_workspace.ts";

test("workspace setup and reset create the expected workspace skeleton", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-oh-my-pi-home-"));
  const workspaceRoot = getWorkspaceRoot(fakeHome);
  const skillsEntry = join(workspaceRoot, ".omp", "skills");
  const toolsEntry = join(workspaceRoot, ".omp", "tools");
  const postgresListEntry = join(toolsEntry, "sql_db_list_tables", "index.ts");
  const clickHouseQueryEntry = join(toolsEntry, "clickhouse_db_query", "index.ts");
  const workdirEntry = join(workspaceRoot, "workdir");

  try {
    await assert.rejects(() => lstat(workspaceRoot));

    await setupWorkspace(fakeHome);

    let workspaceStats = await lstat(workspaceRoot);
    let skillsStats = await lstat(skillsEntry);
    let toolsStats = await lstat(toolsEntry);
    let postgresListStats = await lstat(postgresListEntry);
    let clickHouseQueryStats = await lstat(clickHouseQueryEntry);
    let workdirStats = await lstat(workdirEntry);

    assert.equal(workspaceStats.isDirectory(), true);
    assert.equal(skillsStats.isSymbolicLink(), true);
    assert.equal(await readlink(skillsEntry), join(process.cwd(), "skills"));
    assert.equal(toolsStats.isDirectory(), true);
    assert.equal(toolsStats.isSymbolicLink(), false);
    assert.equal(postgresListStats.isFile(), true);
    assert.equal(clickHouseQueryStats.isFile(), true);
    assert.equal(workdirStats.isDirectory(), true);

    await resetWorkspace(fakeHome);

    workspaceStats = await lstat(workspaceRoot);
    skillsStats = await lstat(skillsEntry);
    toolsStats = await lstat(toolsEntry);
    postgresListStats = await lstat(postgresListEntry);
    clickHouseQueryStats = await lstat(clickHouseQueryEntry);
    workdirStats = await lstat(workdirEntry);

    assert.equal(workspaceStats.isDirectory(), true);
    assert.equal(skillsStats.isSymbolicLink(), true);
    assert.equal(toolsStats.isDirectory(), true);
    assert.equal(toolsStats.isSymbolicLink(), false);
    assert.equal(postgresListStats.isFile(), true);
    assert.equal(clickHouseQueryStats.isFile(), true);
    assert.equal(workdirStats.isDirectory(), true);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});

test("live oh-my-pi session exposes coarse SQL tools", {
  skip: !process.env.OMP_MODEL || !("bun" in process.versions),
  timeout: 30_000,
}, async () => {
  const model = process.env.OMP_MODEL;
  assert.ok(model);
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-oh-my-pi-live-home-"));

  try {
    await setupWorkspace(fakeHome);

    const output = await runWorkspaceSession({
      home: fakeHome,
      model,
      prompt:
        "List the available database investigation tools by name only, one per line.",
    });

    assert.match(output, /sql_db_list_tables/);
    assert.match(output, /clickhouse_db_query/);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});

test("live oh-my-pi checker tools return structured verdicts", {
  skip: !process.env.OMP_MODEL || !("bun" in process.versions),
  timeout: 30_000,
}, async () => {
  const model = process.env.OMP_MODEL;
  assert.ok(model);
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-oh-my-pi-checker-home-"));

  try {
    await setupWorkspace(fakeHome);

    const postgresResult = await runWorkspaceChecker({
      home: fakeHome,
      model,
      toolName: "sql_db_checker",
      input: {
        dialect: "postgres",
        question: "Check whether this exploratory query is safe.",
        query: "select 1",
      },
    });
    const clickHouseResult = await runWorkspaceChecker({
      home: fakeHome,
      model,
      toolName: "clickhouse_db_checker",
      input: {
        dialect: "clickhouse",
        question: "Check whether this exploratory query is safe.",
        query: "select 1",
      },
    });

    assert.match(postgresResult.verdict, /^(safe|rewrite|reject)$/);
    assert.equal(typeof postgresResult.rewrittenQuery, "string");
    assert.equal(Array.isArray(postgresResult.notes), true);

    assert.match(clickHouseResult.verdict, /^(safe|rewrite|reject)$/);
    assert.equal(typeof clickHouseResult.rewrittenQuery, "string");
    assert.equal(Array.isArray(clickHouseResult.notes), true);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});
