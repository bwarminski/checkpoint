import importlib.util
import os
from pathlib import Path


def test_readme_lists_demo_repo_configuration_variables():
    text = Path("README.md").read_text()

    assert "DEMO_APP_ROOT" in text
    assert "DEMO_REPO" in text
    assert "DEMO_BASE_REF" in text
    assert "GITHUB_TOKEN" in text
    assert "DEMO_HEAD_REF" not in text


def test_readme_documents_demo_setup_and_reset():
    text = Path("README.md").read_text()

    assert "## Demo setup" in text
    assert "push access" in text
    assert "reset" in text.lower()


def test_readme_documents_provider_agnostic_llm_model_contract():
    text = Path("README.md").read_text()

    assert "LLM_MODEL" in text
    assert "provider-agnostic" in text
    assert "OPENAI_API_KEY" in text
    assert "ANTHROPIC_API_KEY" in text


def test_readme_documents_manual_validation_harness():
    text = Path("README.md").read_text()

    assert "scripts/validate.sh" in text
    assert "message/stream" in text


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
