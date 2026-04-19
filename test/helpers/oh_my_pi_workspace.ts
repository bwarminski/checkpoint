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
  const checkerTool = session.getToolByName(input.toolName);

  if (!checkerTool) {
    throw new Error(`Missing checker tool definition: ${input.toolName}`);
  }

  try {
    const result = await checkerTool.execute("checker-test-call", input.input);
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

  await session.setModelTemporary(resolvedModel);
  const workspaceSession = session as WorkspaceSession;
  workspaceSession.sessionManagerWithEntries =
    session.sessionManager as WorkspaceSession["sessionManagerWithEntries"];
  initializeWorkspaceExtensionRuntime(workspaceSession);

  return {
    session: workspaceSession,
  };
}

function initializeWorkspaceExtensionRuntime(session: WorkspaceSession): void {
  const extensionRunner = session.extensionRunner;
  if (!extensionRunner) {
    return;
  }

  extensionRunner.initialize(
    {
      sendMessage: (message: unknown, options?: unknown) => {
        session.sendCustomMessage(message, options).catch(() => {});
      },
      sendUserMessage: (content: string, options?: unknown) => {
        session.sendUserMessage(content, options).catch(() => {});
      },
      appendEntry: (customType: string, data: unknown) => {
        session.sessionManagerWithEntries.appendCustomEntry(customType, data);
      },
      setLabel: (targetId: string, label: string) => {
        session.sessionManagerWithEntries.appendLabelChange(targetId, label);
      },
      getActiveTools: () => session.getActiveToolNames(),
      getAllTools: () => session.getAllToolNames(),
      setActiveTools: (toolNames: Array<string>) => session.setActiveToolsByName(toolNames),
      getCommands: () => [],
      setModel: async (nextModel: ToolModel) => {
        const key = await session.modelRegistry.getApiKey(nextModel);
        if (!key) {
          return false;
        }

        await session.setModel(nextModel);
        return true;
      },
      getThinkingLevel: () => session.thinkingLevel,
      setThinkingLevel: (level: unknown) => session.setThinkingLevel(level),
      getSessionName: () => session.sessionManagerWithEntries.getSessionName(),
      setSessionName: async (name: string) => {
        await session.sessionManagerWithEntries.setSessionName(name, "user");
      },
    },
    {
      getModel: () => session.model,
      isIdle: () => !session.isStreaming,
      abort: () => session.abort(),
      hasPendingMessages: () => session.queuedMessageCount > 0,
      shutdown: () => {},
      getContextUsage: () => session.getContextUsage(),
      getSystemPrompt: () => session.systemPrompt,
      compact: async (instructionsOrOptions?: string | Record<string, unknown>) => {
        const instructions =
          typeof instructionsOrOptions === "string" ? instructionsOrOptions : undefined;
        const options =
          instructionsOrOptions && typeof instructionsOrOptions === "object"
            ? instructionsOrOptions
            : undefined;
        await session.compact(instructions, options);
      },
    },
    {
      getContextUsage: () => session.getContextUsage(),
      waitForIdle: () => session.agent.waitForIdle(),
      newSession: async (options?: { parentSession?: boolean; setup?: (sessionManager: ToolContext["sessionManager"]) => Promise<void> }) => {
        const success = await session.newSession({ parentSession: options?.parentSession });
        if (success && options?.setup) {
          await options.setup(session.sessionManager);
        }

        return { cancelled: !success };
      },
      branch: async (entryId?: string) => {
        const result = await session.branch(entryId);
        return { cancelled: result.cancelled };
      },
      navigateTree: async (targetId: string, options?: { summarize?: boolean }) => {
        const result = await session.navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async (sessionPath: string) => {
        const success = await session.switchSession(sessionPath);
        return { cancelled: !success };
      },
      reload: async () => {
        await session.reload();
      },
      compact: async (instructionsOrOptions?: string | Record<string, unknown>) => {
        const instructions =
          typeof instructionsOrOptions === "string" ? instructionsOrOptions : undefined;
        const options =
          instructionsOrOptions && typeof instructionsOrOptions === "object"
            ? instructionsOrOptions
            : undefined;
        await session.compact(instructions, options);
      },
    },
  );
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
  agent: {
    waitForIdle(): Promise<void>;
  };
  branch(entryId?: string): Promise<{ cancelled: boolean }>;
  compact(
    instructions?: string,
    options?: Record<string, unknown>,
  ): Promise<void>;
  extensionRunner?: {
    initialize(
      actions: Record<string, unknown>,
      contextActions: Record<string, unknown>,
      commandActions?: Record<string, unknown>,
    ): void;
  };
  getActiveToolNames(): Array<string>;
  model: ToolModel | undefined;
  modelRegistry: ToolContext["modelRegistry"] & {
    find(provider: string, modelId: string): ToolModel | undefined;
    getApiKey(model: ToolModel): Promise<string | undefined>;
  };
  newSession(options?: { parentSession?: boolean }): Promise<boolean>;
  navigateTree(
    targetId: string,
    options?: { summarize?: boolean },
  ): Promise<{ cancelled: boolean }>;
  queuedMessageCount: number;
  reload(): Promise<void>;
  sendCustomMessage(
    message: unknown,
    options?: unknown,
  ): Promise<void>;
  sendUserMessage(
    content: string,
    options?: unknown,
  ): Promise<void>;
  sessionManager: ToolContext["sessionManager"];
  sessionManagerWithEntries: ToolContext["sessionManager"] & {
    appendCustomEntry(customType: string, data: unknown): void;
    appendLabelChange(targetId: string, label: string): void;
    getSessionName(): string | undefined;
    setSessionName(name: string, source: string): Promise<void>;
  };
  setActiveToolsByName(toolNames: Array<string>): Promise<void>;
  setModel(model: ToolModel): Promise<void>;
  setThinkingLevel(level: unknown): void;
  getAllToolNames(): Array<string>;
  getContextUsage(): unknown;
  setModelTemporary(model: ToolModel): Promise<void>;
  switchSession(sessionPath: string): Promise<boolean>;
  systemPrompt: string;
  thinkingLevel: unknown;
  isStreaming: boolean;
  abort(): void;
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

type SessionEvent = {
  type: string;
  message: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  };
};

export { extractAssistantText, parseQueryCheckResult };
