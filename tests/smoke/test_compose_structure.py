# ABOUTME: Verifies the local DB specialist scaffold exists at the repo root.
# ABOUTME: Guards the split checkpoint compose contract and sibling collector repo.
import os
from pathlib import Path


def _demo_root() -> Path:
    """Return the demo app root from DEMO_APP_ROOT env var."""
    demo_app_root = os.environ.get("DEMO_APP_ROOT")
    assert demo_app_root, "DEMO_APP_ROOT must be set to run demo scaffold tests"
    return Path(demo_app_root)


def test_compose_and_journal_scaffold_exist():
    root = Path(__file__).resolve().parents[2]
    assert (root / "docker-compose.yml").exists()
    assert (root / "JOURNAL.md").exists()


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


def test_compose_uses_local_split_images_for_postgres_and_clickhouse():
    root = Path(__file__).resolve().parents[2]
    compose_text = (root / "docker-compose.yml").read_text()

    assert "image: checkpoint-postgres:local" in compose_text
    assert "image: checkpoint-clickhouse:local" in compose_text
    assert "./postgres" not in compose_text
    assert "./collector" not in compose_text


def test_compose_no_longer_defines_local_collector_pipeline_services():
    root = Path(__file__).resolve().parents[2]
    compose_text = (root / "docker-compose.yml").read_text()

    assert "collector:" not in compose_text
    assert "redpanda:" not in compose_text
    assert "demo:" not in compose_text
