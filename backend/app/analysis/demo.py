import argparse
from dataclasses import asdict
import json
from pathlib import Path

from .advisories import load_advisories
from .registry import register_analysis_handlers
from .remediation import BEFORE, PATH, apply_training_patch, build_safe_patch
from .score import ExpectedFinding, score_findings
from .types import Snapshot, make_finding_id
from ..ml.provider import LlmSettings, ModelError, build_provider
from ..ml.recommendations import explain_findings
from ..ml.workflow_draft import draft_workflow


class DemoProvider:
    def generate_json(self, system: str, payload: dict) -> dict:
        if "request" in payload:
            return {"checks": ["secrets"], "explain": True, "notify": True, "time": "14:00"}
        return {"recommendations": [{"findingId": item["id"],
                                     "explanation": "Обнаружена настройка с риском.",
                                     "action": "Откройте карточку и проверьте доказательство."}
                                    for item in payload["findings"]]}


class OfflineProvider:
    def generate_json(self, system: str, payload: dict) -> dict:
        raise ModelError("Учебная имитация сбоя")


def run_demo(live_model: bool) -> dict:
    catalog = Path(__file__).resolve().parents[3] / "docs" / "training-advisories.json"
    handlers = register_analysis_handlers(load_advisories(catalog.read_text(encoding="utf-8")))
    kotlin = "src/main/kotlin/demo/SecurityConfig.kt"
    initial = Snapshot("pr-1", {
        PATH: BEFORE + "\n",
        "build.gradle.kts": 'implementation("demo:sample-library:1.0.0")\n',
        kotlin: 'HttpSecurity\nrequestMatchers("/admin").permitAll()\n',
    })

    def analyze(snapshot: Snapshot):
        return [item for name, handler in handlers.items() for item in handler(snapshot, name)]

    found = analyze(initial)
    secret = next(item for item in found if item.ruleId == "SECRET-01")
    fixed = apply_training_patch(initial, secret, "pr-2")
    repeated = Snapshot("pr-3", {**fixed.files, PATH: "\n" + initial.files[PATH]})
    after = analyze(fixed)
    returned = analyze(repeated)
    expected = [
        ExpectedFinding(make_finding_id("SECRET-01", PATH, "api-key:1"), "secrets"),
        ExpectedFinding(make_finding_id("SCA-01", "build.gradle.kts", "demo:sample-library:DEMO-001"), "sca"),
        ExpectedFinding(make_finding_id("SAST-01", kotlin, "/admin"), "sast"),
    ]
    provider = build_provider(LlmSettings.from_env()) if live_model else DemoProvider()
    return {
        "mode": "live-model" if live_model else "simulated-model",
        "fixture": "synthetic-training",
        "findings": [asdict(item) for item in found],
        "scores": {key: asdict(value) for key, value in score_findings(found, expected).items()},
        "recommendations": [asdict(row) for row in explain_findings(found, provider)],
        "offline_recommendations": [asdict(row) for row in explain_findings(found, OfflineProvider())],
        "draft": draft_workflow("Каждый день в 14:00 ищи секреты и отправляй отчёт на почту", provider),
        "patch": asdict(build_safe_patch(initial, secret)),
        "comparison": {
            "resolved": sorted({item.id for item in found} - {item.id for item in after}),
            "returned": [asdict(item) for item in returned if item.id == secret.id],
            "critical_before": sum(item.severity == "critical" for item in found),
            "critical_after": sum(item.severity == "critical" for item in after),
        },
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cyber Garden: synthetic analysis walkthrough")
    parser.add_argument("--live-model", action="store_true")
    print(json.dumps(run_demo(parser.parse_args().live_model), indent=2, ensure_ascii=True))