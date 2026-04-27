# OMP Container Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two Docker-based OMP lab run modes that share the same workstation image and service wiring while keeping the control run source-blind.

**Architecture:** Replace the repo-copying standalone Dockerfile with a Dev Containers Universal lab image. Add one shared shell library that resolves secrets, disposable workspaces, database env, optional SSH mounts, and Docker arguments; then add separate control and skills scripts that call the shared library with different workspace/source mounts. Tests use a dry-run mode that prints the computed Docker command without starting the interactive TUI, plus cleanup dry runs that prove only lab-owned artifacts are targeted.

**Tech Stack:** Bash, Docker, Dev Containers Universal, Bun, npm, oh-my-pi, Node test runner, TypeScript.

---

## File Map

- `Dockerfile`: replace the current repo-copying image with the shared OMP lab workstation image. The image installs `omp`, the extension runtime npm dependencies, `gh`, DB clients, shell diagnostics, Bun, and container-local GitHub SSH host trust.
- `scripts/omp-lab-common.sh`: create a focused shell library for image names, workspace paths, model/key resolution, database env, optional SSH/GitHub auth arguments, and Docker command assembly.
- `scripts/run-omp-control-container.sh`: run the source-blind control container by mounting only a neutral workspace.
- `scripts/run-omp-skilled-container.sh`: run the skills-enabled container by preparing a generated `.omp` workspace and mounting only the repo paths required for skills and extension loading.
- `scripts/clean-omp-lab.sh`: remove lab-owned disposable workspaces, labeled containers, labeled volumes, and optionally the shared image.
- `test/scripts/omp_lab_scripts.test.ts`: exercise the dry-run command contracts for both runtime modes and the Dockerfile contract.
- `README.md`: document build/run commands, DB connectivity, Gemini key behavior, and opt-in Git SSH access.
- `JOURNAL.md`: record implementation decisions and any verification caveats.

## Task 1: Dockerfile Contract

**Files:**
- Modify: `Dockerfile`
- Create: `test/scripts/omp_lab_scripts.test.ts`

- [ ] **Step 1: Write the failing Dockerfile tests**

Create `test/scripts/omp_lab_scripts.test.ts` with the first contract tests:

```ts
// ABOUTME: Tests the Docker-based OMP lab scripts without launching interactive containers.
// ABOUTME: Verifies source isolation, optional credential mounts, and shared image contracts.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

test("lab Dockerfile uses the universal dev container base and does not copy the repo", async () => {
  const dockerfile = await readFile(join(repoRoot, "Dockerfile"), "utf8");

  assert.match(dockerfile, /^FROM mcr\.microsoft\.com\/devcontainers\/universal:2-linux/m);
  assert.match(dockerfile, /@oh-my-pi\/pi-coding-agent/);
  assert.match(dockerfile, /@sinclair\/typebox/);
  assert.match(dockerfile, /@oh-my-pi\/pi-ai/);
  assert.match(dockerfile, /\bgh\b/);
  assert.match(dockerfile, /postgresql-client/);
  assert.match(dockerfile, /IdentityFile ~\/\.ssh\/id_rsa/);
  assert.doesNotMatch(dockerfile, /^COPY \. \./m);
  assert.doesNotMatch(dockerfile, /^WORKDIR \/app$/m);
});
```

- [ ] **Step 2: Run the failing Dockerfile test**

Run:

```bash
npm test -- test/scripts/omp_lab_scripts.test.ts
```

Expected: FAIL because the existing Dockerfile starts from `node:22-bookworm`, copies the repo, and does not install the full lab toolchain.

- [ ] **Step 3: Replace the Dockerfile**

Replace `Dockerfile` with:

