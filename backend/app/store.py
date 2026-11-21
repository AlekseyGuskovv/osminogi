from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import re

from .contract import ApiError


class Store:
    def __init__(self, root):
        self.workspace = os.environ.get("GARDEN_WORKSPACE_ID", "local")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", self.workspace):
            raise ValueError("Invalid workspace ID")
        self.path = Path(os.environ.get("GARDEN_DB", root / ".garden-data" / "garden.sqlite3"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode = WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS records (
                kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL,
                modified TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(kind,id))""")

    def kind(self, name):
        return name if self.workspace == "local" or name == "template" else f"{self.workspace}:{name}"

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def put(self, kind, key, value):
        with self.connect() as db:
            db.execute("""INSERT INTO records(kind,id,body) VALUES(?,?,?)
                           ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body,
                           modified=CURRENT_TIMESTAMP""", (self.kind(kind), key, json.dumps(value)))

    def claim(self, kind, key):
        with self.connect() as db:
            return db.execute("INSERT OR IGNORE INTO records(kind,id,body) VALUES(?,?,'{}')",
                              (self.kind(kind), key)).rowcount == 1

    def insert_or_get(self, kind, key, value):
        with self.connect() as db:
            params = (self.kind(kind), key)
            created = db.execute("INSERT INTO records(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO NOTHING",
                                 (*params, json.dumps(value))).rowcount
            if created:
                return value
            row = db.execute("SELECT body FROM records WHERE kind=? AND id=?", params).fetchone()
            return json.loads(row[0])

    def get(self, kind, key):
        with self.connect() as db:
            row = db.execute("SELECT body FROM records WHERE kind=? AND id=?", (self.kind(kind), key)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self, kind, limit=-1):
        with self.connect() as db:
            rows = db.execute("SELECT body FROM records WHERE kind=? ORDER BY modified DESC,rowid DESC LIMIT ?",
                              (self.kind(kind), limit)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def snapshot_refs(self):
        with self.connect() as db:
            db.row_factory = sqlite3.Row
            rows = db.execute("""SELECT id, json_extract(body,'$.label') AS label,
                json_extract(body,'$.createdAt') AS createdAt,
                coalesce(json_extract(body,'$.fileCount'), (SELECT count(*) FROM json_each(body,'$.files'))) AS fileCount,
                CASE WHEN json_type(body,'$.organizerCatalog') IS NOT NULL THEN 'organizer' END AS catalogSource
                FROM records WHERE kind=? ORDER BY modified DESC,rowid DESC""", (self.kind("snapshot"),))
            return [{**{key: row[key] for key in ("id", "label", "createdAt", "fileCount")},
                     **({"catalogSource": row["catalogSource"]} if row["catalogSource"] else {})} for row in rows]

    def snapshot_run_rows(self, snapshot_id=None):
        with self.connect() as db:
            db.row_factory = sqlite3.Row
            rows = db.execute("""SELECT id, json_extract(body,'$.workflowId') AS workflowId,
                json_extract(body,'$.createdAt') AS createdAt, json_extract(body,'$.status') AS status,
                json_extract(body,'$.ci') AS ci, json_extract(body,'$.snapshotId') AS snapshotId,
                json_extract(body,'$.baseSnapshotId') AS baseSnapshotId
                FROM records WHERE kind=? AND
                (? IS NULL OR json_extract(body,'$.snapshotId')=? OR json_extract(body,'$.baseSnapshotId')=?)
                ORDER BY createdAt DESC,rowid DESC""", (self.kind("run"), snapshot_id, snapshot_id, snapshot_id))
            return [dict(row) for row in rows]

    def write_workflow(self, row, expected, require_revision):
        key = row["id"]
        workflows, revisions = self.kind("workflow"), self.kind("revision")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT body FROM records WHERE kind=? AND id=?", (workflows, key)).fetchone()
            previous = json.loads(existing[0]) if existing else None
            revision = previous.get("revision", 1) if previous else 0
            if previous and require_revision and (type(expected) is not int or expected != revision):
                raise ApiError(409, "REVISION_CONFLICT", "Обновите сценарий перед сохранением.")
            if previous and revision == 1:
                db.execute("INSERT OR IGNORE INTO records(kind,id,body) VALUES(?,?,?)",
                           (revisions, f"{key}:1", json.dumps({**previous, "revision": 1})))
            result = {**row, "revision": revision + 1}
            payload = json.dumps(result)
            db.execute("""INSERT INTO records(kind,id,body) VALUES(?,?,?)
                          ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body,
                          modified=CURRENT_TIMESTAMP""", (workflows, key, payload))
            db.execute("INSERT INTO records(kind,id,body) VALUES(?,?,?)",
                       (revisions, f"{key}:{revision + 1}", payload))
        return result
