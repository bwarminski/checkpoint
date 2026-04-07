// ABOUTME: Builds the default runtime tool set for the live DB specialist server.
// ABOUTME: Wires ClickHouse, Postgres validation, code search, and demo PR handling together.
import { Pool } from "pg";

import { assertSchemaContractSatisfied } from "./clickhouse_schema_contract.ts";
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

export async function validateRuntimeSchema(clickhouseTool = new ClickHouseTool()): Promise<void> {
  const expectedVersion = process.env.CHECKPOINT_CLICKHOUSE_SCHEMA_VERSION ?? "";
  const introspection = await clickhouseTool.readSchemaContract();

  await assertSchemaContractSatisfied({
    expectedVersion,
    introspection,
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
