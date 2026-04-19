// ABOUTME: Guards identifier inputs against SQL injection in tool name parameters.
// ABOUTME: Shared by Postgres and ClickHouse tools that interpolate schema or table names.

export function assertIdentifierLike(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}
