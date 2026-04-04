# ABOUTME: Verifies the local DB specialist scaffold exists at the repo root.
# ABOUTME: Guards the initial compose and Postgres bootstrap files for Task 1.
from pathlib import Path


def test_compose_and_postgres_scaffold_exist():
    root = Path(__file__).resolve().parents[2]
    assert (root / "docker-compose.yml").exists()
    assert (root / "postgres" / "Dockerfile").exists()
    assert (root / "postgres" / "init" / "01-extensions.sql").exists()
    assert (root / "JOURNAL.md").exists()
    assert "docker-entrypoint-initdb.d" in (root / "docker-compose.yml").read_text()
