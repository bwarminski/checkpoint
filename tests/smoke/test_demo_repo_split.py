from pathlib import Path


def test_demo_app_root_is_declared_in_env_example():
    text = Path(".env.example").read_text()
    assert "DEMO_APP_ROOT=/home/bjw/db-specialist-demo" in text


def test_compose_uses_demo_app_root_for_demo_service():
    text = Path("docker-compose.yml").read_text()
    assert "${DEMO_APP_ROOT:" in text
    assert "./demo" not in text


def test_env_example_documents_provider_agnostic_llm_model():
    text = Path(".env.example").read_text()
    assert "LLM_MODEL=" in text
    assert "OPENAI_API_KEY" in text
    assert "DEMO_HEAD_REF" not in text


def test_workspace_smoke_script_replaces_removed_validate_script():
    assert not Path("scripts/validate.sh").exists()

    text = Path("scripts/workspace-smoke.sh").read_text()
    assert "OMP_MODEL" in text
    assert 'pi --model "\\$OMP_MODEL"' in text
