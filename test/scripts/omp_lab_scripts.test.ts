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
  const scriptEnv = { ...process.env };
  for (const name of ["GITHUB_TOKEN", "OMP_LAB_ENABLE_SSH", "OMP_LAB_SSH_KEY", "OMP_LAB_CONTAINER_USER"]) {
    delete scriptEnv[name];
  }

  const result = await execFileAsync("bash", [join(repoRoot, "scripts", scriptName)], {
    cwd: repoRoot,
    env: {
      ...scriptEnv,
      OMP_LAB_DRY_RUN: "1",
      OMP_MODEL: "google/gemini-2.5-pro",
      GEMINI_API_KEY: "test-gemini-key",
      ...env,
    },
  });
  return result.stdout;
}

async function parseDryRunArgs(output: string) {
  const result = await execFileAsync(
    "bash",
    ["-lc", 'eval "set -- ${OMP_LAB_DRY_RUN_OUTPUT}"; printf "%s\\0" "$@"'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        OMP_LAB_DRY_RUN_OUTPUT: output,
      },
      encoding: "buffer",
    },
  );
  return result.stdout.toString("utf8").split("\0").slice(0, -1);
}

test("control dry run mounts only the neutral workspace and shared service env", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));
  const fakeWorkspace = await mkdtemp(join(tmpdir(), "checkpoint-omp-control-"));

  try {
    const output = await runScript("run-omp-control-container.sh", {
      HOME: fakeHome,
      OMP_LAB_WORKSPACE: fakeWorkspace,
    });
    const args = await parseDryRunArgs(output);

    assert.match(output, /docker run --rm -it/);
    assert.deepEqual(args.slice(0, 4), ["docker", "run", "--rm", "-it"]);
    assert.ok(args.includes("--add-host"));
    assert.ok(args.includes("host.docker.internal:host-gateway"));
    assert.ok(args.includes(`type=bind,source=${fakeWorkspace},target=/workspace`));
    assert.ok(args.includes("GEMINI_API_KEY=test-gemini-key"));
    assert.ok(args.includes("OMP_MODEL=google/gemini-2.5-pro"));
    assert.ok(args.includes("PGHOST=host.docker.internal"));
    assert.ok(args.includes("CLICKHOUSE_URL=http://host.docker.internal:8123"));
    assert.ok(args.includes("checkpoint.omp-lab=true"));
    assert.ok(args.includes("checkpoint.omp-lab.mode=control"));
    assert.ok(!args.some((arg) => arg.startsWith("GITHUB_TOKEN=")));
    assert.doesNotMatch(output, new RegExp(repoRoot));
    assert.doesNotMatch(output, /\.ssh/);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeWorkspace, { recursive: true, force: true });
  }
});

test("control SSH mode mounts only id_rsa read-only and forwards GitHub token when present", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));
  const fakeWorkspace = await mkdtemp(join(tmpdir(), "checkpoint-omp-control-"));
  const fakeSshDir = join(fakeHome, ".ssh");
  const fakeKey = join(fakeSshDir, "id_rsa");

  try {
    await mkdir(fakeSshDir, { recursive: true });
    await writeFile(fakeKey, "fake-key\n", { mode: 0o600 });

    const output = await runScript("run-omp-control-container.sh", {
      HOME: fakeHome,
      OMP_LAB_WORKSPACE: fakeWorkspace,
      OMP_LAB_ENABLE_SSH: "1",
      GITHUB_TOKEN: "test-gh-token",
    });
    const args = await parseDryRunArgs(output);

    assert.ok(args.includes(`type=bind,source=${fakeKey},target=/home/codespace/.ssh/id_rsa,readonly`));
    assert.ok(args.includes("GITHUB_TOKEN"));
    assert.ok(!args.includes("GITHUB_TOKEN=test-gh-token"));
    assert.doesNotMatch(output, /test-gh-token/);
    assert.ok(args.includes("OMP_LAB_ENABLE_SSH=1"));
    assert.ok(!args.includes(`type=bind,source=${fakeSshDir},target=/home/codespace/.ssh,readonly`));
    assert.doesNotMatch(output, /\.gitconfig/);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeWorkspace, { recursive: true, force: true });
  }
});

