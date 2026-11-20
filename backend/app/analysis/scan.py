import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sys

from ..project_import import read_project
from .advisories import load_advisories
from .registry import register_analysis_handlers


ROOT = Path(__file__).resolve().parents[3]
CATALOG = ROOT / "docs" / "training-advisories.json"


def analyze_archive(path, advisories):
    with path.open("rb") as stream:
        from ..project_import import MAX_UPLOAD
        snapshot = read_project(stream.read(MAX_UPLOAD + 1), "ci")
    return {row.id: asdict(row) for name, handler in register_analysis_handlers(advisories).items()
            for row in handler(snapshot, name)}


def main():
    parser = argparse.ArgumentParser(description="Defensive scan of a training Kotlin ZIP")
    parser.add_argument("archive", type=Path)
    parser.add_argument("--base", type=Path)
    parser.add_argument("--advisories", type=Path, default=CATALOG)
    args = parser.parse_args()
    try:
        advisories = load_advisories(args.advisories.read_text(encoding="utf-8"))
        head = analyze_archive(args.archive, advisories)
        base = analyze_archive(args.base, advisories) if args.base else {}
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({"status": "error", "message": str(error)}), file=sys.stderr)
        return 2
    blocked = any(row["severity"] == "critical" for row in head.values())
    print(json.dumps({"status": "failed" if blocked else "passed", "findings": list(head.values()),
                      "comparison": {"introduced": sorted(head.keys() - base.keys()),
                                     "existing": sorted(head.keys() & base.keys()),
                                     "resolved": sorted(base.keys() - head.keys())}}, indent=2))
    return int(blocked)


if __name__ == "__main__":
    sys.exit(main())