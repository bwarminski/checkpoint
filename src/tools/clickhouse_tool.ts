// ABOUTME: Defines the ClickHouse access point used by the DB specialist agent.
// ABOUTME: Exposes table discovery and guarded query execution for the executor.

export type TopOffender = {
  queryid: string;
  [key: string]: unknown;
};

type ClickHouseTransport = {
  query(sql: string): Promise<string>;
};

type ClickHouseToolOptions = {
  transport?: ClickHouseTransport;
};

export class ClickHouseTool {
  private readonly transport?: ClickHouseTransport;

  constructor(options: ClickHouseToolOptions = {}) {
    this.transport = options.transport ?? createHttpTransport();
  }

  async listTables(): Promise<Array<string>> {
    return [...SUPPORTED_TABLES];
  }

  async describeTable(table: string): Promise<string> {
    assertSupportedTable(table);

    return this.transport!.query(`DESCRIBE TABLE ${table} FORMAT TSV`);
  }

  async executeQuery(sql: string): Promise<string> {
    assertSupportedQuery(sql);

    return this.transport!.query(sql);
  }

  async queryFindings(scope?: unknown): Promise<Array<TopOffender>> {
    return parseOffenderRows(await this.executeQuery(buildOffenderQuery(scope)));
  }
}

const INTERVAL_AVG_EXEC_TIME_SQL =
  "round(if(sum(total_exec_count) = 0, 0, sum(delta_exec_time_ms) / sum(total_exec_count)), 2)";
const INTERVAL_SOURCE_LOCATION_SQL =
  "coalesce(argMax(postgres_logs.comment_metadata['source_location'], postgres_logs.log_timestamp), argMax(query_intervals.comment_metadata['source_location'], interval_ended_at))";

function buildOffenderQuery(scope?: unknown): string {
  const request = parseScope(scope);
  if (!request.allTime) {
    return buildWindowedQuery(request);
  }

  return [
    "SELECT",
    "  queryid,",
    "  argMax(query_intervals.statement_text, interval_ended_at) AS latest_statement_text,",
    `  ${INTERVAL_SOURCE_LOCATION_SQL} AS latest_source_location,`,
    "  sum(total_exec_count) AS call_count,",
    "  round(sum(delta_exec_time_ms), 2) AS total_exec_time_ms,",
    `  ${INTERVAL_AVG_EXEC_TIME_SQL} AS avg_exec_time_ms`,
    "FROM query_intervals",
    "LEFT JOIN postgres_logs",
    "  ON postgres_logs.query_id = query_intervals.queryid",
    "  AND postgres_logs.log_timestamp >= query_intervals.interval_started_at",
    "  AND postgres_logs.log_timestamp < query_intervals.interval_ended_at",
    "GROUP BY queryid",
    "ORDER BY total_exec_time_ms DESC",
    "LIMIT 5",
    "FORMAT TSVWithNames",
  ].join("\n");
}

function buildWindowedQuery(request: ScopeRequest): string {
  return [
    "SELECT",
    "  queryid,",
    "  argMax(query_intervals.statement_text, interval_ended_at) AS latest_statement_text,",
    `  ${INTERVAL_SOURCE_LOCATION_SQL} AS latest_source_location,`,
    "  sum(total_exec_count) AS call_count,",
    "  round(sum(delta_exec_time_ms), 2) AS total_exec_time_ms,",
    `  ${INTERVAL_AVG_EXEC_TIME_SQL} AS avg_exec_time_ms`,
    "FROM query_intervals",
    "LEFT JOIN postgres_logs",
    "  ON postgres_logs.query_id = query_intervals.queryid",
    "  AND postgres_logs.log_timestamp >= query_intervals.interval_started_at",
    "  AND postgres_logs.log_timestamp < query_intervals.interval_ended_at",
    `WHERE interval_started_at > now() - INTERVAL ${request.timeWindowMinutes} MINUTE`,
    `  AND interval_ended_at > now() - INTERVAL ${request.timeWindowMinutes} MINUTE`,
    `  AND interval_duration_ms <= ${request.timeWindowMinutes * 60 * 1000}`,
    "GROUP BY queryid",
    "ORDER BY total_exec_time_ms DESC",
    "LIMIT 5",
    "FORMAT TSVWithNames",
  ].join("\n");
}

