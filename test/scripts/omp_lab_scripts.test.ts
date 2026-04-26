// ABOUTME: Tests the Docker-based OMP lab scripts without launching interactive containers.
// ABOUTME: Verifies source isolation, optional credential mounts, and shared image contracts.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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

async function runCleanScript(args: string[], env: Record<string, string>, options: { dryRun?: boolean } = {}) {
  const scriptEnv = {
    ...process.env,
    ...env,
  };
  if (options.dryRun ?? true) {
    scriptEnv.OMP_LAB_DRY_RUN = "1";
  } else {
    delete scriptEnv.OMP_LAB_DRY_RUN;
  }

  const result = await execFileAsync("/bin/bash", [join(repoRoot, "scripts", "clean-omp-lab.sh"), ...args], {
    cwd: repoRoot,
    env: scriptEnv,
  });
  return result.stdout;
}

test("cleanup dry run removes disposable workspaces and labeled docker artifacts", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));

  try {
    const output = await runCleanScript([], { HOME: fakeHome });

    assert.match(output, new RegExp(`rm -rf ${fakeHome}/\\.oh-my-pi-lab/control-workspace`));
    assert.match(output, new RegExp(`rm -rf ${fakeHome}/\\.oh-my-pi-lab/skilled-workspace`));
    assert.match(output, /docker ps -aq --filter label=checkpoint\.omp-lab=true/);
    assert.match(output, /docker volume ls -q --filter label=checkpoint\.omp-lab=true/);
    assert.doesNotMatch(output, /docker image rm checkpoint-omp-lab:local/);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});

test("cleanup image flag includes shared image removal", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));

  try {
    const output = await runCleanScript(["--image"], { HOME: fakeHome });
    assert.match(output, /docker image rm checkpoint-omp-lab:local/);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});

test("cleanup refuses dangerous workspace override paths before printing removals", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));
  const outsideWorkspace = await mkdtemp(join(tmpdir(), "checkpoint-omp-outside-"));
  const dangerousCases: Array<Record<string, string>> = [
    { OMP_LAB_CONTROL_WORKSPACE: "" },
    { OMP_LAB_CONTROL_WORKSPACE: "/" },
    { OMP_LAB_CONTROL_WORKSPACE: fakeHome },
    { OMP_LAB_CONTROL_WORKSPACE: repoRoot },
    { OMP_LAB_CONTROL_WORKSPACE: outsideWorkspace },
    { OMP_LAB_SKILLED_WORKSPACE: "" },
    { OMP_LAB_SKILLED_WORKSPACE: "/" },
    { OMP_LAB_SKILLED_WORKSPACE: fakeHome },
    { OMP_LAB_SKILLED_WORKSPACE: repoRoot },
    { OMP_LAB_SKILLED_WORKSPACE: outsideWorkspace },
  ];

  try {
    for (const env of dangerousCases) {
      let error: Error & { code?: number; stdout?: string; stderr?: string };
      try {
        await runCleanScript([], { HOME: fakeHome, ...env });
        assert.fail("cleanup should reject dangerous workspace paths");
      } catch (caught) {
        error = caught as Error & { code?: number; stdout?: string; stderr?: string };
      }

      assert.equal(error.code, 2);
      assert.doesNotMatch(error.stdout ?? "", /rm -rf/);
      assert.match(error.stderr ?? "", /Refusing to remove unsafe workspace path/);
    }
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(outsideWorkspace, { recursive: true, force: true });
  }
});

test("cleanup skips docker artifacts when docker is unavailable after workspace cleanup", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));
  const fakeBin = await mkdtemp(join(tmpdir(), "checkpoint-omp-bin-"));
  const controlWorkspace = join(fakeHome, ".oh-my-pi-lab", "control-workspace");
  const skilledWorkspace = join(fakeHome, ".oh-my-pi-lab", "skilled-workspace");

  try {
    await symlink("/usr/bin/dirname", join(fakeBin, "dirname"));
    await symlink("/usr/bin/realpath", join(fakeBin, "realpath"));
    await symlink("/usr/bin/rm", join(fakeBin, "rm"));
    await mkdir(controlWorkspace, { recursive: true });
    await mkdir(skilledWorkspace, { recursive: true });
    await writeFile(join(controlWorkspace, "marker"), "control\n");
    await writeFile(join(skilledWorkspace, "marker"), "skilled\n");

    const result = await execFileAsync("/bin/bash", [join(repoRoot, "scripts", "clean-omp-lab.sh")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: fakeHome,
        PATH: fakeBin,
      },
    });

    assert.equal(result.stdout, "");
    assert.match(result.stderr, /docker not found; skipping Docker artifact cleanup/);
    await assert.rejects(readFile(join(controlWorkspace, "marker"), "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(join(skilledWorkspace, "marker"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeBin, { recursive: true, force: true });
  }
});

