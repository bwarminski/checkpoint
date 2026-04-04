# JOURNAL

- 2026-04-03: Initialized repo skeleton plan execution journal.
- 2026-04-03: Added the Task 1 scaffold for docker compose, Postgres bootstrap SQL, and service package files.
- 2026-04-03: Used a minimal valid `agent/package.json` because JSON does not support comments.
- 2026-04-03: Installed `python3-pytest` via `apt-get` so the required smoke test could run in this environment.
- 2026-04-03: Verified `docker compose config` renders the compose file without syntax errors.
- 2026-04-03: Mounted `postgres/init` into `/docker-entrypoint-initdb.d` so the bootstrap SQL runs in the Postgres container.
- 2026-04-03: Switched the smoke test to derive the repo root from the test file location.
- 2026-04-03: Added `shared_preload_libraries=pg_stat_statements` to the Postgres service command so the extension bootstrap is viable on first startup.
- 2026-04-03: Strengthened the smoke test to assert the exact init bind mount entry.