```dockerfile
# ABOUTME: Builds the shared workstation image for isolated oh-my-pi lab containers.
# ABOUTME: Installs OMP, database clients, GitHub tooling, and common diagnostics without copying this repo.
FROM mcr.microsoft.com/devcontainers/universal:2-linux

USER root

COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    default-mysql-client \
    direnv \
    fd-find \
    gh \
    git \
    htop \
    jq \
    mycli \
    netcat-openbsd \
    openssh-client \
    pgcli \
    pkg-config \
    postgresql-client \
    python3 \
    python3-pip \
    pipx \
    ripgrep \
    sqlite3 \
    tmux \
    tree \
    wget \
  && rm -rf /var/lib/apt/lists/*

RUN bun install -g @oh-my-pi/pi-coding-agent

RUN mkdir -p /checkpoint-src \
  && cd /checkpoint-src \
  && npm init -y \
  && npm install \
    @oh-my-pi/pi-ai@^14.1.2 \
    @sinclair/typebox@^0.34.49 \
    pg@^8.20.0

RUN mkdir -p /etc/ssh/ssh_known_hosts.d \
  && ssh-keyscan github.com > /etc/ssh/ssh_known_hosts

RUN mkdir -p /home/codespace/.ssh \
  && printf 'Host github.com\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/id_rsa\n  IdentitiesOnly yes\n' > /home/codespace/.ssh/config \
  && chown -R codespace:codespace /home/codespace/.ssh \
  && chmod 700 /home/codespace/.ssh \
  && chmod 600 /home/codespace/.ssh/config

WORKDIR /workspace

USER codespace

ENTRYPOINT ["omp"]
```

- [ ] **Step 4: Run the Dockerfile test**

Run:

```bash
npm test -- test/scripts/omp_lab_scripts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add Dockerfile test/scripts/omp_lab_scripts.test.ts
git commit -m "test: define omp lab image contract"
```

## Task 2: Shared Lab Script Library

**Files:**
- Create: `scripts/omp-lab-common.sh`
- Modify: `test/scripts/omp_lab_scripts.test.ts`

- [ ] **Step 1: Add failing dry-run tests for shared command contracts**

Update the import block in `test/scripts/omp_lab_scripts.test.ts` so the file starts with these imports, then append the helper and test after the Dockerfile test:

```ts
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const repoRoot = process.cwd();
const execFileAsync = promisify(execFile);

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
    assert.match(output, /--env GEMINI_API_KEY/);
    assert.match(output, /--env OMP_MODEL=google\/gemini-2\.5-pro/);
    assert.match(output, /--env PGHOST/);
    assert.match(output, /--env CLICKHOUSE_URL/);
    assert.doesNotMatch(output, new RegExp(repoRoot));
    assert.doesNotMatch(output, /\.ssh/);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeWorkspace, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the failing dry-run test**

Run:

```bash
npm test -- test/scripts/omp_lab_scripts.test.ts
```

Expected: FAIL because the run scripts and common library do not exist.

- [ ] **Step 3: Create the shared library**

Create `scripts/omp-lab-common.sh`:

```bash
#!/usr/bin/env bash
# ABOUTME: Provides shared Docker argument construction for OMP lab run scripts.
# ABOUTME: Resolves lab workspaces, model credentials, database env, and optional Git credentials.

set -euo pipefail

OMP_LAB_IMAGE="${OMP_LAB_IMAGE:-checkpoint-omp-lab:local}"
OMP_LAB_CONTAINER_USER="${OMP_LAB_CONTAINER_USER:-codespace}"
OMP_LAB_CONTAINER_HOME="/home/${OMP_LAB_CONTAINER_USER}"

export_gemini_api_key() {
  if [[ -n "${GEMINI_API_KEY:-}" ]]; then
    export GEMINI_API_KEY
    return
  fi

  local key_path="${HOME}/.gemini-key"
  if [[ ! -f "${key_path}" ]]; then
    printf 'GEMINI_API_KEY is unset and %s does not exist\n' "${key_path}" >&2
    return 1
  fi

  GEMINI_API_KEY="$(tr -d '\n' < "${key_path}")"
  export GEMINI_API_KEY
}

