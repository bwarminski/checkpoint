// ABOUTME: Resolves safe row-cap and timeout values for exploratory SQL tools.
// ABOUTME: Prevents callers from bypassing configured hard limits.
export function resolveQueryLimits(
  requested: { rowCap?: number; timeoutMs?: number },
  caps: { maxRows: number; maxTimeoutMs: number },
): { rowCap: number; timeoutMs: number } {
  return {
    rowCap: Math.min(requested.rowCap ?? caps.maxRows, caps.maxRows),
    timeoutMs: Math.min(requested.timeoutMs ?? caps.maxTimeoutMs, caps.maxTimeoutMs),
  };
}
