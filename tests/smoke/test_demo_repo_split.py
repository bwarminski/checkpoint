from pathlib import Path


def test_demo_app_root_is_declared_in_env_example():
    text = Path(".env.example").read_text()
    assert "DEMO_APP_ROOT=/home/bjw/db-specialist-demo" in text


def test_compose_uses_demo_app_root_for_demo_service():
    text = Path("docker-compose.yml").read_text()
    assert "${DEMO_APP_ROOT:" in text
    assert "./demo" not in text
