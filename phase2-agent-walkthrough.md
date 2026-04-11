# DB Specialist Agent — Code Walkthrough

*2026-04-11T02:18:55Z by Showboat 0.6.1*
<!-- showboat-id: 5d1a5ee1-7f06-4d36-88a3-f2dd4627b982 -->

This walkthrough traces the DB Specialist Agent from HTTP entry point to pull request, following the actual call chain through every layer. Read it alongside phase1-clickhouse-walkthrough.md, which covers the collector and ClickHouse side. The agent side is what acts on that data.

The core flow is: A2A HTTP request → DBSpecialistExecutor → pi-agent-core LLM loop → tools (ClickHouse, code search, EXPLAIN, demo repo, GitHub) → A2A response events.

Files covered, in order:
- agent/src/server.ts — Express/A2A transport, agent card
- agent/src/runtime_dependencies.ts — tool assembly at startup
- agent/src/executor.ts — the LLM loop and event lifecycle
- agent/src/llm_config.ts — provider-qualified model config
- agent/src/agent_tools.ts — tool registry for the loop
- src/tools/code_search_tool.ts — source file resolution
- src/tools/explain_tool.ts — EXPLAIN ANALYZE guard
- src/tools/demo_repo_tool.ts — fix application and git ops
- src/tools/github_tool.ts — GitHub PR creation

## 1. Transport Layer: server.ts

The server is the outermost shell. It wires an Express app to the A2A protocol from @a2a-js/sdk. Three routes matter:

- GET /.well-known/agent.json — the agent card (capabilities, skills, endpoints)
- POST /a2a/jsonrpc — JSON-RPC 2.0 transport (used by most A2A clients)
- POST /a2a/rest — HTTP+JSON transport (simpler for direct testing)

The agent card declares two skills: 'analyze_db' (whole database) and 'analyze_table' (scoped to one table). These skill IDs show up later as user message text that drives the scope parameter into the ClickHouse tool.

createServer() separates construction from listening, which makes the server testable without binding a port. The DefaultRequestHandler from the A2A SDK owns the task state machine; the executor is injected into it.

```bash
sed -n '34,65p' agent/src/server.ts
```