require_omp_model() {
  if [[ -z "${OMP_MODEL:-}" ]]; then
    printf 'OMP_MODEL must be set, for example google/gemini-2.5-pro\n' >&2
    return 1
  fi
}

ensure_workspace() {
  local workspace="$1"
  mkdir -p "${workspace}"
}

append_base_docker_args() {
  local -n args_ref="$1"
  local workspace="$2"
  args_ref+=(
    docker run --rm -it
    --name "${OMP_LAB_CONTAINER_NAME:-oh-my-pi-lab}"
    --label checkpoint.omp-lab=true
    --add-host host.docker.internal:host-gateway
    --mount "type=bind,source=${workspace},target=/workspace"
    --env GEMINI_API_KEY
    --env "OMP_MODEL=${OMP_MODEL}"
    --env PGHOST
    --env PGPORT
    --env PGDATABASE
    --env PGUSER
    --env PGPASSWORD
    --env CLICKHOUSE_URL
    --env CLICKHOUSE_HOST
    --env CLICKHOUSE_PORT
  )

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    args_ref+=(--env GITHUB_TOKEN)
  fi
}

append_git_ssh_args() {
  local -n args_ref="$1"

  if [[ "${OMP_LAB_ENABLE_SSH:-0}" != "1" ]]; then
    return
  fi

  local ssh_key="${OMP_LAB_SSH_KEY:-${HOME}/.ssh/id_rsa}"
  if [[ ! -f "${ssh_key}" ]]; then
    printf 'OMP_LAB_ENABLE_SSH=1 but SSH key %s does not exist\n' "${ssh_key}" >&2
    return 1
  fi

  args_ref+=(
    --mount "type=bind,source=${ssh_key},target=${OMP_LAB_CONTAINER_HOME}/.ssh/id_rsa,readonly"
  )
}

finish_docker_args() {
  local -n args_ref="$1"
  args_ref+=("${OMP_LAB_IMAGE}" --model "${OMP_MODEL}")
}

run_or_print_docker_args() {
  local -n args_ref="$1"

  if [[ "${OMP_LAB_DRY_RUN:-0}" == "1" ]]; then
    printf '%q ' "${args_ref[@]}"
    printf '\n'
    return
  fi

  exec "${args_ref[@]}"
}
```

- [ ] **Step 4: Add the minimal control script**

Create `scripts/run-omp-control-container.sh`:

```bash
#!/usr/bin/env bash
# ABOUTME: Runs the source-blind OMP control lab container.
# ABOUTME: Mounts only a neutral workspace while sharing model and database connectivity.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/omp-lab-common.sh"

require_omp_model
export_gemini_api_key
WORKSPACE="${OMP_LAB_WORKSPACE:-${HOME}/.oh-my-pi-lab/control-workspace}"
ensure_workspace "${WORKSPACE}"
if [[ "${OMP_LAB_RESET_WORKSPACE:-0}" == "1" ]]; then
  rm -rf "${WORKSPACE}"
  ensure_workspace "${WORKSPACE}"
fi

docker_args=()
append_base_docker_args docker_args "${WORKSPACE}"
docker_args+=(--label checkpoint.omp-lab.mode=control)
append_git_ssh_args docker_args
finish_docker_args docker_args
run_or_print_docker_args docker_args
```

- [ ] **Step 5: Make scripts executable and run the test**

Run:

```bash
chmod +x scripts/omp-lab-common.sh scripts/run-omp-control-container.sh
npm test -- test/scripts/omp_lab_scripts.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add scripts/omp-lab-common.sh scripts/run-omp-control-container.sh test/scripts/omp_lab_scripts.test.ts
git commit -m "feat: add omp control lab runner"
```

## Task 3: Optional SSH And GitHub Auth Contract

**Files:**
- Modify: `scripts/omp-lab-common.sh`
- Modify: `test/scripts/omp_lab_scripts.test.ts`

- [ ] **Step 1: Add failing SSH dry-run tests**

Append to `test/scripts/omp_lab_scripts.test.ts`:

```ts
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

    assert.match(output, new RegExp(`source=${fakeKey},target=/home/codespace/\\.ssh/id_rsa,readonly`));
    assert.match(output, /--env GITHUB_TOKEN/);
    assert.doesNotMatch(output, new RegExp(`source=${fakeSshDir},`));
    assert.doesNotMatch(output, /\.gitconfig/);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeWorkspace, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the SSH test**

