# ABOUTME: Boots the slim checkpoint ClickHouse service and validates the schema loads.
# ABOUTME: Guards the collector-owned image against DDL regressions that text tests can miss.
import json
import subprocess
import time

import pytest


def image_exists(image: str) -> bool:
    result = subprocess.run(
        ["docker", "image", "inspect", image],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0


def test_clickhouse_image_boots_and_loads_counter_schema():
    if not image_exists("checkpoint-clickhouse:local"):
        pytest.skip("checkpoint-clickhouse:local is not built")

    container_name = f"checkpoint-clickhouse-smoke-{int(time.time() * 1000)}"

    subprocess.run(
        ["docker", "run", "-d", "--name", container_name, "checkpoint-clickhouse:local"],
        check=True,
        capture_output=True,
        text=True,
    )
    try:
        for _ in range(30):
            inspect = subprocess.run(
                ["docker", "inspect", "--format", "{{json .State}}", container_name],
                check=True,
                capture_output=True,
                text=True,
            )
            state = json.loads(inspect.stdout)
            status = state.get("Status", "") if isinstance(state, dict) else ""
            health = ""
            if isinstance(state, dict) and isinstance(state.get("Health"), dict):
                health = state["Health"].get("Status", "")
            if status and status != "running":
                logs = subprocess.run(
                    ["docker", "logs", container_name],
                    check=True,
                    capture_output=True,
                    text=True,
                ).stdout
                raise AssertionError(f"clickhouse container entered state {status!r}\n{logs}")
            if health == "healthy" or (not health and clickhouse_ready(container_name)):
                break
            time.sleep(1)
        else:
            raise AssertionError("clickhouse did not become healthy")

        tables = subprocess.run(
            ["docker", "exec", container_name, "clickhouse-client", "--query", "SHOW TABLES"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.splitlines()

        assert "query_events" in tables
        assert "collector_state" in tables
        assert "query_intervals" in tables
        assert "postgres_logs" in tables
        assert "postgres_log_state" in tables

        query_intervals_schema = subprocess.run(
            [
                "docker",
                "exec",
                container_name,
                "clickhouse-client",
                "--query",
                "DESCRIBE TABLE query_intervals FORMAT TSV",
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        query_events_schema = subprocess.run(
            [
                "docker",
                "exec",
                container_name,
                "clickhouse-client",
                "--query",
                "DESCRIBE TABLE query_events FORMAT TSV",
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        postgres_logs_schema = subprocess.run(
            [
                "docker",
                "exec",
                container_name,
                "clickhouse-client",
                "--query",
                "DESCRIBE TABLE postgres_logs FORMAT TSV",
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout

        assert "comment_metadata\tMap" in query_intervals_schema
        assert "comment_metadata\tMap" in query_events_schema
        assert "comment_metadata\tMap" in postgres_logs_schema
        assert "source_file" not in query_events_schema
        assert "source_file" not in query_intervals_schema
        assert "source_location" not in postgres_logs_schema

        interval_query = subprocess.run(
            ["docker", "exec", container_name, "clickhouse-client", "--query", "SELECT count() FROM query_intervals"],
            check=True,
            capture_output=True,
            text=True,
        )
        assert interval_query.stdout.strip() == "0"
    finally:
        subprocess.run(["docker", "rm", "-f", container_name], check=False, capture_output=True, text=True)


def clickhouse_ready(container_name: str) -> bool:
    result = subprocess.run(
        ["docker", "exec", container_name, "clickhouse-client", "--query", "SELECT 1"],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and result.stdout.strip() == "1"
