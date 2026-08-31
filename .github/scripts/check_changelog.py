#!/usr/bin/env python3
"""Fail if CHANGELOG.md has no Keep a Changelog section for package.json's version."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

PACKAGE_JSON = Path("package.json")
CHANGELOG = Path("CHANGELOG.md")


def read_version(text: str) -> str | None:
    """Return the ``version`` string from package.json source."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    version = data.get("version")
    return version if isinstance(version, str) and version else None


def main() -> int:
    """Require a ``## [version]`` heading that matches package.json."""
    version = read_version(PACKAGE_JSON.read_text(encoding="utf-8"))
    if version is None:
        print(f"Could not parse version from {PACKAGE_JSON}", file=sys.stderr)
        return 1
    if not CHANGELOG.is_file():
        print(f"Missing {CHANGELOG}", file=sys.stderr)
        return 1
    heading = re.compile(rf"^## \[{re.escape(version)}\]", re.MULTILINE)
    if heading.search(CHANGELOG.read_text(encoding="utf-8")) is None:
        print(
            f"{CHANGELOG} has no '## [{version}]' section for package.json",
            file=sys.stderr,
        )
        return 1
    print(version)
    return 0


if __name__ == "__main__":
    sys.exit(main())
