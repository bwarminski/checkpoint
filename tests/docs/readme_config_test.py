import importlib.util
import os
from pathlib import Path


def test_readme_lists_demo_repo_configuration_variables():
    text = Path("README.md").read_text()

    assert "scripts/setup-oh-my-pi-workspace.sh" in text
    assert "scripts/reset-oh-my-pi-workspace.sh" in text
    assert "~/.oh-my-pi-workspaces/checkpoint" in text


def test_readme_documents_demo_setup_and_reset():
    text = Path("README.md").read_text()

    assert "## Manual TUI Loop" in text
    assert 'pi --model "$OMP_MODEL"' in text
    assert "scripts/workspace-smoke.sh" in text


def test_readme_documents_provider_agnostic_llm_model_contract():
    text = Path("README.md").read_text()

    assert "npm run test:model-integration" in text
    assert "OMP_MODEL" in text
    assert "OH_MY_PI_COMMAND" in text


def test_readme_documents_manual_validation_harness():
    text = Path("README.md").read_text()

    assert "checkpoint-postgres:local" in text
    assert "checkpoint-clickhouse:local" in text
    assert "scripts/validate.sh" not in text


def test_pytest_env_loader_preserves_shell_values(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("DEMO_REPO=file/value\nDEMO_BASE_REF=main\n")

    monkeypatch.setenv("DEMO_REPO", "shell/value")
    monkeypatch.delenv("DEMO_BASE_REF", raising=False)

    conftest = load_conftest_module()
    conftest.load_env_file(env_file)

    assert os.environ["DEMO_REPO"] == "shell/value"
    assert os.environ["DEMO_BASE_REF"] == "main"


def test_pytest_env_loader_uses_simple_split_and_skips_comments(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "# comment\n"
        "\n"
        "A=one=two\n"
        "B=plain value\n"
    )

    monkeypatch.delenv("A", raising=False)
    monkeypatch.delenv("B", raising=False)

    conftest = load_conftest_module()
    conftest.load_env_file(env_file)

    assert os.environ["A"] == "one=two"
    assert os.environ["B"] == "plain value"


def load_conftest_module():
    path = Path(__file__).resolve().parents[1] / "conftest.py"
    spec = importlib.util.spec_from_file_location("conftest", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module
