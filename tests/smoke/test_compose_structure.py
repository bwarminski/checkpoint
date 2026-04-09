# ABOUTME: Verifies the rendered checkpoint compose contract.
# ABOUTME: Guards the slim split-image compose contract and repo layout after the collector split.
import json
import os
from pathlib import Path
import subprocess

COLLECTOR_ROOT = Path(
    os.environ.get("COLLECTOR_ROOT", str(Path(__file__).resolve().parents[3] / "checkpoint-collector"))
)


def test_compose_renders_the_split_image_services_and_demo_mount():
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
    demo_root = "/home/bjw/db-specialist-demo"

    assert set(services) == {"clickhouse", "demo", "postgres"}
    assert services["postgres"]["image"] == "checkpoint-postgres:local"
    assert services["clickhouse"]["image"] == "checkpoint-clickhouse:local"
    assert services["demo"]["image"] == "ruby:3.3"
    assert services["demo"]["volumes"] == [
        {
            "type": "bind",
            "source": demo_root,
            "target": "/app",
            "bind": {},
        }
    ]
    assert services["demo"]["command"] == ["sleep", "infinity"]
    assert "build" not in services["postgres"]
    assert "build" not in services["clickhouse"]


def test_checkpoint_repo_layout_no_longer_contains_collector_owned_assets():
    root = Path(__file__).resolve().parents[2]

    assert not (root / "collector").exists()
    assert not (root / "postgres").exists()
    assert not (root / "load").exists()
    assert not (root / "clickhouse" / "users.d").exists()
    assert COLLECTOR_ROOT.exists()
