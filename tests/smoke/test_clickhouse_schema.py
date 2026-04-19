# ABOUTME: Boots the slim checkpoint ClickHouse service and validates the schema loads.
# ABOUTME: Guards the collector-owned image against DDL regressions that text tests can miss.
import json
import subprocess
import time

import pytest

EXPECTED_COLLECTOR_TABLES = {
    "collector_state",
    "postgres_log_state",
    "postgres_logs",
    "query_events",
    "query_intervals",
}


def image_exists(image: str) -> bool:
    result = subprocess.run(
        ["docker", "image", "inspect", image],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0


def run_clickhouse_query(
    container_name: str,
    query: str,
    retries: int = 5,
    delay_seconds: float = 1.0,
) -> str:
    last_error = ""
    for attempt in range(retries):
        result = subprocess.run(
            ["docker", "exec", container_name, "clickhouse-client", "--query", query],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            return result.stdout

        last_error = result.stderr.strip()
        if attempt < retries - 1:
            time.sleep(delay_seconds)

    raise AssertionError(
        f"clickhouse query failed after {retries} attempts: {query}\n{last_error}"
    )


def assert_collector_schema(
    tables: list[str],
    query_intervals_schema: str,
    query_events_schema: str,
    postgres_logs_schema: str,
) -> None:
    assert "query_events" in tables
    assert "collector_state" in tables
    assert "query_intervals" in tables
    assert "postgres_logs" in tables
    assert "postgres_log_state" in tables
    assert "comment_metadata\tMap" in query_intervals_schema
    assert "comment_metadata\tMap" in query_events_schema
    assert "comment_metadata\tMap" in postgres_logs_schema
    assert "source_file" not in query_events_schema
    assert "source_file" not in query_intervals_schema
    assert "source_file" not in postgres_logs_schema


def collector_schema_tables_ready(tables: list[str]) -> bool:
    return EXPECTED_COLLECTOR_TABLES.issubset(set(tables))


def wait_for_collector_schema_tables(
    container_name: str,
    retries: int = 30,
    delay_seconds: float = 1.0,
) -> list[str]:
    last_tables: list[str] = []
    last_error = ""
    for attempt in range(retries):
        result = subprocess.run(
            ["docker", "exec", container_name, "clickhouse-client", "--query", "SHOW TABLES"],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            tables = result.stdout.splitlines()
            if collector_schema_tables_ready(tables):
                return tables
            last_tables = tables
        else:
            last_error = result.stderr.strip()

        if attempt < retries - 1:
            time.sleep(delay_seconds)

    details = "\n".join(last_tables) if last_tables else last_error
    raise AssertionError(
        "collector schema did not become ready after "
        f"{retries} attempts:\n{details}"
    )


def test_collector_schema_rejects_legacy_source_file_columns():
    with pytest.raises(AssertionError):
        assert_collector_schema(
            [
                "query_events",
                "collector_state",
                "query_intervals",
                "postgres_logs",
                "postgres_log_state",
            ],
            "comment_metadata\tMap(String, String)\n",
            "comment_metadata\tMap(String, String)\n",
            "comment_metadata\tMap(String, String)\nsource_file\tString\n",
        )


def test_collector_schema_tables_require_expected_tables():
    assert not collector_schema_tables_ready([])
    assert not collector_schema_tables_ready(["query_events"])
    assert not collector_schema_tables_ready(["query_events", "collector_state"])
    assert collector_schema_tables_ready(
        [
            "collector_state",
            "postgres_log_state",
            "postgres_logs",
            "query_events",
            "query_intervals",
        ]
    )


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

        tables = wait_for_collector_schema_tables(container_name)
        query_intervals_schema = run_clickhouse_query(
            container_name, "DESCRIBE TABLE query_intervals FORMAT TSV"
        )
        query_events_schema = run_clickhouse_query(
            container_name, "DESCRIBE TABLE query_events FORMAT TSV"
        )
        postgres_logs_schema = run_clickhouse_query(
            container_name, "DESCRIBE TABLE postgres_logs FORMAT TSV"
        )

        assert_collector_schema(
            tables, query_intervals_schema, query_events_schema, postgres_logs_schema
        )
        assert run_clickhouse_query(
            container_name, "SELECT count() FROM query_intervals"
        ).strip() == "0"
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
