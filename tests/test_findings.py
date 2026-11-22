import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from backend.app.contract import ApiError
from backend.app.findings import finding_history, findings_overview, review_finding
from backend.app.store import Store


FINDING = {"id": "F-example", "ruleId": "SCA-01", "severity": "high"}


def check(key, *, present=False, catalog="one", scanned=("sca", "secrets"), ci="passed"):
    return {"id": f"run-{key}", "ci": ci, "findings": [FINDING] if present else [],
            "analysisVersion": catalog, "scanned": list(scanned), "createdAt": f"2026-01-0{key}T10:00:00Z"}


class FindingsTest(TestCase):
    def test_repeat_findings_use_latest_details_and_ignore_incomplete_runs(self):
        oldest = check(1, present=True)
        recent = check(2, present=True, ci="failed")
        overview = findings_overview([check(3, ci="error"), recent, oldest], {})
        self.assertEqual(overview["latestRunId"], "run-2")
        record, = overview["findings"]
        self.assertEqual((record["state"], record["occurrences"], record["category"]), ("open", 2, "SCA"))
        self.assertEqual(record["firstSeenAt"], oldest["createdAt"])
        self.assertEqual(record["lastSeenAt"], recent["createdAt"])

    def test_resolution_requires_a_comparable_run_and_history_can_show_return(self):
        first = check(1, present=True)
        for different in (check(2, catalog="two"), check(2, scanned=("secrets",))):
            with self.subTest(different=different):
                self.assertEqual(findings_overview([different, first], {})["findings"][0]["state"], "unverified")
        fixed = check(3, scanned=("secrets", "sca"))
        self.assertEqual(findings_overview([fixed, first], {})["findings"][0]["state"], "resolved")
        returned = check(4, present=True, catalog="two")
        states = [item["state"] for item in finding_history([returned, fixed, first], FINDING["id"])["entries"]]
        self.assertEqual(states, ["found", "resolved", "returned"])

    def test_review_requires_reason_and_stays_in_its_workflow(self):
        with TemporaryDirectory() as temp, patch.dict(os.environ, {
            "GARDEN_DB": str(Path(temp) / "garden.sqlite3"), "GARDEN_WORKSPACE_ID": "findings-test",
        }):
            store = Store(Path(temp))
            runs = [check(1, present=True)]
            data = {"status": "false_positive", "reason": "  Учебное значение  "}
            with self.assertRaises(ApiError) as missing_reason:
                review_finding(store, "first", FINDING["id"], runs, {"status": "false_positive"})
            self.assertEqual(missing_reason.exception.status, 422)
            with self.assertRaises(ApiError) as missing_finding:
                review_finding(store, "second", FINDING["id"], [], data)
            self.assertEqual(missing_finding.exception.status, 404)
            review = review_finding(store, "first", FINDING["id"], runs, data)
            self.assertEqual(review["reason"], "Учебное значение")
            self.assertEqual(review_finding(store, "first", FINDING["id"], runs, data), review)
            reopened = Store(Path(temp))
            self.assertEqual(reopened.get("finding-review:first", FINDING["id"]), review)
            self.assertIsNone(reopened.get("finding-review:second", FINDING["id"]))