```output
export function createServer(options: ServerOptions = {}): {
  agentCard: AgentCard;
  app: Express;
  executor: DBSpecialistExecutor;
  requestHandler: DefaultRequestHandler;
} {
  const port = options.port ?? 3001;
  const baseUrl = options.baseUrl ?? `http://localhost:${port}`;
  const executor = options.executor ?? createRuntimeExecutor();
  const requestHandler = new DefaultRequestHandler(
    buildAgentCard(baseUrl),
    new InMemoryTaskStore(),
    executor,
  );
  const app = express();

  app.use(express.json());
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use(
    "/a2a/jsonrpc",
    jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }),
  );
  app.use(
    "/a2a/rest",
    restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }),
  );

  return { agentCard: buildAgentCard(baseUrl), app, executor, requestHandler };
}
```

```bash
sed -n '75,107p' agent/src/server.ts
```

```output
function buildAgentCard(baseUrl: string): AgentCard {
  return {
    name: "DB Specialist Agent",
    description: "Analyzes database offenders and reports findings.",
    protocolVersion: "0.3.0",
    version: "0.0.0",
    url: `${baseUrl}/a2a/jsonrpc`,
    skills: [
      {
        id: "analyze_db",
        name: "Analyze DB",
        description: "Inspect database findings and report the result.",
        tags: ["database", "analysis"],
      },
      {
        id: "analyze_table",
        name: "Analyze Table",
        description: "Inspect database findings scoped to a table and report the result.",
        tags: ["database", "analysis", "table"],
      },
    ],
    capabilities: {
      pushNotifications: false,
      streaming: true,
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    additionalInterfaces: [
      { url: `${baseUrl}/a2a/jsonrpc`, transport: "JSONRPC" },
      { url: `${baseUrl}/a2a/rest`, transport: "HTTP+JSON" },
    ],
  };
}
```

The agent card is a static descriptor. It tells A2A clients what the agent can do before they send any task. The skill IDs 'analyze_db' and 'analyze_table' are what a client passes as the user message — the executor reads that text and routes it into the scope parameter for the ClickHouse query.

## 2. Tool Assembly: runtime_dependencies.ts

Before the server starts handling requests, runtime_dependencies.ts assembles the full set of tools. This is the only place that knows about concrete infrastructure: a Postgres pool, the real ClickHouse HTTP endpoint, the live demo repo on disk, and the GitHub API.

createRuntimeExecutor() builds an AgentToolDependencies bag and passes it to DBSpecialistExecutor. The executor never touches infrastructure directly — it only talks to the interfaces in that bag. This is what makes the executor testable: tests can inject fake implementations of any tool without touching network or disk.

```bash
cat agent/src/runtime_dependencies.ts
```

```output
// ABOUTME: Builds the default runtime tool set for the live DB specialist server.
// ABOUTME: Wires ClickHouse, Postgres validation, code search, and demo PR handling together.
import { Pool } from "pg";

import { DBSpecialistExecutor } from "./executor.ts";
import { ClickHouseTool } from "../../src/tools/clickhouse_tool.ts";
import { CodeSearchTool } from "../../src/tools/code_search_tool.ts";
import { DemoRepoTool } from "../../src/tools/demo_repo_tool.ts";
import { ExplainTool } from "../../src/tools/explain_tool.ts";
import { GitHubTool } from "../../src/tools/github_tool.ts";

let pool: Pool | undefined;

type RuntimeDependencies = {
  explainTool: ExplainTool;
  postgresPool: Pool;
};

export function createRuntimeDependencies(): RuntimeDependencies {
  const postgresPool = getPool();

  return {
    explainTool: new ExplainTool({
      query: async (sql: string) => postgresPool.query(sql),
    }),
    postgresPool,
  };
}

export function createRuntimeExecutor(): DBSpecialistExecutor {
  const { explainTool } = createRuntimeDependencies();

  return new DBSpecialistExecutor({
    clickhouseTool: new ClickHouseTool(),
    codeSearchTool: new CodeSearchTool(),
    explainTool: {
      analyze: async ({ sql }: { sql: string }) => {
        const result = (await explainTool.analyze({ sql })) as { rows?: Array<unknown> };

        return {
          plan_rows: result.rows ?? [],
          validated: true,
        };
      },
    },
    githubTool: new GitHubTool(),
    demoRepoTool: new DemoRepoTool(),
  });
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.POSTGRES_URL ??
        "postgresql://postgres:postgres@127.0.0.1:5432/checkpoint_demo",
    });
  }

  return pool;
}
```

Notice how explainTool wraps the raw ExplainTool: the adapter adds 'validated: true' and restructures the result into { plan_rows, validated } before handing it to the executor. This is the boundary where Postgres query results become agent-usable structured data. The pool is a lazy singleton — it is created on first use and reused across tasks.

## 3. The Core Loop: executor.ts

DBSpecialistExecutor is where the agent actually runs. It owns:
- The LLM configuration (provider/model)
- The active task map (taskId → { agent, contextId })
- The system prompt that tells the LLM what it is and how to behave
- The execute() method that runs one task from request to response

The system prompt is short and direct: use tools, don't invent data, finish with a concise explanation.

```bash
sed -n '68,95p' agent/src/executor.ts
```

```output
const DEFAULT_SYSTEM_PROMPT = [
  "You are the DB specialist agent.",
  "Investigate database issues by using the available tools instead of inventing data.",
  "Use query_findings for normalized ClickHouse findings and query_database only for guarded follow-up queries.",
  "Finish with a concise response that explains what you found and what should happen next.",
].join("\n");

export class DBSpecialistExecutor {
  readonly llmConfig: LlmConfig;

  private readonly createAgentImpl: (input: CreateAgentInput) => LoopAgent;
  private readonly now: () => Date;
  private readonly systemPrompt: string;
  private readonly streamFn?: StreamFn;
  private readonly activeTasks = new Map<string, { agent: LoopAgent; contextId: string }>();

