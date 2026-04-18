// ABOUTME: Helps integration tests create the generated oh-my-pi workspace and run live prompts in it.
// ABOUTME: Uses the oh-my-pi SDK to inject the repo's SQL tools into a real generated workspace session.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { Type } from "@sinclair/typebox";

import { parseQueryCheckResult } from "../../src/omp_tools/live_query_checker.ts";
import { createClickHouseToolDefinitions } from "../../src/omp_tools/clickhouse_custom_tools.ts";
import { createPostgresToolDefinitions } from "../../src/omp_tools/postgres_custom_tools.ts";
import type { SdkToolDefinition, ToolContext, ToolModel } from "../../src/omp_tools/runtime.ts";
import type { QueryCheckInput, QueryCheckResult } from "../../src/tools/shared/query_checker.ts";

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

export async function runWorkspaceSession(input: {
  home: string;
  model: string;
  prompt: string;
}): Promise<string> {
  const { session } = await createWorkspaceSession(input.home, input.model);

  try {
    return await collectAssistantText(session, input.prompt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to run the oh-my-pi SDK session. ${message}`.trim());
  } finally {
    await session.dispose();
  }
}

export async function runWorkspaceChecker(input: {
  home: string;
  model: string;
  toolName: "sql_db_checker" | "clickhouse_db_checker";
  input: QueryCheckInput;
}): Promise<QueryCheckResult> {
  const { session, sqlTools } = await createWorkspaceSession(input.home, input.model);
  const checkerTool = sqlTools.find((tool) => tool.name === input.toolName);

  if (!checkerTool) {
    throw new Error(`Missing checker tool definition: ${input.toolName}`);
  }

  try {
    const result = await checkerTool.execute(
      "checker-test-call",
      input.input,
      undefined,
      undefined,
      {
        model: session.model,
        modelRegistry: session.modelRegistry,
        sessionManager: session.sessionManager,
      },
    );
    return parseQueryCheckResult(extractAssistantText(result.content));
  } finally {
    await session.dispose();
  }
}

async function runWorkspaceScript(home: string, scriptPath: string): Promise<void> {
  await execFileAsync("bash", [scriptPath], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
  });
}

async function createWorkspaceSession(home: string, model: string): Promise<{
  session: WorkspaceSession;
  sqlTools: Array<SdkToolDefinition>;
}> {
  const sdkModuleName = "@oh-my-pi/pi-coding-agent";
  const { createAgentSession, SessionManager } = await import(sdkModuleName);
  const workspaceRoot = getWorkspaceRoot(home);
  const agentDir = join(home, ".omp", "agent");
  const sqlTools = createSqlToolDefinitions();
  const { session } = await createAgentSession({
    agentDir,
    contextFiles: [],
    cwd: workspaceRoot,
    customTools: sqlTools,
    disableExtensionDiscovery: true,
    enableLsp: false,
    enableMCP: false,
    hasUI: false,
    modelPattern: model,
    promptTemplates: [],
    sessionManager: SessionManager.inMemory(),
    skills: [],
    slashCommands: [],
    toolNames: ["__none__"],
  });

  return {
    session: session as WorkspaceSession,
    sqlTools,
  };
}

function createSqlToolDefinitions(): Array<SdkToolDefinition> {
  return [
    ...createPostgresToolDefinitions(Type),
    ...createClickHouseToolDefinitions(Type),
  ];
}

async function collectAssistantText(
  session: SessionLike,
  prompt: string,
): Promise<string> {
  const messages: Array<string> = [];
  const unsubscribe = session.subscribe((event: SessionEvent) => {
    if (event.type !== "message_end" || event.message.role !== "assistant") {
      return;
    }

    const text = extractAssistantText(event.message.content);
    if (text) {
      messages.push(text);
    }
  });

  try {
    await session.prompt(prompt, { expandPromptTemplates: false });
    return messages.join("\n").trim();
  } finally {
    unsubscribe();
  }
}

type SessionLike = {
  dispose(): Promise<void>;
  prompt(text: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
  subscribe(listener: (event: SessionEvent) => void): () => void;
};

type WorkspaceSession = SessionLike & {
  model: ToolModel | undefined;
  modelRegistry: ToolContext["modelRegistry"];
  sessionManager: ToolContext["sessionManager"];
};

type SessionEvent = {
  type: string;
  message: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  };
};

export function extractAssistantText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") {
    return content.trim();
  }

  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}

export { parseQueryCheckResult };
