#!/usr/bin/env bash
# ABOUTME: Runs a manual live-provider validation against the local stack and A2A agent endpoint.
# ABOUTME: Seeds fixture ClickHouse data, sends a real message/stream request, and prints the completed result.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="$ROOT_DIR/agent"
CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://127.0.0.1:8123}"
AGENT_BASE_URL="${AGENT_BASE_URL:-http://127.0.0.1:3001}"
AGENT_HEALTH_URL="$AGENT_BASE_URL/health"
AGENT_JSONRPC_URL="$AGENT_BASE_URL/a2a/jsonrpc"

provider_key_env() {
  case "$1" in
    anthropic) echo "ANTHROPIC_API_KEY" ;;
    google) echo "GOOGLE_API_KEY" ;;
    ollama) echo "" ;;
    openai) echo "OPENAI_API_KEY" ;;
    *) echo "__UNSUPPORTED_PROVIDER__" ;;
  esac
}

skip_if_missing_provider_key() {
  local model_ref provider required_key
  model_ref="${LLM_MODEL:-}"
  if [[ -z "$model_ref" ]]; then
    echo "Skipping live validation: LLM_MODEL is not set."
    exit 0
  fi

  provider="${model_ref%%/*}"
  required_key="$(provider_key_env "$provider")"
  if [[ "$required_key" == "__UNSUPPORTED_PROVIDER__" ]]; then
    echo "Skipping live validation: no credential mapping is configured for provider '$provider'."
    exit 0
  fi
  if [[ -n "$required_key" && -z "${!required_key:-}" ]]; then
    echo "Skipping live validation: $required_key is not set for provider '$provider'."
    exit 0
  fi
}

run_clickhouse_query() {
  curl -fsS "$CLICKHOUSE_URL/?query=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1")" >/dev/null
}

seed_clickhouse_fixture() {
  run_clickhouse_query "TRUNCATE TABLE query_events"
  run_clickhouse_query "TRUNCATE TABLE collector_state"
  run_clickhouse_query "TRUNCATE TABLE postgres_logs"
  run_clickhouse_query "INSERT INTO query_events (collected_at, dbid, userid, toplevel, queryid, statement_text, comment_metadata, total_exec_count, total_exec_time_ms, rows_returned_or_affected, shared_blks_hit, shared_blks_read, local_blks_hit, local_blks_read, temp_blks_read, temp_blks_written, total_block_accesses, min_exec_time_ms, max_exec_time_ms, mean_exec_time_ms, stddev_exec_time_ms) VALUES (toDateTime64(now() - INTERVAL 1 MINUTE, 3), 1, 1, true, '101', 'SELECT * FROM todos', map('source_location', '/app/controllers/todos_controller.rb:12'), 5, 450, 10, 80, 20, 0, 0, 0, 0, 100, 70, 120, 90, 10), (toDateTime64(now(), 3), 1, 1, true, '101', 'SELECT * FROM todos', map('source_location', '/app/controllers/todos_controller.rb:12'), 7, 700, 15, 120, 30, 0, 0, 0, 0, 150, 80, 140, 110, 12)"
  run_clickhouse_query "INSERT INTO collector_state (collected_at, dealloc, stats_reset) SELECT collected_at, 0, now() - INTERVAL 10 MINUTE FROM query_events WHERE queryid = '101'"
  run_clickhouse_query "INSERT INTO postgres_logs (log_file, byte_offset, log_timestamp, query_id, statement_text, database, session_id, comment_metadata, raw_json) VALUES ('postgresql.json', 1, toDateTime64(now() - INTERVAL 30 SECOND, 3), '101', 'SELECT * FROM todos', 'checkpoint_demo', 'session-live-provider', map('application', 'checkpoint_demo'), '{\"message\":\"duration: 1.23 ms statement: SELECT * FROM todos\"}')"
}

wait_for_health() {
  local attempts=0
  until curl -fsS "$AGENT_HEALTH_URL" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [[ "$attempts" -ge 30 ]]; then
      echo "Agent health check failed at $AGENT_HEALTH_URL"
      exit 1
    fi
    sleep 1
  done
}

start_agent_if_needed() {
  if curl -fsS "$AGENT_HEALTH_URL" >/dev/null 2>&1; then
    return
  fi

  (
    cd "$AGENT_DIR"
    npm start >/tmp/checkpoint-agent-validate.log 2>&1
  ) &
  AGENT_PID=$!
  export AGENT_PID
  trap 'if [[ -n "${AGENT_PID:-}" ]]; then kill "$AGENT_PID" >/dev/null 2>&1 || true; fi' EXIT
  wait_for_health
}

send_a2a_request() {
  local response_file
  response_file="$(mktemp)"
  curl -fsS -X POST "$AGENT_JSONRPC_URL" \
    -H "content-type: application/json" \
    -d '{
      "jsonrpc":"2.0",
      "id":"validate-live-provider",
      "method":"message/stream",
      "params":{
        "message":{
          "kind":"message",
          "messageId":"validate-live-provider-message",
          "role":"user",
          "parts":[{"kind":"text","text":"analyze_db and use query_findings before answering"}]
        }
      }
    }' >"$response_file"

  python3 - "$response_file" <<'PY'
import json
import sys
from pathlib import Path

body = Path(sys.argv[1]).read_text().strip()
chunks = [chunk for chunk in body.split("\n\n") if chunk.strip()]
payloads = []
for chunk in chunks:
    data_lines = [line[len("data: "):] for line in chunk.splitlines() if line.startswith("data: ")]
    if data_lines:
        payloads.append(json.loads("\n".join(data_lines)))

results = [payload.get("result") for payload in payloads if payload.get("result")]
completed = results[-1] if results else None
if not completed or completed.get("status", {}).get("state") != "completed":
    raise SystemExit("Validation failed: missing completed A2A result")

data = completed["status"]["message"]["parts"][0]["data"]
tool_names = [item.get("toolName") for item in data.get("toolResults", [])]
if "query_findings" not in tool_names:
    raise SystemExit("Validation failed: query_findings was not observed in toolResults")

print("Observed tools:", ", ".join(tool_names))
print("Agent response:")
print(data.get("response", "").strip())
PY

  rm -f "$response_file"
}

main() {
  skip_if_missing_provider_key
  cd "$ROOT_DIR"
  docker compose up -d
  seed_clickhouse_fixture
  start_agent_if_needed
  send_a2a_request
}

main "$@"