Run:

```bash
npm test -- test/scripts/omp_lab_scripts.test.ts
```

Expected: PASS if Task 2 already implemented the optional SSH path; otherwise FAIL and continue to Step 3.

- [ ] **Step 3: Tighten SSH setup if needed**

If the test failed, adjust `append_git_ssh_args()` in `scripts/omp-lab-common.sh` so it exactly appends:

```bash
args_ref+=(
  --mount "type=bind,source=${ssh_key},target=${OMP_LAB_CONTAINER_HOME}/.ssh/id_rsa,readonly"
)
```

Keep `GITHUB_TOKEN` forwarding inside `append_base_docker_args()` and only append it when the host environment provides it.

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- test/scripts/omp_lab_scripts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add scripts/omp-lab-common.sh test/scripts/omp_lab_scripts.test.ts
git commit -m "feat: add opt-in git credentials to omp lab"
```

## Task 4: Skills-Enabled Runner

**Files:**
- Create: `scripts/run-omp-skilled-container.sh`
- Modify: `test/scripts/omp_lab_scripts.test.ts`

- [ ] **Step 1: Add failing skills runner test**

Append to `test/scripts/omp_lab_scripts.test.ts`:

```ts
test("skills dry run mounts generated workspace plus checkpoint skill and extension sources", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));
  const fakeWorkspace = await mkdtemp(join(tmpdir(), "checkpoint-omp-skilled-"));

  try {
    const output = await runScript("run-omp-skilled-container.sh", {
      HOME: fakeHome,
      OMP_LAB_WORKSPACE: fakeWorkspace,
    });

    assert.match(output, new RegExp(`--mount type=bind,source=${fakeWorkspace},target=/workspace`));
    assert.match(output, new RegExp(`source=${repoRoot}/skills,target=/workspace/.omp/skills,readonly`));
    assert.match(output, new RegExp(`source=${repoRoot}/src,target=/checkpoint-src/src,readonly`));
    assert.match(output, /--env CHECKPOINT_EXTENSION_SOURCE=\/checkpoint-src\/src\/omp_extension\/db_specialist_extension\.ts/);
    assert.match(output, /--env PGHOST/);
    assert.match(output, /checkpoint-omp-lab:local --model google\/gemini-2\.5-pro/);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeWorkspace, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the failing skills runner test**

Run:

```bash
npm test -- test/scripts/omp_lab_scripts.test.ts
```

Expected: FAIL because `scripts/run-omp-skilled-container.sh` does not exist.

- [ ] **Step 3: Create the skills runner**

Create `scripts/run-omp-skilled-container.sh`:

```bash
#!/usr/bin/env bash
# ABOUTME: Runs the OMP lab container with checkpoint skills and extension sources mounted.
# ABOUTME: Keeps the editable workspace separate from read-only checkpoint runtime mounts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/omp-lab-common.sh"

require_omp_model
export_gemini_api_key
WORKSPACE="${OMP_LAB_WORKSPACE:-${HOME}/.oh-my-pi-lab/skilled-workspace}"
ensure_workspace "${WORKSPACE}"
if [[ "${OMP_LAB_RESET_WORKSPACE:-0}" == "1" ]]; then
  rm -rf "${WORKSPACE}"
  ensure_workspace "${WORKSPACE}"
fi
mkdir -p "${WORKSPACE}/.omp/extensions"

cat > "${WORKSPACE}/.omp/extensions/db-specialist.ts" <<'ENTRYPOINT'
export { default } from "/checkpoint-src/src/omp_extension/db_specialist_extension.ts";
ENTRYPOINT

docker_args=()
append_base_docker_args docker_args "${WORKSPACE}"
docker_args+=(
  --label checkpoint.omp-lab.mode=skilled
  --mount "type=bind,source=${REPO_ROOT}/skills,target=/workspace/.omp/skills,readonly"
  --mount "type=bind,source=${REPO_ROOT}/src,target=/checkpoint-src/src,readonly"
  --env "CHECKPOINT_EXTENSION_SOURCE=/checkpoint-src/src/omp_extension/db_specialist_extension.ts"
)
append_git_ssh_args docker_args
finish_docker_args docker_args
run_or_print_docker_args docker_args
```

- [ ] **Step 4: Make script executable and run tests**

Run:

```bash
chmod +x scripts/run-omp-skilled-container.sh
npm test -- test/scripts/omp_lab_scripts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add scripts/run-omp-skilled-container.sh test/scripts/omp_lab_scripts.test.ts
git commit -m "feat: add omp skilled lab runner"
```

## Task 5: Cleanup Runner

**Files:**
- Create: `scripts/clean-omp-lab.sh`
- Modify: `test/scripts/omp_lab_scripts.test.ts`

- [ ] **Step 1: Add failing cleanup dry-run tests**

Append to `test/scripts/omp_lab_scripts.test.ts`:

```ts
test("cleanup dry run removes disposable workspaces and labeled docker artifacts", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));

  try {
    const result = await execFileAsync("bash", [join(repoRoot, "scripts", "clean-omp-lab.sh")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: fakeHome,
        OMP_LAB_DRY_RUN: "1",
      },
    });

    assert.match(result.stdout, new RegExp(`rm -rf ${fakeHome}/\\.oh-my-pi-lab/control-workspace`));
    assert.match(result.stdout, new RegExp(`rm -rf ${fakeHome}/\\.oh-my-pi-lab/skilled-workspace`));
    assert.match(result.stdout, /docker ps -aq --filter label=checkpoint\.omp-lab=true/);
    assert.match(result.stdout, /docker volume ls -q --filter label=checkpoint\.omp-lab=true/);
    assert.doesNotMatch(result.stdout, /docker image rm checkpoint-omp-lab:local/);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});

test("cleanup image flag includes shared image removal", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));

  try {
    const result = await execFileAsync("bash", [join(repoRoot, "scripts", "clean-omp-lab.sh"), "--image"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: fakeHome,
        OMP_LAB_DRY_RUN: "1",
      },
    });

    assert.match(result.stdout, /docker image rm checkpoint-omp-lab:local/);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the failing cleanup tests**

Run:

```bash
npm test -- test/scripts/omp_lab_scripts.test.ts
```

Expected: FAIL because `scripts/clean-omp-lab.sh` does not exist.

- [ ] **Step 3: Create the cleanup script**

Create `scripts/clean-omp-lab.sh`:

```bash
#!/usr/bin/env bash
# ABOUTME: Removes disposable OMP lab workspaces and labeled Docker artifacts.
# ABOUTME: Keeps image removal explicit so routine cleanup stays fast.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/omp-lab-common.sh"

REMOVE_IMAGE=0
for arg in "$@"; do
  case "${arg}" in
    --image)
      REMOVE_IMAGE=1
      ;;
    *)
      printf 'Unknown option: %s\n' "${arg}" >&2
      exit 2
      ;;
  esac
