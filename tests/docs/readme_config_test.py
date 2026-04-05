from pathlib import Path


def test_readme_lists_demo_repo_configuration_variables():
    text = Path("README.md").read_text()

    assert "DEMO_APP_ROOT" in text
    assert "DEMO_REPO" in text
    assert "DEMO_BASE_REF" in text
    assert "DEMO_HEAD_REF" in text
    assert "GITHUB_TOKEN" in text


def test_readme_documents_demo_setup_and_reset():
    text = Path("README.md").read_text()

    assert "## Demo setup" in text
    assert "push access" in text
    assert "reset" in text.lower()
