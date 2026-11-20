import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sys

from ..contract import to_internal
from ..engine import execute_headless
from ..project_import import MAX_UPLOAD, read_project
from .advisories import load_advisories
from .registry import register_analysis_handlers
from .report import markdown, score_submission, submission
from .score import ExpectedFinding, score_findings
from .types import Finding, make_finding_id


ROOT = Path(__file__).resolve().parents[3]
CATALOG = ROOT / "docs" / "training-advisories.json"


def load_archive(path):
    with path.open("rb") as stream:
        return read_project(stream.read(MAX_UPLOAD + 1), "ci")


def analyze_snapshot(snapshot, advisories):
    return {row.id: row for name, handler in register_analysis_handlers(advisories).items()
            for row in handler(snapshot, name)}


def read_expected(path):
    return [
        ExpectedFinding(make_finding_id(row["ruleId"], row["path"], row["anchor"]), row["analyzer"])
        for row in json.loads(path.read_text(encoding="utf-8-sig"))
    ]


def main():
    parser = argparse.ArgumentParser(description="Defensive scan of a training Kotlin ZIP")
    parser.add_argument("archive", type=Path)
    parser.add_argument("--base", type=Path)
    parser.add_argument("--advisories", type=Path, default=CATALOG)
    parser.add_argument("--expected", type=Path)
    parser.add_argument("--ground-truth", type=Path)
    parser.add_argument("--graph", type=Path)
    parser.add_argument("--report-json", type=Path)
    parser.add_argument("--report-markdown", type=Path)
    args = parser.parse_args()
    try:
        advisories = load_advisories(args.advisories.read_text(encoding="utf-8-sig"))
        snapshot = load_archive(args.archive)
        base_snapshot = load_archive(args.base) if args.base else None
        comparison, analysis_error = None, False
        if args.graph:
            graph = to_internal(json.loads(args.graph.read_text(encoding="utf-8-sig")))
            executed = execute_headless(graph, snapshot, base_snapshot, register_analysis_handlers(advisories))
            head = {row["id"]: Finding(**row) for row in executed["findings"]}
            comparison = executed["comparison"]
            analysis_error = executed["ci"] == "error"
            base = {}
        else:
            head = analyze_snapshot(snapshot, advisories)
            base = analyze_snapshot(base_snapshot, advisories) if base_snapshot else {}
        report = submission([asdict(item) for item in head.values()])
        if args.report_json:
            args.report_json.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        if args.report_markdown:
            args.report_markdown.write_text(markdown(report), encoding="utf-8")
        metrics = (score_findings(list(head.values()), read_expected(args.expected))
                   if args.expected else None)
        organizer = (score_submission(report, json.loads(args.ground_truth.read_text(encoding="utf-8-sig")))
                     if args.ground_truth else None)
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({"status": "error", "message": str(error)}), file=sys.stderr)
        return 2
    blocked = any(row.severity == "critical" for row in head.values())
    result = {"status": "error" if analysis_error else "failed" if blocked else "passed",
              "findings": list(report["findings"]),
              "comparison": comparison or {"introduced": sorted(head.keys() - base.keys()),
                             "existing": sorted(head.keys() & base.keys()),
                             "resolved": sorted(base.keys() - head.keys())}}
    if metrics is not None:
        result["scores"] = {name: asdict(score) for name, score in metrics.items()}
    if organizer is not None:
        result["organizerScores"] = organizer
    print(json.dumps(result, indent=2))
    return 2 if analysis_error else int(blocked)


if __name__ == "__main__":
    sys.exit(main())
