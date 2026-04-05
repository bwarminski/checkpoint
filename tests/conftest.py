# ABOUTME: Loads repo-root .env for pytest using only the Python standard library.
# ABOUTME: Preserves exported shell values and fills missing environment variables from .env.
import os
from pathlib import Path


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key, value)


load_env_file(Path(__file__).resolve().parents[1] / ".env")