  constructor(
    private readonly deps: AgentToolDependencies = {
      clickhouseTool: new ClickHouseTool(),
    },
    options: ExecutorOptions = {},
  ) {
    this.llmConfig = parseLlmConfig(options.env ?? process.env);
    this.createAgentImpl = options.createAgent ?? createAgent;
    this.now = options.now ?? (() => new Date());
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.streamFn = options.streamFn;
  }
```

The constructor has two dependency injection points: deps (the tool bag) and options (behavioral overrides). The createAgent option is crucial for testing — it lets tests replace the real LLM-backed pi-agent-core Agent with a controlled fake. The now function is similarly injectable for deterministic timestamp tests.

### 3.1 The execute() method

execute() is the heartbeat of the agent. Each call handles exactly one A2A task. The sequence is:

1. Extract user text from the A2A request context
2. Build the tool list from the dependency bag
3. Create a fresh Agent for this task
4. Set up a LoopRunResult accumulator
5. Register the task in activeTasks (for cancellation)
6. Subscribe to agent events with applyLoopEvent()
7. Publish 'submitted' and 'working' events to the A2A event sink
8. prompt() the agent with the user text
9. waitForIdle() — block until the LLM stops issuing tool calls
10. Publish 'completed' with the accumulated findings and response text
11. Cleanup: unsubscribe, remove from activeTasks

```bash
sed -n '97,138p' agent/src/executor.ts
```

```output
  async execute(
    requestContext: QueueRequestContext,
    eventSink: EventSink,
  ): Promise<void> {
    const userText = readUserText(requestContext) ?? "analyze_db";
    const tools = buildAgentTools(this.deps);
    const agent = this.createAgentImpl({
      deps: this.deps,
      llmConfig: this.llmConfig,
      systemPrompt: this.systemPrompt,
      streamFn: this.streamFn,
      tools,
    });
    const runResult: LoopRunResult = {
      findings: [],
      response: "",
      toolResults: [],
    };

    const taskId = requestContext.taskId ?? FALLBACK_TASK_ID;
    const contextId = requestContext.contextId ?? FALLBACK_CONTEXT_ID;
    this.activeTasks.set(taskId, { agent, contextId });
    const unsubscribe = agent.subscribe((event) => {
      applyLoopEvent(runResult, event);
    });

    try {
      this.publishSubmittedTask(requestContext, eventSink);
      this.publishWorking(requestContext, eventSink);
      await agent.prompt(userText);
      await agent.waitForIdle();
      this.publishCompleted(requestContext, eventSink, runResult);
    } catch (err) {
      this.publishFailed(requestContext, eventSink, err);
    } finally {
      unsubscribe();
      const activeTask = this.activeTasks.get(taskId);
      if (activeTask?.agent === agent) {
        this.activeTasks.delete(taskId);
      }
    }
  }
```

Each task gets a fresh Agent. There is no shared LLM context between tasks — each starts with a clean conversation containing only the system prompt plus the one user message. The agent identity check in the finally block ('if activeTask?.agent === agent') prevents a race where a cancelled task's cleanup removes a replacement task's entry from the map.

### 3.2 Event accumulation: applyLoopEvent()

The agent emits events as the LLM runs. applyLoopEvent() filters the stream for three things:

- message_update with text_delta: append to runResult.response (streaming text)
- message_end with assistant role: replace runResult.response with the complete final text
- tool_execution_end: push every tool call result to toolResults; if it was query_findings and succeeded, update runResult.findings

Only query_findings populates findings. That is what flows into the A2A response as structured data alongside the prose. All other tool results (locate_source, analyze_query, apply_fix, open_pull_request) appear only in toolResults for diagnostic purposes.

```bash
sed -n '258,289p' agent/src/executor.ts
```

```output
function applyLoopEvent(runResult: LoopRunResult, event: AgentEvent): void {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    runResult.response += event.assistantMessageEvent.delta;
    return;
  }

  if (event.type === "message_end" && event.message.role === "assistant") {
    const text = extractAssistantText(event.message);
    if (text.length > 0) {
      runResult.response = text;
    }
    return;
  }

