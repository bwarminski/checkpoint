// ABOUTME: Builds the default runtime tool set for the live DB specialist server.
// ABOUTME: Wires ClickHouse, Postgres validation, memory schema setup, code search, and demo PR handling together.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { DBSpecialistExecutor } from "./executor.ts";
import { ClickHouseTool } from "./tools/clickhouse_tool.ts";
import { CodeSearchTool } from "./tools/code_search_tool.ts";
import { ExplainTool } from "./tools/explain_tool.ts";
import { GitHubTool } from "./tools/github_tool.ts";
import { MemoryTool } from "./tools/memory_tool.ts";

let pool: Pool | undefined;
let memorySchemaPromise: Promise<void> | undefined;

export function createRuntimeExecutor(): DBSpecialistExecutor {
  const postgresPool = getPool();
  const explainTool = new ExplainTool({
    query: async (sql: string) => postgresPool.query(sql),
  });
  const memoryTool = new MemoryTool({
    query: async (sql: string, params?: unknown[]) => {
      await ensureMemorySchema(postgresPool);
      return (await postgresPool.query(sql, params)).rows as Array<{ created_at?: string | null; status: string }>;
    },
  });

  return new DBSpecialistExecutor({
    clickhouseTool: new ClickHouseTool(),
    codeSearchTool: new CodeSearchTool(),
    explainTool: {
      analyze: async ({ sql }: { sql: string }) => {
        const result = await explainTool.analyze({ sql }) as { rows?: Array<unknown> };

        return {
          plan_rows: result.rows ?? [],
          validated: true,
        };
      },
    },
    githubTool: new GitHubTool(),
    memoryTool,
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

async function ensureMemorySchema(pool: Pool): Promise<void> {
  if (!memorySchemaPromise) {
    memorySchemaPromise = readFile(
      fileURLToPath(new URL("../db/001_memory_schema.sql", import.meta.url)),
      "utf8",
    ).then(async (schemaSql) => {
      await pool.query(schemaSql);
    });
  }

  return memorySchemaPromise;
}
