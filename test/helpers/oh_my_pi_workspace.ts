// ABOUTME: Helps integration tests create the generated oh-my-pi workspace and run live prompts in it.
// ABOUTME: Keeps the shell interactions for setup, reset, and prompt execution in one small place.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function getWorkspaceRoot(home: string): string {
  return join(home, ".oh-my-pi-workspaces", "checkpoint");
}

export async function setupWorkspace(home: string): Promise<void> {
  await runWorkspaceScript(home, "scripts/setup-oh-my-pi-workspace.sh");
}

export async function resetWorkspace(home: string): Promise<void> {
  await runWorkspaceScript(home, "scripts/reset-oh-my-pi-workspace.sh");
}

export async function runWorkspacePrompt(input: {
  home: string;
  model: string;
  prompt: string;
}): Promise<string> {
  const workspaceRoot = getWorkspaceRoot(input.home);
  const command = process.env.OH_MY_PI_COMMAND ?? "omp";

  try {
    const { stdout } = await execFileAsync(
      "bash",
      [
        "-lc",
        `${command} --print --no-session --model "$OMP_MODEL" "$OMP_PROMPT"`,
      ],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          HOME: input.home,
          OMP_MODEL: input.model,
          OMP_PROMPT: input.prompt,
        },
      },
    );

    return stdout;
  } catch (error) {
    const message =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : error instanceof Error
          ? error.message
          : String(error);

    throw new Error(
      `Failed to run the oh-my-pi session. Set OH_MY_PI_COMMAND if the runtime is not available as "omp". ${message}`.trim(),
    );
  }
}

async function runWorkspaceScript(home: string, scriptPath: string): Promise<void> {
  await execFileAsync("bash", [scriptPath], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
  });
}