type ScopeRequest = {
  allTime: boolean;
  tableName: string | null;
  timeWindowMinutes: number;
};

function parseScope(scope?: unknown): ScopeRequest {
  if (typeof scope !== "string") {
    return { allTime: false, tableName: null, timeWindowMinutes: 60 };
  }

  const tableMatch = scope.match(/^analyze_table\s+([a-z0-9_]+)/i);
  const minuteMatch = scope.match(/\b(\d+)\b/);

  return {
    allTime: /\ball\b/i.test(scope),
    tableName: tableMatch ? tableMatch[1].toLowerCase() : null,
    timeWindowMinutes: Number(minuteMatch?.[1] ?? 60),
  };
}

function parseOffenderRows(payload: string): Array<TopOffender> {
  const [headerLine, ...dataLines] = payload.trim().split("\n").filter(Boolean);
  if (!headerLine) {
    return [];
  }

  const headers = headerLine.split("\t");
  return dataLines.map((line) => {
    const values = line.split("\t");
    const row = Object.fromEntries(
      headers.map((header, index) => [header, normalizeValue(header, values[index])]),
    );
    const totalExecCount = Number(row.call_count ?? row.total_exec_count ?? 0);
    const avgExecTimeMs = Number(row.avg_exec_time_ms ?? 0);
    const totalExecTimeMs = Number(row.total_exec_time_ms ?? 0);

    return {
      avg_exec_time_ms: avgExecTimeMs,
      queryid: String(row.queryid ?? ""),
      severity: avgExecTimeMs >= 100 ? "high" : "medium",
      source_file: row.latest_source_location ?? "",
      statement_text: row.latest_statement_text ?? row.statement_text,
      total_exec_count: totalExecCount,
      total_exec_time_ms: totalExecTimeMs,
    };
  });
}

function normalizeValue(header: string, value: string | undefined): number | string | null {
  if (value === undefined || value === "\\N") {
    return null;
  }

  if (header !== "queryid" && /^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value.replace(/\\"/g, "\"").replace(/\\'/g, "'");
}

function escapeSqlLike(value: string): string {
  return value.replace(/'/g, "''");
}

function assertSupportedTable(table: string): void {
  if (!SUPPORTED_TABLES.has(table)) {
    throw new Error(`Unsupported ClickHouse table: ${table}`);
  }
}

function assertSupportedQuery(sql: string): void {
  const trimmed = sql.trim();

  if (!/^\s*select\b/i.test(trimmed)) {
    throw new Error("SELECT-only queries are allowed");
  }

  if (trimmed.includes(";")) {
    throw new Error("Only single statement SELECT queries are allowed");
  }

  const referencedTables = extractReferencedTables(trimmed);
  if (!referencedTables.length) {
    throw new Error("Raw queries must use supported ClickHouse tables");
  }

  const unsupportedTable = referencedTables.find((table) => !SUPPORTED_TABLES.has(table));
  if (unsupportedTable) {
    throw new Error(`Raw queries must use supported ClickHouse tables: ${unsupportedTable}`);
  }
}

function extractReferencedTables(sql: string): Array<string> {
  const matches = sql.matchAll(/\b(?:from|join)\s+([`"]?[a-zA-Z0-9_.]+[`"]?)/gi);
  const tables = new Set<string>();

  for (const match of matches) {
    const raw = match[1] ?? "";
    const normalized = normalizeTableName(raw);
    if (normalized) {
      tables.add(normalized);
    }
  }

  return [...tables];
}

function normalizeTableName(value: string): string {
  // TODO: db-qualified names like `other_db.query_events` pass the whitelist because only the
  // last segment is checked. Reject names containing a dot to close the bypass if untrusted SQL
  // sources are added in future.
  return value.replace(/[`"]/g, "").split(".").at(-1) ?? "";
}

function createHttpTransport(): ClickHouseTransport {
  const baseUrl = process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:8123";

  return {
    async query(sql: string): Promise<string> {
      const response = await fetch(`${baseUrl}/?query=${encodeURIComponent(sql)}`);

      if (!response.ok) {
        throw new Error(`ClickHouse query failed: ${response.status} ${response.statusText}`);
      }

      return response.text();
    },
  };
}

const SUPPORTED_TABLES = new Set([
  "query_events",
  "collector_state",
  "query_intervals",
  "postgres_logs",
  "postgres_log_state",
]);
