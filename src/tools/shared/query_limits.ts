// ABOUTME: Resolves safe row-cap and timeout values for exploratory SQL tools.
// ABOUTME: Prevents callers from bypassing configured hard limits.
export function resolveQueryLimits(
  requested: { rowCap?: number; timeoutMs?: number },
  caps: { maxRows: number; maxTimeoutMs: number },
): { rowCap: number; timeoutMs: number } {
  return {
    rowCap: normalizeLimit(requested.rowCap, caps.maxRows),
    timeoutMs: normalizeLimit(requested.timeoutMs, caps.maxTimeoutMs),
  };
}

function normalizeLimit(value: number | undefined, cap: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return cap;
  }

  return Math.min(cap, Math.floor(value));
}