  if (
    event.type === "tool_execution_end" &&
    typeof event.toolName === "string"
  ) {
    runResult.toolResults.push({
      details: event.result?.details,
      toolName: event.toolName,
    });

    if (
      !event.isError &&
      event.toolName === "query_findings" &&
      Array.isArray(event.result?.details)
    ) {
      runResult.findings = event.result.details;
    }
  }
}
```

### 3.3 A2A event publishing

The executor has two event sink protocols. The production path uses ExecutionEventBus from @a2a-js/sdk, which streams task state changes to connected A2A clients. The test path uses a simpler EventQueue interface with enqueueEvent(). The same executor code handles both via duck-typing: 'enqueueEvent' in eventSink branches to the simpler path.

The A2A state machine follows: submitted → working → completed (or failed). Each state publishes a status-update event. The completed event carries the full response as a structured data part, which is what the A2A client receives.

```bash
sed -n '332,359p' agent/src/executor.ts
```

```output
function buildCompletedMessage(
  requestContext: Partial<RequestContext>,
  runResult: LoopRunResult,
): {
  contextId: string;
  kind: "message";
  messageId: string;
  parts: Array<{ data: LoopRunResult; kind: "data" }>;
  role: "agent";
  taskId: string;
} {
  const taskId = requestContext.taskId ?? FALLBACK_TASK_ID;
  const contextId = requestContext.contextId ?? FALLBACK_CONTEXT_ID;

  return {
    contextId,
    kind: "message",
    messageId: `${taskId}-completed`,
    parts: [
      {
        kind: "data",
        data: runResult,
      },
    ],
    role: "agent",
    taskId,
  };
}
```

The completed message wraps the entire LoopRunResult in a single 'data' part. Downstream callers get: findings (structured TopOffender array from query_findings), response (final LLM prose), and toolResults (diagnostic log of every tool called). This is the A2A response envelope that clients unwrap.

## 4. Model Configuration: llm_config.ts

The model reference uses a provider/model format: 'openai/gpt-4o-mini', 'anthropic/claude-3-5-haiku-20241022', etc. parseLlmConfig reads LLM_MODEL from env and splits on the first slash. The provider string is passed to pi-ai's getModel(), which resolves it to the correct LLM client.

```bash
cat agent/src/llm_config.ts
```

```output
// ABOUTME: Parses the agent's provider-qualified LLM model configuration from env input.
// ABOUTME: Keeps the runtime contract centered on a single provider-qualified LLM_MODEL.
export type QualifiedModelRef = {
  model: string;
  provider: string;
};

export type LlmConfig = {
  primary: QualifiedModelRef;
};

type LlmEnv = {
  LLM_MODEL?: string;
};

export const DEFAULT_LLM_MODEL = "openai/gpt-4o-mini";

export function parseLlmConfig(env: LlmEnv): LlmConfig {
  return {
    primary: parseQualifiedModelRef(env.LLM_MODEL ?? DEFAULT_LLM_MODEL),
  };
}