done

CONTROL_WORKSPACE="${OMP_LAB_CONTROL_WORKSPACE:-${HOME}/.oh-my-pi-lab/control-workspace}"
SKILLED_WORKSPACE="${OMP_LAB_SKILLED_WORKSPACE:-${HOME}/.oh-my-pi-lab/skilled-workspace}"

run_cleanup_command() {
  if [[ "${OMP_LAB_DRY_RUN:-0}" == "1" ]]; then
    printf '%q ' "$@"
    printf '\n'
    return
  fi

  "$@"
}

run_cleanup_command rm -rf "${CONTROL_WORKSPACE}"
run_cleanup_command rm -rf "${SKILLED_WORKSPACE}"

if [[ "${OMP_LAB_DRY_RUN:-0}" == "1" ]]; then
  printf '%s\n' 'docker ps -aq --filter label=checkpoint.omp-lab=true | xargs -r docker rm -f'
  printf '%s\n' 'docker volume ls -q --filter label=checkpoint.omp-lab=true | xargs -r docker volume rm'
else
  docker ps -aq --filter label=checkpoint.omp-lab=true | xargs -r docker rm -f
  docker volume ls -q --filter label=checkpoint.omp-lab=true | xargs -r docker volume rm
fi

if [[ "${REMOVE_IMAGE}" == "1" ]]; then
  run_cleanup_command docker image rm "${OMP_LAB_IMAGE}"
