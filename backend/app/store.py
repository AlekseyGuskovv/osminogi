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

    def get(self, kind, key):
        with self.connect() as db:
            row = db.execute("SELECT body FROM records WHERE kind=? AND id=?", (self.kind(kind), key)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self, kind, limit=-1):
        with self.connect() as db:
            rows = db.execute("SELECT body FROM records WHERE kind=? ORDER BY modified DESC,rowid DESC LIMIT ?",
                              (self.kind(kind), limit)).fetchall()
        return [json.loads(row[0]) for row in rows]

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
