// ABOUTME: Defines the ClickHouse access point used by the DB specialist agent.
// ABOUTME: Keeps offender lookups isolated from executor orchestration logic.
export type TopOffender = {
  fingerprint: string;
  [key: string]: unknown;
};

type ClickHouseTransport = {
  query(sql: string): Promise<string>;
};

type ClickHouseReader = {
  topOffenders(scope?: unknown): Promise<Array<TopOffender>>;
};

type ClickHouseToolOptions = {
  transport?: ClickHouseTransport;
};

export class ClickHouseTool {
  private readonly transport?: ClickHouseTransport;

  constructor(
    private readonly reader?: ClickHouseReader,
    options: ClickHouseToolOptions = {},
  ) {
    this.transport = options.transport ?? createHttpTransport();
  }

  async topOffenders(scope?: unknown): Promise<Array<TopOffender>> {
    if (this.reader) {
      return this.reader.topOffenders(scope);
    }

    if (!this.transport) {
      return [];
    }

    const rows = await this.transport.query(buildTopOffendersQuery(scope));
    return parseRows(rows);
  }
}

function buildTopOffendersQuery(scope?: unknown): string {
  const request = parseScope(scope);
  if (!request.allTime) {
    return buildWindowedQuery(request);
  }

  const conditions = ["source_tag IS NOT NULL"];

  if (request.tableName) {
    conditions.push(`source_tag ILIKE '${escapeSqlLike(request.tableName)}#%'`);
  }

  return [
    "SELECT",
    "  fingerprint,",
    "  source_tag,",
    "  tupleElement(argMaxMerge(representative_state), 1) AS source_file,",
    "  tupleElement(argMaxMerge(representative_state), 2) AS sample_query,",
    "  sumMerge(total_exec_count_state) AS total_exec_count,",
    "  sumMerge(total_exec_time_ms_state) AS total_exec_time_ms,",
    "  round(quantileMerge(0.95)(p95_exec_time_state), 2) AS p95_exec_time_ms",
    "FROM query_fingerprints",
    `WHERE ${conditions.join(" AND ")}`,
    "GROUP BY fingerprint, source_tag",
    "ORDER BY total_exec_time_ms DESC",
    "LIMIT 5",
    "FORMAT TSVWithNames",
  ].join("\n");
}

function buildWindowedQuery(request: ScopeRequest): string {
  const conditions = [
    `collected_at > now() - INTERVAL ${request.timeWindowMinutes} MINUTE`,
    "source_tag IS NOT NULL",
  ];
  if (request.tableName) {
    conditions.push(`source_tag ILIKE '${escapeSqlLike(request.tableName)}#%'`);
  }

  return [
    "SELECT",
    "  fingerprint,",
    "  source_tag,",
    "  tupleElement(argMax((source_file, sample_query), collected_at), 1) AS source_file,",
    "  tupleElement(argMax((source_file, sample_query), collected_at), 2) AS sample_query,",
    "  sum(total_exec_count) AS call_count,",
    "  round(sum(total_exec_count * mean_exec_time_ms), 2) AS total_exec_time_ms,",
    "  round(quantile(0.95)(mean_exec_time_ms), 2) AS p95_exec_time_ms",
    "FROM query_events",
    `WHERE ${conditions.join(" AND ")}`,
    "GROUP BY fingerprint, source_tag",
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

function parseRows(payload: string): Array<TopOffender> {
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
    const p95ExecTimeMs = Number(row.p95_exec_time_ms ?? 0);
    const totalExecTimeMs = Number(row.total_exec_time_ms ?? 0);

    return {
      fingerprint: String(row.fingerprint ?? ""),
      p95_exec_time_ms: p95ExecTimeMs,
      sample_query: row.sample_query,
      severity: p95ExecTimeMs >= 100 ? "high" : "medium",
      source_file: row.source_file,
      source_tag: row.source_tag,
      total_exec_count: totalExecCount,
      total_exec_time_ms: totalExecTimeMs,
    };
  });
}

function normalizeValue(header: string, value: string | undefined): number | string | null {
  if (value === undefined || value === "\\N") {
    return null;
  }

  if (header !== "fingerprint" && /^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value.replace(/\\"/g, "\"").replace(/\\'/g, "'");
}

function escapeSqlLike(value: string): string {
  return value.replace(/'/g, "''");
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