fi
```

- [ ] **Step 4: Make script executable and run tests**

Run:

```bash
chmod +x scripts/clean-omp-lab.sh
npm test -- test/scripts/omp_lab_scripts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add scripts/clean-omp-lab.sh test/scripts/omp_lab_scripts.test.ts scripts/omp-lab-common.sh scripts/run-omp-control-container.sh scripts/run-omp-skilled-container.sh
git commit -m "feat: add omp lab cleanup"
```

## Task 6: Script Ergonomics And Documentation

**Files:**
- Modify: `scripts/omp-lab-common.sh`
- Modify: `README.md`
- Modify: `JOURNAL.md`
- Modify: `test/scripts/omp_lab_scripts.test.ts`

- [ ] **Step 1: Add failing tests for key-file fallback, missing SSH key, and workspace reset**

Append to `test/scripts/omp_lab_scripts.test.ts`:

```ts
test("control script reads Gemini key from home key file when env is unset", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));
  const fakeWorkspace = await mkdtemp(join(tmpdir(), "checkpoint-omp-control-"));

  try {
    await writeFile(join(fakeHome, ".gemini-key"), "file-gemini-key\n");

    const result = await execFileAsync("bash", [join(repoRoot, "scripts", "run-omp-control-container.sh")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: fakeHome,
        OMP_LAB_WORKSPACE: fakeWorkspace,
        OMP_LAB_DRY_RUN: "1",
        OMP_MODEL: "google/gemini-2.5-pro",
        GEMINI_API_KEY: "",
      },
    });

    assert.match(result.stdout, /--env GEMINI_API_KEY/);
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeWorkspace, { recursive: true, force: true });
  }
});

test("SSH mode fails before docker run when id_rsa is missing", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));
  const fakeWorkspace = await mkdtemp(join(tmpdir(), "checkpoint-omp-control-"));

  try {
    await assert.rejects(
      () => runScript("run-omp-control-container.sh", {
        HOME: fakeHome,
        OMP_LAB_WORKSPACE: fakeWorkspace,
        OMP_LAB_ENABLE_SSH: "1",
      }),
      /SSH key .* does not exist/,
    );
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeWorkspace, { recursive: true, force: true });
  }
});

