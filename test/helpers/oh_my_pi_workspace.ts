// ABOUTME: Helps integration tests create the generated oh-my-pi workspace and run live prompts in it.
// ABOUTME: Uses the oh-my-pi SDK to inject the repo's SQL tools into a real generated workspace session.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { extractAssistantText, parseQueryCheckResult } from "../../src/omp_tools/live_query_checker.ts";
import type { ToolContext, ToolModel } from "../../src/omp_tools/runtime.ts";
import type { QueryCheckInput, QueryCheckResult } from "../../src/tools/shared/query_checker.ts";

const execFileAsync = promisify(execFile);

export function getWorkspaceRoot(home: string): string {
  return join(home, ".oh-my-pi-workspaces", "checkpoint");
}

export function getWorkspaceExtensionPath(home: string): string {
  return join(getWorkspaceRoot(home), ".omp", "extensions", "db-specialist.ts");
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

export async function getWorkspaceToolNames(input: {
  home: string;
  model: string;
}): Promise<Array<string>> {
  const { session } = await createWorkspaceSession(input.home, input.model);

  try {
    return session.getAllToolNames();
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
  const { session } = await createWorkspaceSession(input.home, input.model);
  const checkerTool = await getWorkspaceRegisteredTool(input.home, input.toolName);
  const resolvedModel = session.model ?? resolveRequestedModel(session.modelRegistry, input.model);

  if (!checkerTool) {
    throw new Error(`Missing checker tool definition: ${input.toolName}`);
  }
  if (!resolvedModel) {
    throw new Error(`Missing active model for checker tool: ${input.model}`);
  }

  try {
    const result = await checkerTool.execute(
      "checker-test-call",
      input.input,
      undefined,
      undefined,
      {
        model: resolvedModel,
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
}> {
  const sdkModuleName = "@oh-my-pi/pi-coding-agent";
  const {
    createAgentSession,
    SessionManager,
    ModelRegistry,
    discoverAuthStorage,
  } = await import(sdkModuleName);
  const workspaceRoot = getWorkspaceRoot(home);
  const agentDir = join(home, ".omp", "agent");
  const extensionPath = getWorkspaceExtensionPath(home);
  await validateWorkspaceExtension(home);
  const authStorage = await discoverAuthStorage(agentDir);
  const modelRegistry = new ModelRegistry(authStorage);
  await modelRegistry.refresh();
  const resolvedModel = resolveRequestedModel(modelRegistry, model);

  if (!resolvedModel) {
    throw new Error(`Could not resolve requested model: ${model}`);
  }

  const { session } = await createAgentSession({
    agentDir,
    authStorage,
    contextFiles: [],
    cwd: workspaceRoot,
    additionalExtensionPaths: [extensionPath],
    disableExtensionDiscovery: true,
    enableLsp: false,
    enableMCP: false,
    hasUI: false,
    model: resolvedModel,
    modelRegistry,
    promptTemplates: [],
    sessionManager: SessionManager.inMemory(),
    skills: [],
    slashCommands: [],
    toolNames: ["__none__"],
  });

  return {
    session: session as WorkspaceSession,
  };
}

function resolveRequestedModel(
  modelRegistry: WorkspaceSession["modelRegistry"],
  modelPattern: string,
): ToolModel | undefined {
  const [provider, ...idParts] = modelPattern.split("/");
  const modelId = idParts.join("/");
  if (!provider || !modelId) {
    return undefined;
  }

  return modelRegistry.find(provider, modelId) as ToolModel | undefined;
}

async function loadWorkspaceExtension(extensionPath: string): Promise<void> {
  const extensionModule = await import(pathToFileURL(extensionPath).href);

  if (typeof extensionModule.default !== "function") {
    throw new Error(`Workspace extension must export a factory function: ${extensionPath}`);
  }
}

export async function validateWorkspaceExtension(home: string): Promise<void> {
  await loadWorkspaceExtension(getWorkspaceExtensionPath(home));
}

async function getWorkspaceRegisteredTool(
  home: string,
  toolName: "sql_db_checker" | "clickhouse_db_checker",
): Promise<WorkspaceTool | undefined> {
  const extensionModule = await import(pathToFileURL(getWorkspaceExtensionPath(home)).href);
  const registeredTools = new Map<string, WorkspaceTool>();

  extensionModule.default({
    registerTool(tool: WorkspaceTool) {
      registeredTools.set(tool.name, tool);
    },
  });

  return registeredTools.get(toolName);
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
  modelRegistry: ToolContext["modelRegistry"] & {
    find(provider: string, modelId: string): ToolModel | undefined;
  };
  sessionManager: ToolContext["sessionManager"];
  getAllToolNames(): Array<string>;
  getToolByName(name: string): {
    execute(
      toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: unknown,
      context?: ToolContext,
    ): Promise<{ content: string | Array<{ type: string; text?: string }> }>;
  } | undefined;
};

type WorkspaceTool = {
  name: string;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    context?: ToolContext,
  ): Promise<{ content: string | Array<{ type: string; text?: string }> }>;
};

type SessionEvent = {
  type: string;
  message: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  };
};

export { extractAssistantText, parseQueryCheckResult };
