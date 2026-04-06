# ABOUTME: Loads repo-root .env for pytest using only the Python standard library.
# ABOUTME: Preserves exported shell values and fills missing environment variables from .env.
import os
from pathlib import Path


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for line in path.read_text().splitlines():
        parsed = parse_env_line(line)
        if parsed is None:
            continue
        key, value = parsed
        os.environ.setdefault(key, value)


def parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None

    if "=" not in stripped:
        return None

    key, value = stripped.split("=", 1)
    return key.strip(), value.strip()


load_env_file(Path(__file__).resolve().parents[1] / ".env")