test("control reset mode clears existing workspace contents before dry run", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-omp-home-"));
  const fakeWorkspace = await mkdtemp(join(tmpdir(), "checkpoint-omp-control-"));
  const staleFile = join(fakeWorkspace, "stale.txt");

  try {
    await writeFile(staleFile, "stale\n");

    await runScript("run-omp-control-container.sh", {
      HOME: fakeHome,
      OMP_LAB_WORKSPACE: fakeWorkspace,
      OMP_LAB_RESET_WORKSPACE: "1",
    });

    await assert.rejects(() => readFile(staleFile, "utf8"));
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(fakeWorkspace, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests**

Run:

```bash
npm test -- test/scripts/omp_lab_scripts.test.ts
```

Expected: PASS if previous tasks already cover the behavior. If they fail, fix only the failing helper behavior in the relevant script.

- [ ] **Step 3: Update README**

Add this section after `## Manual TUI Loop` in `README.md`:

````markdown
## Docker Lab Runs

Build the shared OMP lab image:

```bash
docker build -t checkpoint-omp-lab:local .
```

Run the source-blind control container:

```bash
OMP_MODEL=google/gemini-2.5-pro \
GEMINI_API_KEY="$(cat ~/.gemini-key)" \
bash scripts/run-omp-control-container.sh
```

Run the checkpoint skills-enabled container:

```bash
OMP_MODEL=google/gemini-2.5-pro \
GEMINI_API_KEY="$(cat ~/.gemini-key)" \
bash scripts/run-omp-skilled-container.sh
```

Both scripts connect to the host checkpoint compose stack through
`host.docker.internal`, so start the stack before asking the agent to inspect
Postgres or ClickHouse.

Lab workspaces are disposable. Start a run from a clean workspace with:

```bash
OMP_MODEL=google/gemini-2.5-pro \
GEMINI_API_KEY="$(cat ~/.gemini-key)" \
OMP_LAB_RESET_WORKSPACE=1 \
bash scripts/run-omp-control-container.sh
```

Remove lab workspaces, labeled lab containers, and labeled lab volumes:

```bash
bash scripts/clean-omp-lab.sh
```

Also remove the shared image:

```bash
bash scripts/clean-omp-lab.sh --image
```

Git SSH access is off by default. Enable it only for runs that need private
repo access:

```bash
OMP_MODEL=google/gemini-2.5-pro \
GEMINI_API_KEY="$(cat ~/.gemini-key)" \
OMP_LAB_ENABLE_SSH=1 \
bash scripts/run-omp-control-container.sh
```

That option mounts `~/.ssh/id_rsa` read-only. It does not mount the host
`.ssh` directory or git config. Set `GITHUB_TOKEN` when the agent needs `gh`
API access.
````

- [ ] **Step 4: Add journal entry**

Add a dated entry to the top of `JOURNAL.md`:

```markdown
- 2026-04-26: Implemented the OMP lab container runners with a shared Docker image, dry-run-tested command construction, source-blind control mode, checkpoint skills mode, disposable workspace reset, cleanup tooling, and opt-in read-only `id_rsa` mounting. The scripts pass `GITHUB_TOKEN` only when present; `gh` API auth still requires Brett to provide that token explicitly.
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- test/scripts/omp_lab_scripts.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add README.md JOURNAL.md scripts/omp-lab-common.sh test/scripts/omp_lab_scripts.test.ts
git commit -m "docs: document omp lab containers"
```

## Task 7: Full Verification

**Files:**
- No planned source changes unless verification exposes a real issue.

- [ ] **Step 1: Run the full local test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Validate dry-run output manually**

Run:

```bash
OMP_LAB_DRY_RUN=1 \
OMP_MODEL=google/gemini-2.5-pro \
GEMINI_API_KEY=test-key \
bash scripts/run-omp-control-container.sh
```

Expected: Output contains one `docker run` command with `/workspace`, host gateway mapping, DB env, and no `/home/bjw/checkpoint` mount.

Run:

```bash
OMP_LAB_DRY_RUN=1 \
OMP_MODEL=google/gemini-2.5-pro \
GEMINI_API_KEY=test-key \
bash scripts/run-omp-skilled-container.sh
```

Expected: Output contains one `docker run` command with `/workspace`, read-only `skills` and `src` mounts, host gateway mapping, and the shared image.

Run:

```bash
OMP_LAB_DRY_RUN=1 bash scripts/clean-omp-lab.sh --image
```

Expected: Output contains removal commands for both default workspaces, labeled lab containers, labeled lab volumes, and `checkpoint-omp-lab:local`.

- [ ] **Step 4: Build the lab image if Docker is available**

Run:

```bash
docker build -t checkpoint-omp-lab:local .
```

Expected: PASS. If Docker is unavailable in the current environment, record that image build verification was not run.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required changes, commit them:

```bash
git add <changed-files>
git commit -m "fix: stabilize omp lab verification"
```

If no files changed, do not create an empty commit.