export function parseQualifiedModelRef(value: string): QualifiedModelRef {
  const [provider, ...modelParts] = value.split("/");
  const model = modelParts.join("/").trim();

  if (!provider?.trim() || !model) {
    throw new Error("LLM_MODEL must use provider/model format");
  }

  return {
    provider: provider.trim(),
    model,
  };
}
```

The model string is joined back after splitting on '/' so that model names with slashes (like 'claude-3-5-haiku-20241022') still parse correctly. The default is 'openai/gpt-4o-mini'. To switch providers, set LLM_MODEL in .env — no code changes needed.

## 5. The Tool Registry: agent_tools.ts

buildAgentTools() takes the AgentToolDependencies bag and returns an Array<AgentTool> for pi-agent-core. Each tool has: name (what the LLM calls), description (what it tells the LLM), parameters (TypeBox schema for input validation), and execute (the async implementation).

Tools are optional — if a dependency is absent, its tools are skipped. This means you can run with just clickhouseTool for a read-only analysis mode, or with the full set for end-to-end fix-and-PR.

```bash
sed -n '69,126p' agent/src/agent_tools.ts
```

```output
export function buildAgentTools(
  deps: AgentToolDependencies,
): Array<AgentTool<any>> {
  const tools: Array<AgentTool<any>> = [];

  if (deps.clickhouseTool) {
    tools.push(
      {
        name: "list_tables",
        label: "List Tables",
        description: "List the supported ClickHouse tables available to the agent.",
        parameters: Type.Object({}),
        execute: async () => {
          const tables = await deps.clickhouseTool!.listTables();
          return textResult(JSON.stringify(tables), tables);
        },
      },
      {
        name: "describe_table",
        label: "Describe Table",
        description: "Describe a supported ClickHouse table schema.",
        parameters: Type.Object({
          table: Type.String(),
        }),
        execute: async (_id, params) => {
          const table = readStringProperty(params, "table");
          const schema = await deps.clickhouseTool!.describeTable(table);
          return textResult(schema, schema);
        },
      },
      {
        name: "query_database",
        label: "Query Database",
        description: "Run a guarded SELECT query against the supported ClickHouse tables.",
        parameters: Type.Object({
          sql: Type.String(),
        }),
        execute: async (_id, params) => {
          const sql = readStringProperty(params, "sql");
          const rows = await deps.clickhouseTool!.executeQuery(sql);
          return textResult(rows, rows);
        },
      },
      {
        name: "query_findings",
        label: "Query Findings",
        description: "Load normalized ClickHouse findings for the current database scope.",
        parameters: Type.Object({
          scope: Type.Optional(Type.String()),
        }),
        execute: async (_id, params) => {
          const scope = readOptionalStringProperty(params, "scope");
          const findings = await deps.clickhouseTool!.queryFindings(scope);
          return textResult(JSON.stringify(findings), findings);
        },
      },
    );
  }
```

The four ClickHouse tools expose different levels of access:
- list_tables: safe enumeration, no parameters
- describe_table: schema inspection, one table name parameter
- query_database: raw guarded SELECT (assertSupportedQuery validates it is SELECT-only on supported tables)
- query_findings: the primary tool — calls queryFindings() which runs the pre-built offender query and returns parsed TopOffender objects

The textResult() wrapper returns both a text representation (for the LLM's next turn) and the typed details object (captured by applyLoopEvent for findings accumulation). The LLM sees JSON text; the executor sees the parsed array.

```bash
sed -n '128,205p' agent/src/agent_tools.ts
```

```output
  if (deps.codeSearchTool) {
    tools.push({
      name: "locate_source",
      label: "Locate Source",
      description: "Load the source file context for a finding's source file.",
      parameters: Type.Object({
        source_file: Type.String(),
      }),
      execute: async (_id, params) => {
        const source = await deps.codeSearchTool!.locate(asLocateSourceInput(params));
        return textResult(JSON.stringify(source), source);
      },
    });
  }

  if (deps.explainTool) {
    tools.push({
      name: "analyze_query",
      label: "Analyze Query",
      description: "Run the guarded query validation path for a candidate SQL statement.",
      parameters: Type.Object({
        sql: Type.String(),
      }),
      execute: async (_id, params) => {
        const sql = readStringProperty(params, "sql");
        const result = await deps.explainTool!.analyze({ sql });
        return textResult(JSON.stringify(result), result);
      },
    });
  }

  if (deps.demoRepoTool) {
    tools.push({
      name: "apply_fix",
      label: "Apply Fix",
      description: "Apply a concrete fix in the demo repo for a selected finding.",
      parameters: Type.Object({
        finding: Type.Object({
          fingerprint: Type.String(),
          severity: Type.Optional(Type.String()),
        }),
        fix: Type.Object({
          fix_type: Type.String(),
          summary: Type.String(),
        }),
        validation: Type.Optional(
          Type.Object({
            validated: Type.Optional(Type.Boolean()),
          }),
        ),
        source: Type.Object({
          content: Type.String(),
          source_file: Type.String(),
        }),
      }),
      execute: async (_id, params) => {
        const input = asApplyFixInput(params);
        if (input.finding.severity !== "high") {
          throw new Error("apply_fix requires a high-severity finding");
        }
        if (input.validation?.validated !== true) {
          throw new Error("apply_fix requires validated query input");
        }
        if (!input.source.source_file) {
          throw new Error("apply_fix requires source_file");
        }
        const result = await deps.demoRepoTool!.applyFix({
          finding: {
            fingerprint: input.finding.fingerprint,
          },
          fix: input.fix,
          source: input.source,
        });
        return textResult(JSON.stringify(result), result);
      },
    });
  }

```

The apply_fix tool has two guards baked into the execute function before it touches the repo:
1. severity must be 'high' — the agent cannot apply fixes to medium-severity findings
2. validation.validated must be true — the query must have passed EXPLAIN ANALYZE first

These are not schema constraints; they are runtime checks that throw if violated. The LLM must call analyze_query and get validated: true before apply_fix will run. This is the safety gate against untested fixes landing in the repo.

## 6. Source File Resolution: code_search_tool.ts

When the agent calls locate_source with a source_file from a finding, CodeSearchTool.locate() resolves the path and returns the file content. The source_file string comes from pg_stat_statements comment parsing in the collector — it is a container-relative path like 'app/controllers/todos_controller.rb:42'.

The path normalization chain:
1. normalizeSourceFile: strips leading '/' from absolute container paths, validates /app/ prefix
2. splitSourcePath: splits 'file.rb:42' into { filePath: 'file.rb', lineNumber: 42 }
3. resolveWithinRoot: joins with the code search root and verifies it does not escape
4. formatContextLines: returns ±contextLines around the target line (default: 3)

```bash
sed -n '138,191p' src/tools/code_search_tool.ts
```

```output
function toRelativeSourceFile(input: CodeSearchInput): string {
  if (input.source_file) {
    return normalizeSourceFile(input.source_file);
  }

  throw new Error("source_file is required");
}

function normalizeSourceFile(sourceFile: string): string {
  if (sourceFile.startsWith("/")) {
    if (!sourceFile.startsWith("/app/")) {
      throw new Error("Absolute source_file paths must stay under /app/.");
    }

    return sourceFile.slice(1);
  }

  return sourceFile.replace(/^\.?\//, "");
}

function splitSourcePath(sourcePath: string): { filePath: string; lineNumber?: number } {
  const match = sourcePath.match(/^(.*?):(\d+)$/);

  if (!match) {
    return { filePath: sourcePath };
  }

  return {
    filePath: match[1] ?? sourcePath,
    lineNumber: Number(match[2]),
  };
}

function resolveWithinRoot(root: string, filePath: string): string {
  const relativePath = filePath.replace(/^\/+/, "");
  const absolutePath = resolve(root, relativePath);

  if (!absolutePath.startsWith(root + sep)) {
    throw new Error(`Code search path escapes the root: ${filePath}`);
  }

  return absolutePath;
}

function formatContextLines(content: string, lineNumber: number, contextLines: number): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, lineNumber - contextLines);
  const end = Math.min(lines.length, lineNumber + contextLines);

  return lines
    .slice(start - 1, end)
    .map((line, index) => `${start + index}: ${line}`)
    .join("\n");
}
```

The path escape check ('!absolutePath.startsWith(root + sep)') prevents a source_file like '../../etc/passwd' from reading outside the demo repo. The /app/ prefix validation catches Docker container absolute paths — the collector writes paths like '/app/controllers/todos_controller.rb' because the Rails app runs at /app inside the container. Stripping the leading slash converts that to a repo-relative path.

## 7. Query Validation: explain_tool.ts

ExplainTool.analyze() wraps EXPLAIN ANALYZE around candidate fix SQL before the agent commits to applying a fix. It is the shortest file in the codebase — 19 lines — because the guard is simple: the input must start with SELECT (case-insensitive), then the query is sent as EXPLAIN ANALYZE to Postgres.

```bash
cat src/tools/explain_tool.ts
```

```output
// ABOUTME: Executes guarded EXPLAIN ANALYZE queries for candidate SQL statements.
// ABOUTME: Rejects non-SELECT input before the database receives any statement.
type Queryable = {
  query(sql: string): Promise<unknown>;
};

