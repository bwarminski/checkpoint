# ABOUTME: Verifies the local DB specialist scaffold exists at the repo root.
# ABOUTME: Guards the compose runtime prerequisites for the demo and collector stack.
import os
from pathlib import Path
import subprocess


def _demo_root() -> Path:
    """Return the demo app root from DEMO_APP_ROOT env var."""
    demo_app_root = os.environ.get("DEMO_APP_ROOT")
    assert demo_app_root, "DEMO_APP_ROOT must be set to run demo scaffold tests"
    return Path(demo_app_root)


def test_compose_and_postgres_scaffold_exist():
    root = Path(__file__).resolve().parents[2]
    assert (root / "docker-compose.yml").exists()
    assert (root / "postgres" / "Dockerfile").exists()
    assert (root / "postgres" / "init" / "01-extensions.sql").exists()
    assert (root / "JOURNAL.md").exists()
    assert (
        "      - ./postgres/init:/docker-entrypoint-initdb.d:ro"
        in (root / "docker-compose.yml").read_text()
    )


def test_runtime_stack_defines_demo_collector_and_postgres_demo_db():
    root = Path(__file__).resolve().parents[2]

    compose_config = subprocess.run(
        ["docker", "compose", "config"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout

    assert "demo:" in compose_config
    assert "collector:" in compose_config
    assert "postgresql" in (_demo_root() / "config" / "database.yml").read_text()


def test_demo_runtime_declares_server_gem():
    assert 'gem "puma"' in (_demo_root() / "Gemfile").read_text()


def test_runtime_stack_includes_demo_rackup_file_and_clickhouse_user_config():
    root = Path(__file__).resolve().parents[2]
    compose_text = (root / "docker-compose.yml").read_text()

    assert (_demo_root() / "config.ru").exists()
    assert (root / "clickhouse" / "users.d" / "default-user.xml").exists()
    assert "./clickhouse/users.d:/etc/clickhouse-server/users.d:ro" in compose_text
