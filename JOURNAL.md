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
- 2026-04-04: Built the minimal Rails demo app for Task 2 with todo routes, controller actions, models, schema, seeds, and controller integration coverage.
- 2026-04-04: Added the smallest extra Rails support files not listed in the plan so `bundle exec rails test` and `bundle exec rails db:setup` can run: `config/boot.rb`, `config/environment.rb`, `config/environments/test.rb`, `config/database.yml`, `app/controllers/application_controller.rb`, `app/models/application_record.rb`, `test/test_helper.rb`, `bin/rails`, `Rakefile`, and `demo/.gitignore`.
- 2026-04-04: Loaded `db/schema.rb` and seeds from `demo/test/test_helper.rb` because the approved Task 2 test expects rows in the response body without creating fixtures in the test itself.
- 2026-04-04: Pinned `minitest` to `~> 5.25` because Rails 7.1.6 resolved against Minitest 6 in this environment and the Rails test runner failed with an argument mismatch.
- 2026-04-04: Changed `/todos/stats` to key its JSON response by stringified user IDs so the payload shape is stable across renders.
- 2026-04-04: Strengthened the Task 2 controller test to parse JSON and assert row counts, filtered results, `/todos/status`, and `/todos/stats` response shape directly.
