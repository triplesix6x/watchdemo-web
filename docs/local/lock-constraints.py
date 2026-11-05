"""Extract version constraints from the authoritative backend Poetry lock."""
from pathlib import Path
import tomllib

root = Path(__file__).resolve().parents[2]
lock = tomllib.loads((root / "web/poetry.lock").read_text())
Path(__file__).with_name("constraints.txt").write_text(
    "# Generated from web/poetry.lock.\n" + "".join(
        "{name}=={version}\n".format(**package) for package in lock["package"]
    )
)