export class ExplainTool {
  constructor(private readonly db: Queryable) {}

  async analyze(input: { sql: string }): Promise<unknown> {
    const sql = input.sql.trim();

    if (!/^select\b/i.test(sql)) {
      throw new Error("SELECT-only queries are allowed for EXPLAIN ANALYZE");
    }

    return this.db.query(`EXPLAIN ANALYZE ${sql}`);
  }
}
```

EXPLAIN ANALYZE actually runs the query — it does not just plan it. This means the agent is running the candidate replacement query against the real demo database as a validation step. If the query is structurally wrong or references missing columns, it fails here before any code change happens. The runtime_dependencies.ts adapter wraps this result in { plan_rows, validated: true } before the LLM sees it.

## 8. Fix Application: demo_repo_tool.ts

DemoRepoTool.applyFix() is the action that modifies real code. It operates directly on the demo repo filesystem and git. The sequence:

1. Verify git remote is reachable (fail fast before touching files)
2. Derive a branch name from the fingerprint (truncated + SHA suffix for uniqueness)
3. Checkout a fresh branch from origin/main (forceful reset: '-B')
4. Apply the fix by fix_type (one of four supported transforms)
5. git add only the touched files
6. git commit with a standard message
7. git diff the commit for the PR body
8. git push to origin

The fix_type dispatch is a simple switch with four cases. There is no plugin system.

```bash
sed -n '65,98p' src/tools/demo_repo_tool.ts
```

```output
  async applyFix(input: ApplyFixInput): Promise<ApplyFixResult> {
    const root = this.env.DEMO_APP_ROOT ?? defaultDemoAppRoot();

    const baseRef = this.env.DEMO_BASE_REF ?? "main";
    await ensureRemoteReachable(this.runner, root);
    const branchName = buildBranchName(input.finding.fingerprint);
    await this.runner.exec(["git", "checkout", "-B", branchName, `origin/${baseRef}`], root);
    const touchedPaths = await this.applyChange(root, input);

    for (const path of touchedPaths) {
      await this.runner.exec(["git", "add", path], root);
    }

    await this.runner.exec(["git", "commit", "-m", `chore: apply ${input.fix.fix_type} fix`], root);
    const diff = await this.runner.exec(["git", "diff", "HEAD~1", "HEAD", "--", ...touchedPaths], root);
    await this.runner.exec(["git", "push", "origin", branchName], root);
    return { branchName, diff };
  }

  private async applyChange(root: string, input: ApplyFixInput): Promise<string[]> {
    switch (input.fix.fix_type) {
      case "rewrite_count":
        return [await rewriteCount(root, input.source)];
      case "rewrite_like":
        return [await rewriteLike(root, input.source)];
      case "add_includes":
        return [await addIncludes(root, input.source)];
      case "add_index":
        return [await addIndexMigration(root, input.source, this.now)];
      default:
        throw new Error(`DemoRepoTool: unsupported fix_type ${input.fix.fix_type}`);
    }
  }
}
```

The four fix types are hardcoded transforms against known locations in the demo Rails app:
- rewrite_count: replaces 'User.all.index_with { |user| user.todos.count }' with a bulk Todo.group(:user_id).count to eliminate N+1
- rewrite_like: changes '%#{params[:q]}%' to '#{params[:q]}%' to eliminate a leading wildcard that blocks index use
- add_includes: adds .includes(:user) to Todo queries to prevent N+1 on user associations
- add_index: generates a new Rails migration adding an index on a column extracted from the source content

Each transform reads the file, applies a string replacement, and verifies the replacement changed something. If the expected string is not found, it throws — the demo app may have drifted.

```bash
sed -n '208,216p' src/tools/demo_repo_tool.ts
```

```output
function buildBranchName(fingerprint: string): string {
  const sanitized = fingerprint.replace(/[^A-Za-z0-9._-]/g, "-");
  const readable = sanitized.slice(0, 12);
  if (sanitized.length <= 12) {
    return `agent/demo-fix-${readable}`;
  }

  const suffix = createHash("sha256").update(sanitized).digest("hex").slice(0, 8);
  return `agent/demo-fix-${readable}-${suffix}`;
```

Branch names are 'agent/demo-fix-{first12chars}-{sha256prefix8}' for long fingerprints, or 'agent/demo-fix-{fingerprint}' if the fingerprint is 12 characters or fewer. The SHA suffix makes the branch name unique and reproducible — the same fingerprint always produces the same branch name, so re-running the agent for the same finding does not create a second branch.

## 9. Pull Request Creation: github_tool.ts

GitHubTool.openPullRequest() calls the GitHub API to create a PR from the pushed branch to the base ref (default: main). If GITHUB_TOKEN is not set, it returns a local:// placeholder URL — this lets the full fix flow complete in local testing without a real GitHub token.

The PR body is built from the finding (fingerprint, source_file), the fix (fix_type, summary), the code diff captured in step 8, and the EXPLAIN ANALYZE output from step 7. All the evidence flows into the PR description.

```bash
sed -n '163,193p' src/tools/github_tool.ts
```

```output
function buildPullRequestTitle(input: PullRequestInput): string {
  const fingerprint = input.finding?.fingerprint ?? "unknown";
  const fixType = input.fix?.fix_type ?? "db_fix";

  return `[db-specialist] ${fixType} for ${fingerprint}`;
}

function buildPullRequestBody(input: PullRequestInput): string {
  const explainRows = input.validation?.plan_rows
    ?.map((row) => Object.values(row).join(" "))
    .join("\n") ?? "No EXPLAIN rows captured.";

  return [
    "## DB Specialist Finding",
    `- fingerprint: ${input.finding?.fingerprint ?? "unknown"}`,
    `- source_file: ${input.finding?.source_file ?? "unknown"}`,
    `- fix_type: ${input.fix?.fix_type ?? "unknown"}`,
    `- summary: ${input.fix?.summary ?? "unknown"}`,
    "",
    "## Code Change",
    "```diff",
    input.codeDiff ?? "No code diff captured.",
    "```",
    "",
    "## EXPLAIN (sample query)",
    "```",
    explainRows,
    "```",
  ].join("\n");
}
```

```bash
sed -n '117,134p' src/tools/github_tool.ts
```

```output
async function resolveExistingPullRequestUrl(
  fetchImpl: typeof fetch,
  env: GitHubEnv,
  headRef: string,
  response: Response,
): Promise<string | null> {
  if (response.status !== 422) {
    return null;
  }

  const payload = await response.json().catch(() => null) as {
    errors?: Array<{ message?: string }>;
  } | null;
  const errors = payload?.errors ?? [];
  const hasExistingPrError = errors.some((error) =>
    typeof error.message === "string" && /pull request already exists/i.test(error.message),
  );
  if (!hasExistingPrError || !env.DEMO_REPO || !headRef) {
```

The deduplication path: if the POST to create a PR returns 422 and the error message contains 'pull request already exists', the tool searches for the existing open PR and returns its URL instead of throwing. This makes open_pull_request idempotent — re-running the agent for the same fingerprint does not create a second PR, it returns the existing one.

## 10. End-to-End: Putting It Together

The full flow for an 'analyze_table todos' request:

## 10. End-to-End: Putting It Together

The full flow for an 'analyze_table todos' request:

    A2A client → POST /a2a/jsonrpc
      → DefaultRequestHandler (InMemoryTaskStore)
      → DBSpecialistExecutor.execute()
        → readUserText() → 'analyze_table todos'
        → buildAgentTools(deps) → 8 tools registered
        → createAgent() → pi-agent-core Agent with system prompt
        → agent.prompt('analyze_table todos')

        LLM turn 1: calls query_findings(scope='analyze_table todos')
          → ClickHouseTool.queryFindings()
            → parseScope() → { allTime: false, tableName: 'todos', timeWindowMinutes: 60 }
            → buildWindowedQuery() → SELECT from query_intervals WHERE interval < 60min
            → HTTP → ClickHouse → TSV → parseOffenderRows()
            → returns [{ fingerprint, p95_exec_time_ms, severity, ... }]
          → applyLoopEvent() updates runResult.findings

        LLM turn 2: calls locate_source(source_file)
          → CodeSearchTool.locate() → file content with context lines
          → LLM sees the actual controller code

        LLM turn 3: calls analyze_query(sql=<candidate fix>)
          → ExplainTool.analyze() → EXPLAIN ANALYZE on Postgres
          → returns { plan_rows, validated: true }

        LLM turn 4: calls apply_fix(finding, fix, validation, source)
          → guards: severity=high, validated=true
          → DemoRepoTool.applyFix() → checkout branch, write file, commit, push
          → returns { branchName, diff }

        LLM turn 5: calls open_pull_request(finding, fix, headRef, codeDiff, validation)
          → GitHubTool.openPullRequest() → GitHub API → PR URL

        LLM turn 6: writes final prose summary

        → agent.waitForIdle()
      → publishCompleted() → A2A event with { findings, response, toolResults }
    → client receives streaming task status updates

The LLM decides how many turns to take. The system prompt steers it toward query_findings first, but the loop only terminates when the LLM stops calling tools. A task that finds no high-severity findings will complete after 1-2 turns. A task with a fixable finding follows the full 6-turn sequence above.

The number of tools available constrains what the LLM can do. With only clickhouseTool registered (the minimum), the agent can report findings but cannot locate source, validate fixes, or open PRs. Each dependency in the bag unlocks additional capability.

