from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3


class Store:
    def __init__(self, root):
        self.path = Path(os.environ.get("GARDEN_DB", root / ".garden-data" / "garden.sqlite3"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode = WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS records (
                kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL,
                modified TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(kind,id))""")

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
                           modified=CURRENT_TIMESTAMP""", (kind, key, json.dumps(value)))

    def claim(self, kind, key):
        with self.connect() as db:
            return db.execute("INSERT OR IGNORE INTO records(kind,id,body) VALUES(?,?,'{}')",
                              (kind, key)).rowcount == 1

    def get(self, kind, key):
        with self.connect() as db:
            row = db.execute("SELECT body FROM records WHERE kind=? AND id=?", (kind, key)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self, kind, limit=-1):
        with self.connect() as db:
            rows = db.execute("SELECT body FROM records WHERE kind=? ORDER BY modified DESC,rowid DESC LIMIT ?",
                              (kind, limit)).fetchall()
        return [json.loads(row[0]) for row in rows]