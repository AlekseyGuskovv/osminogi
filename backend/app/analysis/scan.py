import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sys

from ..project_import import MAX_UPLOAD, read_project
from .advisories import load_advisories
from .registry import register_analysis_handlers
from .score import ExpectedFinding, score_findings
from .types import make_finding_id


ROOT = Path(__file__).resolve().parents[3]
CATALOG = ROOT / "docs" / "training-advisories.json"


def analyze_archive(path, advisories):
    with path.open("rb") as stream:
        snapshot = read_project(stream.read(MAX_UPLOAD + 1), "ci")
    return {row.id: row for name, handler in register_analysis_handlers(advisories).items()
            for row in handler(snapshot, name)}


def read_expected(path):
    return [
        ExpectedFinding(make_finding_id(row["ruleId"], row["path"], row["anchor"]), row["analyzer"])
        for row in json.loads(path.read_text(encoding="utf-8"))
    ]


def main():
    parser = argparse.ArgumentParser(description="Defensive scan of a training Kotlin ZIP")
    parser.add_argument("archive", type=Path)
    parser.add_argument("--base", type=Path)
    parser.add_argument("--advisories", type=Path, default=CATALOG)
    parser.add_argument("--expected", type=Path, help="Hand-annotated findings for benchmarking")
    args = parser.parse_args()
    try:
        advisories = load_advisories(args.advisories.read_text(encoding="utf-8"))
        head = analyze_archive(args.archive, advisories)
        base = analyze_archive(args.base, advisories) if args.base else {}
        metrics = (score_findings(list(head.values()), read_expected(args.expected))
                   if args.expected else None)
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({"status": "error", "message": str(error)}), file=sys.stderr)
        return 2
    blocked = any(row.severity == "critical" for row in head.values())
    result = {"status": "failed" if blocked else "passed",
              "findings": [asdict(item) for item in head.values()],
              "comparison": {"introduced": sorted(head.keys() - base.keys()),
                             "existing": sorted(head.keys() & base.keys()),
                             "resolved": sorted(base.keys() - head.keys())}}
    if metrics is not None:
        result["scores"] = {name: asdict(score) for name, score in metrics.items()}
    print(json.dumps(result, indent=2))
    return int(blocked)


if __name__ == "__main__":
    sys.exit(main())