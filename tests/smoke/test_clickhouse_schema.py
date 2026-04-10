# ABOUTME: Boots the slim checkpoint ClickHouse service and validates the schema loads.
# ABOUTME: Guards the collector-owned image against DDL regressions that text tests can miss.
import json
from pathlib import Path
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

    root = Path(__file__).resolve().parents[2]

    subprocess.run(["docker", "compose", "up", "-d", "clickhouse"], cwd=root, check=True)
    try:
        for _ in range(30):
            ps = subprocess.run(
                ["docker", "compose", "ps", "--format", "json", "clickhouse"],
                cwd=root,
                check=True,
                capture_output=True,
                text=True,
            )
            if not ps.stdout.strip():
                logs = subprocess.run(
                    ["docker", "compose", "logs", "clickhouse"],
                    cwd=root,
                    check=True,
                    capture_output=True,
                    text=True,
                ).stdout
                raise AssertionError(f"clickhouse container disappeared before becoming healthy\n{logs}")

            container = json.loads(ps.stdout)
            health = container.get("Health", "") if isinstance(container, dict) else ""
            state = container.get("State", "") if isinstance(container, dict) else ""
            if state and state != "running":
                logs = subprocess.run(
                    ["docker", "compose", "logs", "clickhouse"],
                    cwd=root,
                    check=True,
                    capture_output=True,
                    text=True,
                ).stdout
                raise AssertionError(f"clickhouse container entered state {state!r}\n{logs}")
            if health == "healthy":
                break
            time.sleep(1)
        else:
            raise AssertionError("clickhouse did not become healthy")

        tables = subprocess.run(
            ["docker", "compose", "exec", "-T", "clickhouse", "clickhouse-client", "--query", "SHOW TABLES"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.splitlines()

        assert "query_events" in tables
        assert "collector_state" in tables
        assert "query_intervals" in tables

        interval_query = subprocess.run(
            ["docker", "compose", "exec", "-T", "clickhouse", "clickhouse-client", "--query", "SELECT count() FROM query_intervals"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
        assert interval_query.stdout.strip() == "0"
    finally:
        subprocess.run(["docker", "compose", "down"], cwd=root, check=True)