test("cleanup image flag skips absent shared image", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));
  const fakeBin = await mkdtemp(join(tmpdir(), "checkpoint-omp-bin-"));
  const dockerLog = join(fakeHome, "docker.log");
  const fakeDocker = join(fakeBin, "docker");

  try {
    await writeFile(
      fakeDocker,
      [
        "#!/usr/bin/env bash",
        'printf "%s\\n" "$*" >> "${DOCKER_LOG}"',
        'if [[ "$1" == "image" && "$2" == "inspect" ]]; then',
        "  exit 1",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    await chmod(fakeDocker, 0o755);

    const result = await execFileAsync("/bin/bash", [join(repoRoot, "scripts", "clean-omp-lab.sh"), "--image"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: fakeHome,
        PATH: `${fakeBin}:${process.env.PATH}`,
        DOCKER_LOG: dockerLog,
      },
    });

    const dockerCalls = await readFile(dockerLog, "utf8");
    assert.match(dockerCalls, /image inspect checkpoint-omp-lab:local/);
    assert.doesNotMatch(dockerCalls, /image rm checkpoint-omp-lab:local/);
    assert.match(result.stderr, /Docker image checkpoint-omp-lab:local not found; skipping image removal/);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeBin, { recursive: true, force: true });
  }
});

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
    assert.ok(args.includes("GEMINI_API_KEY"));
    assert.ok(!args.includes("GEMINI_API_KEY=test-gemini-key"));
    assert.doesNotMatch(output, /test-gemini-key/);
    assert.ok(args.includes("OMP_MODEL=google/gemini-2.5-pro"));
    assert.ok(args.includes("PGHOST"));
    assert.ok(args.includes("PGPORT"));
    assert.ok(args.includes("PGDATABASE"));
    assert.ok(args.includes("PGUSER"));
    assert.ok(args.includes("PGPASSWORD"));
    assert.ok(args.includes("CLICKHOUSE_URL"));
    assert.ok(args.includes("CLICKHOUSE_HOST"));
    assert.ok(args.includes("CLICKHOUSE_PORT"));
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
    assert.ok(args.includes(`type=bind,source=${fakeWorkspace},target=/workspace`));
    assert.ok(args.includes("GEMINI_API_KEY"));
    assert.ok(!args.includes("GEMINI_API_KEY=test gemini key"));
    assert.doesNotMatch(output, /test gemini key/);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeParent, { recursive: true, force: true });
  }
});

test("control dry run does not expose database connection values", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));
  const fakeWorkspace = await mkdtemp(join(tmpdir(), "checkpoint-omp-control-"));

  try {
    const output = await runScript("run-omp-control-container.sh", {
      HOME: fakeHome,
      OMP_LAB_WORKSPACE: fakeWorkspace,
      PGPASSWORD: "secret db password",
      CLICKHOUSE_URL: "http://user:secret@host:8123",
    });
    const args = await parseDryRunArgs(output);

    assert.ok(args.includes("PGPASSWORD"));
    assert.ok(args.includes("CLICKHOUSE_URL"));
    assert.ok(!args.includes("PGPASSWORD=secret db password"));
    assert.ok(!args.includes("CLICKHOUSE_URL=http://user:secret@host:8123"));
    assert.doesNotMatch(output, /secret db password/);
    assert.doesNotMatch(output, /user:secret/);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeWorkspace, { recursive: true, force: true });
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
    assert.ok(args.includes("PGHOST"));
    assert.ok(args.includes("checkpoint.omp-lab.mode=skilled"));
    assert.ok(args.includes("checkpoint-omp-lab:local"));
    assert.ok(args.includes("--model"));
    assert.ok(args.includes("google/gemini-2.5-pro"));
    assert.ok(args.includes("GEMINI_API_KEY"));
    assert.ok(!args.includes("GEMINI_API_KEY=test-gemini-key"));
    assert.doesNotMatch(output, /test-gemini-key/);

    const extensionEntry = join(fakeWorkspace, ".omp", "extensions", "db-specialist.ts");
    assert.equal(await readFile(extensionEntry, "utf8"), 'export { default } from "/checkpoint-src/src/omp_extension/db_specialist_extension.ts";\n');
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeWorkspace, { recursive: true, force: true });
  }
});

test("skills dry run replaces stale generated OMP state", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));
  const fakeWorkspace = await mkdtemp(join(tmpdir(), "checkpoint-omp-skilled-"));
  const staleSkills = join(fakeWorkspace, ".omp", "skills");
  const staleTool = join(fakeWorkspace, ".omp", "tools", "stale-tool", "index.ts");
  const staleExtension = join(fakeWorkspace, ".omp", "extensions", "extra.ts");
  const extensionEntry = join(fakeWorkspace, ".omp", "extensions", "db-specialist.ts");

  try {
    await mkdir(join(fakeWorkspace, ".omp"), { recursive: true });
    await writeFile(staleSkills, "stale skills\n");
    await mkdir(join(fakeWorkspace, ".omp", "tools", "stale-tool"), { recursive: true });
    await mkdir(join(fakeWorkspace, ".omp", "extensions"), { recursive: true });
    await writeFile(staleTool, "export default {};\n");
    await writeFile(staleExtension, "export default {};\n");

    await runScript("run-omp-skilled-container.sh", {
      HOME: fakeHome,
      OMP_LAB_WORKSPACE: fakeWorkspace,
    });

    await assert.rejects(readFile(staleSkills, "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(staleTool, "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(staleExtension, "utf8"), { code: "ENOENT" });
    assert.equal(await readFile(extensionEntry, "utf8"), 'export { default } from "/checkpoint-src/src/omp_extension/db_specialist_extension.ts";\n');
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeWorkspace, { recursive: true, force: true });
  }
});
