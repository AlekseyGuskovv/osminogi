import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from backend.app.analysis.types import Snapshot
from backend.app.snapshots import compare_snapshots, rename_snapshot, save_version, snapshot_library, snapshot_run_index
from backend.app.store import Store


class SnapshotsTest(TestCase):
    def test_comparison_groups_files_and_dependencies_by_version(self):
        before = {"id": "before", "files": {
            "build.gradle.kts": 'dependencies {\nimplementation("demo:sample:1.0")\nimplementation(libs.unknown)\n}',
            "old.yml": "enabled: true", "unchanged.kt": "class Unchanged",
        }}
        after = {"id": "after", "files": {
            "build.gradle.kts": 'dependencies {\nimplementation("demo:sample:2.0")\n}',
            "feature.yml": "enabled: true", "unchanged.kt": "class Unchanged",
        }}
        diff = compare_snapshots(before, after)
        self.assertEqual(diff["files"], {"added": ["feature.yml"], "modified": ["build.gradle.kts"], "removed": ["old.yml"]})
        self.assertEqual(diff["dependencies"], [{"module": ".", "group": "demo", "artifact": "sample",
                                                 "before": ["1.0"], "after": ["2.0"]}])
        self.assertEqual((diff["unresolvedBefore"], diff["unresolvedAfter"]), (1, 0))

    def test_versions_are_compared_per_module(self):
        first = 'dependencies { implementation("demo:sample:1.0") }'
        second = 'dependencies { implementation("demo:sample:2.0") }'
        diff = compare_snapshots(
            {"id": "before", "files": {"app/build.gradle.kts": first, "lib/build.gradle.kts": second}},
            {"id": "after", "files": {"app/build.gradle.kts": second, "lib/build.gradle.kts": first}},
        )
        self.assertEqual([(row["module"], row["before"], row["after"]) for row in diff["dependencies"]],
                         [("app", ["1.0"], ["2.0"]), ("lib", ["2.0"], ["1.0"])])

    def test_library_retains_user_labels_and_indexes_existing_snapshots(self):
        with TemporaryDirectory() as temp, patch.dict(os.environ, {
            "GARDEN_DB": str(Path(temp) / "garden.sqlite3"), "GARDEN_WORKSPACE_ID": "snapshots-test",
        }):
            store = Store(Path(temp))
            files = {"build.gradle.kts": "", "config.yml": "enabled: true"}
            store.put("snapshot", "legacy", {"id": "legacy", "label": "Старый снимок", "files": files})
            created = save_version(store, Snapshot("current", files), "Новый снимок")
            rename_snapshot(store, "current", "После обновления")
            saved_again = save_version(store, Snapshot("current", files), "Новый снимок")
            self.assertEqual(saved_again["label"], "После обновления")
            self.assertEqual(saved_again["createdAt"], created["createdAt"])
            store.put("run", "one", {"id": "one", "snapshotId": "current", "baseSnapshotId": "legacy",
                                      "status": "partial", "ci": "passed", "workflowId": "project"})
            newest, legacy = snapshot_library(store)
            self.assertEqual((newest["latestRun"]["status"], newest["latestRun"]["ci"]), ("succeeded", "passed"))
            self.assertEqual((legacy["fileCount"], legacy["runCount"], legacy["latestRun"]), (2, 1, None))
            self.assertNotIn("files", newest)
            history = snapshot_run_index(store.snapshot_run_rows("legacy"))["legacy"]
            self.assertEqual([run["role"] for run in history], ["base"])
