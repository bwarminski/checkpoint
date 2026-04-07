# ABOUTME: Verifies the rendered checkpoint compose contract.
# ABOUTME: Guards the slim split-image compose contract and repo layout after the collector split.
import json
from pathlib import Path
import subprocess


def test_compose_renders_only_the_slim_split_image_services():
    root = Path(__file__).resolve().parents[2]
    compose_config = json.loads(
        subprocess.run(
            ["docker", "compose", "config", "--format", "json"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )

    services = compose_config["services"]

    assert set(services) == {"clickhouse", "postgres"}
    assert services["postgres"]["image"] == "checkpoint-postgres:local"
    assert services["clickhouse"]["image"] == "checkpoint-clickhouse:local"
    assert "build" not in services["postgres"]
    assert "build" not in services["clickhouse"]


def test_checkpoint_repo_layout_no_longer_contains_collector_owned_assets():
    root = Path(__file__).resolve().parents[2]

    assert not (root / "collector").exists()
    assert not (root / "postgres").exists()
    assert not (root / "load").exists()
    assert not (root / "clickhouse" / "users.d").exists()
