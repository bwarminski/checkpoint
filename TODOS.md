# TODOS

Deferred items from plan and eng review. Each item has a concrete scope and
a reason it was intentionally deferred rather than forgotten.

## Root package lockfile policy

**What:** Decide whether the repo root should track a `package-lock.json` and, if
so, commit the lockfile with a consistent install workflow. If not, document the
expected bootstrap command for fresh worktrees so baseline test setup does not
look like an unexpected repo change.

**Why deferred:** Creating this brainstorming worktree required a root `npm install`
before `npm test` could run, which generated an untracked `package-lock.json`.
That is easy to discard locally, but the repo should make the intended root
dependency workflow explicit instead of leaving each fresh checkout to rediscover
it.

## Security: ClickHouse bound to 0.0.0.0 with no auth

**What:** ClickHouse is exposed on `0.0.0.0:8123` and `0.0.0.0:9000` with no password
on the default user. Any host on the local network can query or write to ClickHouse.

**Fix:** Bind to loopback only in `docker-compose.yml`:
```yaml
ports:
  - "127.0.0.1:8123:8123"
  - "127.0.0.1:9000:9000"
```

**Why deferred:** Local demo only, not run on untrusted networks. Becomes a real risk
if the machine is on a shared/public network or if Docker host networking changes.

**Where:** `docker-compose.yml` clickhouse service. Confirmed by `/cso` audit 2026-04-05.

## SDK internal types: request exports or add shape validation

**What:** `ToolContext`, `SessionLike`, and `SessionEvent` in `test/helpers/oh_my_pi_workspace.ts`
are local structural types that mirror internal oh-my-pi SDK shapes. TypeScript structural
typing means a breaking SDK interface change would not produce a compile error — only a
runtime failure (likely in the live integration test, not in unit tests).

**Fix options:**
- Ask the oh-my-pi team to export these types from `@oh-my-pi/pi-coding-agent`
- Add a runtime shape-assertion test that validates the context object shape on session start

**Why deferred:** The live integration test (`npm run test:model-integration`) would catch
interface drift on any SDK upgrade. Low-frequency risk for a single-developer MVP.

**Where:** `test/helpers/oh_my_pi_workspace.ts` — `ToolContext`, `SessionLike`, `SessionEvent` types.

## pg_stat_monitor upgrade path

**What:** Evaluate `pg_stat_monitor` (Percona) as a drop-in replacement for
`pg_stat_statements`. It adds time buckets, plan capture, and richer grouping.

**Why deferred:** pg_stat_statements works for the demo. pg_stat_monitor requires
a Percona-packaged Postgres image (or manual extension build) and changes the
collector query surface.

**When to revisit:** After the demo proves the vertical slice works end-to-end.
