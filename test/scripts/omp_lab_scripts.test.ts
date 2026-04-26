// ABOUTME: Tests the Docker-based OMP lab scripts without launching interactive containers.
// ABOUTME: Verifies source isolation, optional credential mounts, and shared image contracts.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const repoRoot = process.cwd();
const execFileAsync = promisify(execFile);

test("lab Dockerfile uses the universal dev container base and does not copy the repo", async () => {
  const dockerfile = await readFile(join(repoRoot, "Dockerfile"), "utf8");

  assert.match(dockerfile, /^FROM mcr\.microsoft\.com\/devcontainers\/universal:2-linux/m);
  assert.match(dockerfile, /@oh-my-pi\/pi-coding-agent/);
  assert.match(dockerfile, /@sinclair\/typebox/);
  assert.match(dockerfile, /@oh-my-pi\/pi-ai/);
  assert.match(dockerfile, /pg@/);
  assert.match(dockerfile, /\bgh\b/);
  assert.match(dockerfile, /postgresql-client/);
  assert.match(dockerfile, /\/checkpoint-src/);
  assert.match(dockerfile, /rm -f \/etc\/apt\/sources\.list\.d\/yarn\.list\s+\\\n\s+&& apt-get update/);
  assert.match(dockerfile, /ssh-keyscan github\.com > \/etc\/ssh\/ssh_known_hosts/);
  assert.match(dockerfile, /^ENV BUN_INSTALL="\/usr\/local"$/m);
  assert.match(dockerfile, /^ENV PATH="\/usr\/local\/bin:\$\{PATH\}"$/m);
  assert.match(dockerfile, /mkdir -p \/workspace\s+\\\n\s+&& chown codespace:codespace \/workspace/);
  assert.match(dockerfile, /\/home\/codespace\/\.ssh/);
  assert.match(dockerfile, /chown -R codespace:codespace \/home\/codespace\/\.ssh/);
  assert.match(dockerfile, /IdentityFile ~\/\.ssh\/id_rsa/);
  assert.match(dockerfile, /^WORKDIR \/workspace$/m);
  assert.match(dockerfile, /^USER codespace$/m);
  assert.match(dockerfile, /^ENTRYPOINT \["omp"\]$/m);
  assert.doesNotMatch(dockerfile, /^COPY \. \./m);
  assert.doesNotMatch(dockerfile, /^WORKDIR \/app$/m);
  assert.doesNotMatch(dockerfile, /\/home\/vscode/);
  assert.doesNotMatch(dockerfile, /^USER vscode$/m);
  assert.doesNotMatch(dockerfile, /chown -R vscode:vscode/);
  assert.doesNotMatch(dockerfile, /\/root\/\.bun\/bin/);
  assert.doesNotMatch(dockerfile, /ln -s .*omp/);
});

test(
  "lab Docker image starts as codespace with OMP and writable workspace",
  { skip: process.env.OMP_LAB_DOCKER_SMOKE !== "1", timeout: 600_000 },
  async () => {
    const image = `checkpoint-omp-lab-smoke:${process.pid}-${Date.now()}`;

    try {
      await execFileAsync("docker", ["build", "-t", image, "."], {
        cwd: repoRoot,
        maxBuffer: 1024 * 1024 * 20,
      });

      const { stdout } = await execFileAsync(
        "docker",
        [
          "run",
          "--rm",
          "--entrypoint",
          "bash",
          image,
          "-lc",
          [
            "command -v omp >/dev/null",
            'test "$(whoami)" = codespace',
            "test -w /workspace",
            "test -r /checkpoint-src/node_modules/@oh-my-pi/pi-ai/package.json",
            "printf smoke-ok",
          ].join(" && "),
        ],
        { maxBuffer: 1024 * 1024 * 20 },
      );

      assert.equal(stdout, "smoke-ok");
    } finally {
      await execFileAsync("docker", ["image", "rm", "-f", image]).catch(() => {});
    }
  },
);

async function runScript(scriptName: string, env: Record<string, string>) {
  const result = await execFileAsync("bash", [join(repoRoot, "scripts", scriptName)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      OMP_LAB_DRY_RUN: "1",
      OMP_MODEL: "google/gemini-2.5-pro",
      GEMINI_API_KEY: "test-gemini-key",
    },
  });
  return result.stdout;
}

test("control dry run mounts only the neutral workspace and shared service env", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));
  const fakeWorkspace = await mkdtemp(join(tmpdir(), "checkpoint-omp-control-"));

  try {
    const output = await runScript("run-omp-control-container.sh", {
      HOME: fakeHome,
      OMP_LAB_WORKSPACE: fakeWorkspace,
    });

    assert.match(output, /docker run --rm -it/);
    assert.match(output, /--add-host host\.docker\.internal:host-gateway/);
    assert.match(output, new RegExp(`--mount type=bind,source=${fakeWorkspace},target=/workspace`));
    assert.match(output, /--env GEMINI_API_KEY=test-gemini-key/);
    assert.match(output, /--env OMP_MODEL=google\/gemini-2\.5-pro/);
    assert.match(output, /--env PGHOST=host\.docker\.internal/);
    assert.match(output, /--env CLICKHOUSE_URL=http:\/\/host\.docker\.internal:8123/);
    assert.match(output, /--label checkpoint\.omp-lab=true/);
    assert.match(output, /--label checkpoint\.omp-lab\.mode=control/);
    assert.doesNotMatch(output, new RegExp(repoRoot));
    assert.doesNotMatch(output, /\.ssh/);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeWorkspace, { recursive: true, force: true });
  }
});
