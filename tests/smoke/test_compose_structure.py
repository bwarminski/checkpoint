# ABOUTME: Verifies the rendered checkpoint compose contract.
# ABOUTME: Guards the slim split-image stack used in Task 2.
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
