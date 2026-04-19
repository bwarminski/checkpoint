// ABOUTME: Exercises the generated db-specialist extension entrypoint in the oh-my-pi workspace.
// ABOUTME: Verifies the helper rejects a broken extension-owned runtime path before session startup.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getWorkspaceToolNames,
  getWorkspaceRoot,
  validateWorkspaceExtension,
  setupWorkspace,
} from "../helpers/oh_my_pi_workspace.ts";

test("workspace setup validates the generated db specialist extension entrypoint", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-oh-my-pi-home-"));
  const workspaceRoot = getWorkspaceRoot(fakeHome);
  const extensionEntry = join(workspaceRoot, ".omp", "extensions", "db-specialist.ts");

  try {
    await setupWorkspace(fakeHome);
    await writeFile(extensionEntry, "export default 42;\n");

    await assert.rejects(() => validateWorkspaceExtension(fakeHome), /extension/i);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});

test("workspace session tool names come from the generated extension runtime", {
  skip: !process.env.OMP_MODEL || !("bun" in process.versions),
  timeout: 30_000,
}, async () => {
  const model = process.env.OMP_MODEL;
  assert.ok(model);
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-oh-my-pi-home-"));
  const workspaceRoot = getWorkspaceRoot(fakeHome);
  const extensionEntry = join(workspaceRoot, ".omp", "extensions", "db-specialist.ts");

  try {
    await setupWorkspace(fakeHome);
    await writeFile(extensionEntry, "export default function dbSpecialistExtension() {}\n");

    const toolNames = await getWorkspaceToolNames({
      home: fakeHome,
      model,
    });

    assert.equal(toolNames.includes("sql_db_list_tables"), false);
    assert.equal(toolNames.includes("clickhouse_db_query"), false);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});
