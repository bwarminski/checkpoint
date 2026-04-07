// ABOUTME: Registers the DB specialist tools with pi from the shared runtime dependencies.
// ABOUTME: Reuses one tool instance per extension load and exposes the specialist workflow to pi sessions.
import { ClickHouseTool } from "../src/tools/clickhouse_tool.ts";
import { CodeSearchTool } from "../src/tools/code_search_tool.ts";
import { DemoRepoTool } from "../src/tools/demo_repo_tool.ts";
import { ExplainTool } from "../src/tools/explain_tool.ts";
import { GitHubTool } from "../src/tools/github_tool.ts";

type PiExtension = {
  registerTool(input: {
    description?: string;
    execute?: (...args: Array<any>) => Promise<unknown> | unknown;
    name: string;
  }): void;
};

const clickhouseTool = new ClickHouseTool();
const explainTool = new ExplainTool({
  query: async () => ({ rows: [] }),
});
const codeSearchTool = new CodeSearchTool();
const demoRepoTool = new DemoRepoTool();
const githubTool = new GitHubTool();

export default function registerDbSpecialist(pi: PiExtension): void {
  pi.registerTool({
    name: "query_findings",
    description: "Load normalized ClickHouse findings for the current database scope.",
    execute: async (input: unknown) => clickhouseTool.queryFindings(input),
  });
  pi.registerTool({
    name: "list_tables",
    description: "List the supported ClickHouse tables available to the agent.",
    execute: async () => clickhouseTool.listTables(),
  });
  pi.registerTool({
    name: "describe_table",
    description: "Describe a supported ClickHouse table schema.",
    execute: async ({ table }: { table: string }) => clickhouseTool.describeTable(table),
  });
  pi.registerTool({
    name: "query_database",
    description: "Run a guarded SELECT query against the supported ClickHouse tables.",
    execute: async ({ sql }: { sql: string }) => clickhouseTool.executeQuery(sql),
  });
  pi.registerTool({
    name: "analyze_query",
    description: "Run the guarded query validation path for a candidate SQL statement.",
    execute: async ({ sql }: { sql: string }) => explainTool.analyze({ sql }),
  });
  pi.registerTool({
    name: "locate_source",
    description: "Load the source file context for a finding's source file or source tag.",
    execute: async (input: unknown) => codeSearchTool.locate(input as { source_file?: string | null; source_tag?: string | null }),
  });
  pi.registerTool({
    name: "apply_fix",
    description: "Apply a concrete fix in the demo repo for a selected finding.",
    execute: async (input: unknown) => demoRepoTool.applyFix(input as {
      finding: { fingerprint: string };
      fix: { fix_type: string; summary: string };
      source: { content: string; source_file: string };
    }),
  });
  pi.registerTool({
    name: "open_pull_request",
    description: "Open a pull request for the selected finding and prepared fix.",
    execute: async (input: unknown) => githubTool.openPullRequest(input as {
      codeDiff?: string;
      finding: { fingerprint?: string; source_tag?: string };
      fix: { fix_type?: string; summary?: string };
      headRef?: string;
      validation?: { plan_rows?: Array<Record<string, unknown>> };
    }),
  });
}