test("control dry run ignores scoped host env by default", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));
  const fakeWorkspace = await mkdtemp(join(tmpdir(), "checkpoint-omp-control-"));
  const fakeSshDir = join(fakeHome, ".ssh");
  const fakeKey = join(fakeSshDir, "id_rsa");
  const originalEnv = {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    OMP_LAB_CONTAINER_USER: process.env.OMP_LAB_CONTAINER_USER,
    OMP_LAB_ENABLE_SSH: process.env.OMP_LAB_ENABLE_SSH,
    OMP_LAB_SSH_KEY: process.env.OMP_LAB_SSH_KEY,
  };

  try {
    await mkdir(fakeSshDir, { recursive: true });
    await writeFile(fakeKey, "fake-key\n", { mode: 0o600 });
    process.env.GITHUB_TOKEN = "host-gh-token";
    process.env.OMP_LAB_CONTAINER_USER = "hostuser";
    process.env.OMP_LAB_ENABLE_SSH = "1";
    process.env.OMP_LAB_SSH_KEY = fakeKey;

    const output = await runScript("run-omp-control-container.sh", {
      HOME: fakeHome,
      OMP_LAB_WORKSPACE: fakeWorkspace,
    });
    const args = await parseDryRunArgs(output);

    assert.ok(!args.includes("GITHUB_TOKEN"));
    assert.ok(!args.some((arg) => arg.startsWith("GITHUB_TOKEN=")));
    assert.ok(!args.includes("OMP_LAB_ENABLE_SSH=1"));
    assert.doesNotMatch(output, /host-gh-token/);
    assert.doesNotMatch(output, /hostuser/);
    assert.doesNotMatch(output, /\.ssh/);
  } finally {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeWorkspace, { recursive: true, force: true });
  }
});

test("control dry run shell-escapes arguments containing spaces", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));
  const fakeParent = await mkdtemp(join(tmpdir(), "checkpoint-omp-control-"));
  const fakeWorkspace = join(fakeParent, "workspace with spaces");

  try {
    await mkdir(fakeWorkspace);
    const output = await runScript("run-omp-control-container.sh", {
      HOME: fakeHome,
      OMP_LAB_WORKSPACE: fakeWorkspace,
      GEMINI_API_KEY: "test gemini key",
    });
    const args = await parseDryRunArgs(output);

    assert.match(output, /workspace\\ with\\ spaces/);
    assert.match(output, /GEMINI_API_KEY=test\\ gemini\\ key/);
    assert.ok(args.includes(`type=bind,source=${fakeWorkspace},target=/workspace`));
    assert.ok(args.includes("GEMINI_API_KEY=test gemini key"));
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeParent, { recursive: true, force: true });
  }
});

test("skills dry run mounts generated workspace plus checkpoint skill and extension sources", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));
  const fakeWorkspace = await mkdtemp(join(tmpdir(), "checkpoint-omp-skilled-"));

  try {
    const output = await runScript("run-omp-skilled-container.sh", {
      HOME: fakeHome,
      OMP_LAB_WORKSPACE: fakeWorkspace,
    });
    const args = await parseDryRunArgs(output);

    assert.ok(args.includes(`type=bind,source=${fakeWorkspace},target=/workspace`));
    assert.ok(args.includes(`type=bind,source=${repoRoot}/skills,target=/workspace/.omp/skills,readonly`));
    assert.ok(args.includes(`type=bind,source=${repoRoot}/src,target=/checkpoint-src/src,readonly`));
    assert.ok(args.includes("CHECKPOINT_EXTENSION_SOURCE=/checkpoint-src/src/omp_extension/db_specialist_extension.ts"));
    assert.ok(args.includes("PGHOST=host.docker.internal"));
    assert.ok(args.includes("checkpoint.omp-lab.mode=skilled"));
    assert.ok(args.includes("checkpoint-omp-lab:local"));
    assert.ok(args.includes("--model"));
    assert.ok(args.includes("google/gemini-2.5-pro"));

    const extensionEntry = join(fakeWorkspace, ".omp", "extensions", "db-specialist.ts");
    assert.equal(await readFile(extensionEntry, "utf8"), 'export { default } from "/checkpoint-src/src/omp_extension/db_specialist_extension.ts";\n');
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeWorkspace, { recursive: true, force: true });
  }
});
