# ABOUTME: Loads repo-root .env for pytest using only the Python standard library.
# ABOUTME: Preserves exported shell values and fills missing environment variables from .env.
import os
import re
from pathlib import Path


LINE_RE = re.compile(
    r"(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|\s*:\s+?)(\s*'(?:\\'|[^'])*'|\s*\"(?:\\\"|[^\"])*\"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)",
    re.M,
)


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
    match = LINE_RE.match(line.replace("\r", ""))
    if match is None:
        return None

    key = match.group(1)
    value = (match.group(2) or "").strip()
    if value:
        maybe_quote = value[0]
        value = re.sub(r"^(['\"`])([\s\S]*)\1$", r"\2", value)
        if maybe_quote == '"':
            value = value.replace("\\n", "\n").replace("\\r", "\r")

    return key, value


load_env_file(Path(__file__).resolve().parents[1] / ".env")
