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


def test_compose_and_journal_scaffold_exist():
    root = Path(__file__).resolve().parents[2]
    assert (root / "docker-compose.yml").exists()
    assert (root / "JOURNAL.md").exists()


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


def test_runtime_stack_includes_demo_rackup_file():
    root = Path(__file__).resolve().parents[2]

    assert (_demo_root() / "config.ru").exists()


def test_collector_repo_exists_as_a_sibling_git_repo():
    root = Path(__file__).resolve().parents[2]
    collector_root = root.parent / "checkpoint-collector"

    assert collector_root.exists()
    assert (collector_root / ".git").exists()
    assert (collector_root / "VERSION").exists()
    assert (collector_root / "collector" / "Dockerfile").exists()
    assert (collector_root / "postgres" / "Dockerfile").exists()
    assert (collector_root / "docker-compose.yml").exists()


def test_collector_repo_bootstraps_clickhouse_schema_for_local_run():
    root = Path(__file__).resolve().parents[2]
    collector_root = root.parent / "checkpoint-collector"

    compose_text = (collector_root / "docker-compose.yml").read_text()

    assert "./collector/db/clickhouse:/docker-entrypoint-initdb.d:ro" in compose_text


def test_repo_no_longer_owns_the_collector_source_of_truth():
    root = Path(__file__).resolve().parents[2]

    assert not (root / "collector").exists()
    assert not (root / "postgres").exists()
    assert not (root / "load").exists()
    assert not (root / "clickhouse" / "users.d").exists()
    assert not (root / "VERSION").exists()
