// ABOUTME: Routes agent test-runner arguments to Node's built-in test command.
// ABOUTME: Preserves default globs for option-only invocations and exact scoping for file targets.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const agentRoot = fileURLToPath(new URL("..", import.meta.url));

export function buildTestCommand(args) {
  if (args.length === 0) {
    return getDefaultTestFiles();
  }

  if (containsFileTarget(args)) {
    return [...args];
  }

  return [...args, ...getDefaultTestFiles()];
}

export function getDefaultTestFiles() {
  return [
    ...listTestFiles("test"),
    ...listTestFiles("test/integration"),
  ];
}

function containsFileTarget(args) {
  const valueOptions = new Set([
    "--test-name-pattern",
    "--test-reporter",
    "--test-reporter-destination",
    "--test-concurrency",
    "--test-shard",
  ]);
  let skipNext = false;

  for (const arg of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (arg === "--") {
      return args.length > 1;
    }

    if (valueOptions.has(arg)) {
      skipNext = true;
      continue;
    }

    if (arg.startsWith("--test-name-pattern=")) {
      continue;
    }

    if (arg.startsWith("--test-reporter=")) {
      continue;
    }

    if (arg.startsWith("--test-reporter-destination=")) {
      continue;
    }

    if (arg.startsWith("-")) {
      continue;
    }

    return true;
  }

  return false;
}

function listTestFiles(relativeDir) {
  return readdirSync(join(agentRoot, relativeDir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => join(relativeDir, entry.name))
    .sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const testArgs = buildTestCommand(process.argv.slice(2));
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", ...testArgs],
    {
      cwd: agentRoot,
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
}
