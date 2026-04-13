// ABOUTME: Renders bounded SQL query results into deterministic plain text.
// ABOUTME: Gives coarse SQL tools a readable text contract instead of raw rows.

export function formatQueryResult(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "(no rows)";
  }

  const columns = Object.keys(rows[0] ?? {});
  const header = columns.join(" | ");
  const body = rows.map((row) =>
    columns.map((column) => formatValue(row[column])).join(" | ")
  );

  return [header, ...body].join("\n");
}

function formatValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}
