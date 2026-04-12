// ABOUTME: Verifies the generated oh-my-pi workspace exists outside the main checkout.
// ABOUTME: Confirms the runtime-facing skills and tools are exposed through repo-backed symlinks.
import assert from "node:assert/strict";
import { lstat, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("workspace setup creates symlinked skills and tools in the external workspace", async () => {
  const workspaceRoot = join(homedir(), ".oh-my-pi-workspaces", "checkpoint");
  const skillsEntry = join(workspaceRoot, ".omp", "skills");
  const toolsEntry = join(workspaceRoot, ".omp", "tools");
  const workdirEntry = join(workspaceRoot, "workdir");

  const workspaceStats = await lstat(workspaceRoot);
  const skillsStats = await lstat(skillsEntry);
  const toolsStats = await lstat(toolsEntry);
  const workdirStats = await lstat(workdirEntry);

  assert.equal(workspaceStats.isDirectory(), true);
  assert.equal(skillsStats.isSymbolicLink(), true);
  assert.equal(await readlink(skillsEntry), join(process.cwd(), "skills"));
  assert.equal(toolsStats.isSymbolicLink(), true);
  assert.equal(await readlink(toolsEntry), join(process.cwd(), "src", "tools"));
  assert.equal(workdirStats.isDirectory(), true);
});
