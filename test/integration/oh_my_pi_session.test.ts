// ABOUTME: Verifies the generated oh-my-pi workspace exists outside the main checkout.
// ABOUTME: Confirms the generated workspace skeleton exposes repo-backed symlinks.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdtemp, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("workspace setup and reset create the expected workspace skeleton", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-oh-my-pi-home-"));
  const workspaceRoot = join(fakeHome, ".oh-my-pi-workspaces", "checkpoint");
  const skillsEntry = join(workspaceRoot, ".omp", "skills");
  const toolsEntry = join(workspaceRoot, ".omp", "tools");
  const workdirEntry = join(workspaceRoot, "workdir");

  try {
    await assert.rejects(() => lstat(workspaceRoot));

    await execFileAsync("bash", ["scripts/setup-oh-my-pi-workspace.sh"], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: fakeHome },
    });

    let workspaceStats = await lstat(workspaceRoot);
    let skillsStats = await lstat(skillsEntry);
    let toolsStats = await lstat(toolsEntry);
    let workdirStats = await lstat(workdirEntry);

    assert.equal(workspaceStats.isDirectory(), true);
    assert.equal(skillsStats.isSymbolicLink(), true);
    assert.equal(await readlink(skillsEntry), join(process.cwd(), "skills"));
    assert.equal(toolsStats.isSymbolicLink(), true);
    assert.equal(await readlink(toolsEntry), join(process.cwd(), "src", "tools"));
    assert.equal(workdirStats.isDirectory(), true);

    await execFileAsync("bash", ["scripts/reset-oh-my-pi-workspace.sh"], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: fakeHome },
    });

    workspaceStats = await lstat(workspaceRoot);
    skillsStats = await lstat(skillsEntry);
    toolsStats = await lstat(toolsEntry);
    workdirStats = await lstat(workdirEntry);

    assert.equal(workspaceStats.isDirectory(), true);
    assert.equal(skillsStats.isSymbolicLink(), true);
    assert.equal(toolsStats.isSymbolicLink(), true);
    assert.equal(workdirStats.isDirectory(), true);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});
