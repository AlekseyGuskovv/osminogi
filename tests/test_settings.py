from contextlib import closing
from datetime import UTC, datetime, timedelta
import os
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from backend.app.analysis.catalog_service import CatalogService
from backend.app.analysis.osv_catalog import catalog_text
from backend.app.analysis.sca import Advisory
from backend.app.connections import save_connection, send_connection_test, update_connection
from backend.app.contract import ApiError
from backend.app.store import Store


class SettingsTest(TestCase):
    def setUp(self):
        temporary = self.enterContext(TemporaryDirectory())
        self.root = Path(temporary)
        self.enterContext(patch.dict(os.environ, {"GARDEN_DB": str(self.root / "data.sqlite3"),
                                                  "GARDEN_WORKSPACE_ID": "local", "GARDEN_CONNECTION_KEY": ""}))
        self.store = Store(self.root)

    def test_catalog_choice_schedule_and_due_time_survive_restart(self):
        training = Path(__file__).resolve().parents[1] / "docs" / "training-advisories.json"
        cache = self.root / "osv.json"
        cache.write_text(catalog_text([Advisory("sample", "demo", "lib", "low", [],
                                                versions=frozenset({"1.0"}), source="osv")]), encoding="utf-8")
        catalog = CatalogService(training, training, cache, store=self.store)
        catalog.select("osv")
        settings = catalog.schedule(24)
        restarted = CatalogService(training, training, cache, store=self.store)
        self.assertEqual(restarted.status()["source"], "osv")
        self.assertEqual(restarted.status()["refreshIntervalHours"], 24)
        due = datetime.fromisoformat(settings["nextRefreshAt"])
        with patch.object(restarted, "_start_refresh") as refresh:
            restarted.refresh_due(due - timedelta(seconds=1))
            refresh.assert_not_called()
            restarted.refresh_due(due)
            refresh.assert_called_once_with(due)

    def test_local_connection_can_be_edited_and_disabled_without_disclosing_token(self):
        token = "123:" + "A" * 25
        connection = save_connection(self.store, {"type": "telegram", "name": "Demo", "token": token, "chatId": "-123"})
        key = connection["id"]
        self.assertNotIn(token, str(self.store.get("connection", key)))
        restarted = Store(self.root)
        self.assertEqual(update_connection(restarted, key, {"name": "Renamed"})["name"], "Renamed")
        with patch("backend.app.connections.send_report", return_value=17) as send:
            self.assertEqual(send_connection_test(restarted, key), {"messageId": 17})
            self.assertEqual(send.call_args.kwargs, {"token": token, "chat_id": "-123"})
            update_connection(restarted, key, {"configured": False})
            with self.assertRaises(ApiError) as error:
                send_connection_test(restarted, key)
            self.assertEqual(error.exception.status, 409)
            send.assert_called_once()

    def test_sqlite_backup_contains_only_active_workspace_and_shared_templates(self):
        self.store.put("workflow", "ours", {"id": "ours"})
        self.store.put("finding-review:ours", "F-1", {"reason": "included"})
        self.store.put("snapshot", "own", {"files": {"main.kt": "class A"}})
        self.store.put("run", "own", {"status": "succeeded", "createdAt": datetime.now(UTC).isoformat()})
        self.store.put("template", "shared", {"id": "shared"})
        with patch.dict(os.environ, {"GARDEN_WORKSPACE_ID": "another"}):
            other = Store(self.root)
            other.put("snapshot", "theirs", {"files": {"main.kt": "class B"}})
        stats = self.store.storage_usage()
        self.assertEqual((stats["snapshotCount"], stats["runCount"]), (1, 1))
        self.assertGreater(stats["snapshotBytes"], 0)
        with self.store.backup() as path, closing(sqlite3.connect(path)) as copy:
            self.assertEqual(copy.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            keys = set(copy.execute("SELECT kind,id FROM records"))
            self.assertEqual(keys, {("workflow", "ours"), ("finding-review:ours", "F-1"), ("snapshot", "own"),
                                    ("run", "own"), ("template", "shared")})
