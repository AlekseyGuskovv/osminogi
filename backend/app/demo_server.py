from datetime import UTC, datetime
from email import policy
from email.parser import BytesParser
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
from threading import Condition, Event, Thread
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

from .analysis.advisories import load_advisories
from .analysis.registry import register_analysis_handlers
from .analysis.types import Snapshot
from .connections import deliver
from .contract import ApiError, schedule_value, to_event, to_internal, to_workflow, zone
from .word_api import WordApi
from .engine import condition, execute, validate_graph
from .api_schema import OPENAPI
from .ml.live_draft import generate_workflow
from .ml.provider import ModelError, build_provider
from .project_import import ArchiveTooLarge, MAX_UPLOAD, read_project
from .store import Store


ROOT = Path(__file__).resolve().parents[2]
PROVIDER = build_provider()
RUNS = {}
STORE = None
WORD_API = None
ANALYSIS_VERSION = None
ANALYZERS = None


def project(snapshot_id):
    row = STORE.get("snapshot", snapshot_id) if isinstance(snapshot_id, str) else None
    if row is None:
        raise ApiError(422, "SNAPSHOT_REQUIRED", "Выберите загруженный учебный проект.")
    return Snapshot(row["id"], row["files"])


class Run:
    def __init__(self, metadata):
        self.id = uuid4().hex
        self.events = []
        self.result = {**metadata, "id": self.id, "status": "queued"}
        self.changed = Condition()
        STORE.put("run", self.id, self.result)

    def emit(self, event):
        with self.changed:
            if event["type"] == "run.status":
                self.result = {**self.result, "status": event["status"]}
                STORE.put("run", self.id, self.result)
            self.events.append({**event, "at": datetime.now(UTC).isoformat()})
            STORE.put("events", self.id, self.events)
            self.changed.notify_all()

    def finish(self, result):
        with self.changed:
            self.result = {**self.result, **result}
            STORE.put("run", self.id, self.result)
            self.events.append({"type": "run.finished", "at": datetime.now(UTC).isoformat()})
            STORE.put("events", self.id, self.events)
            self.changed.notify_all()
        RUNS.pop(self.id, None)


def checked_graph(graph):
    try:
        return validate_graph(graph)
    except (ValueError, TypeError, KeyError, re.error) as error:
        raise ApiError(422, "INVALID_GRAPH", "Некорректный граф: " + str(error)) from error


def launch(data, trigger="manual"):
    validated = checked_graph(data.get("graph"))
    snapshot = project(data.get("snapshotId"))
    base = project(data["baseSnapshotId"]) if data.get("baseSnapshotId") else None
    run = Run({"graph": data["graph"], "snapshotId": snapshot.id, "baseSnapshotId": base.id if base else None,
               "trigger": trigger, "createdAt": datetime.now(UTC).isoformat(),
               "workflowId": data.get("workflowId"), "workflowRevision": data.get("workflowRevision"),
               "analysisVersion": ANALYSIS_VERSION})
    RUNS[run.id] = run
    Thread(target=execute, args=(run, validated, snapshot, base, ANALYZERS, PROVIDER,
                                 lambda node, report: deliver(STORE, node, report)),
           kwargs={"require_complete": trigger == "ci"}, daemon=True).start()
    return {"id": run.id, "status": "queued"}


def save_workflow(data, workflow_id=None):
    checked_graph(data.get("graph"))
    snapshot_id, schedule = data.get("snapshotId"), schedule_value(data.get("schedule") or None)
    if snapshot_id is not None:
        project(snapshot_id)
    if schedule and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", schedule["time"]):
        raise ValueError("Укажите время в формате ЧЧ:ММ (UTC).")
    if schedule and snapshot_id is None:
        raise ValueError("Для расписания нужен загруженный проект.")
    name = data.get("name", "Проверка")
    if not isinstance(name, str) or not 0 < len(name.strip()) <= 100:
        raise ValueError("Укажите короткое название сценария.")
    key = workflow_id or uuid4().hex
    row = {"id": key, "name": name.strip(), "graph": data["graph"], "snapshotId": snapshot_id, "schedule": schedule}
    return STORE.write_workflow(row, data.get("revision"), require_revision=bool(data.get("wordSave")))


def load_run(key):
    active = RUNS.get(key)
    return active.result if active else STORE.get("run", key)


def scheduler(stop):
    while not stop.is_set():
        now = datetime.now(UTC)
        for workflow in STORE.list("workflow"):
            schedule = schedule_value(workflow.get("schedule"))
            if not schedule:
                continue
            local = now.astimezone(zone(schedule["timezone"]))
            if schedule["time"] == local.strftime("%H:%M"):
                key = f"{workflow['id']}:{local.date()}"
                if STORE.claim("schedule", key):
                    launch({**workflow, "workflowId": workflow["id"],
                            "workflowRevision": workflow.get("revision", 1)}, "schedule")
        stop.wait(2)


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data):
        if status >= 400 and "code" not in data:
            data = {"code": {403: "ORIGIN_DENIED", 404: "NOT_FOUND", 422: "INVALID_REQUEST"}.get(status, "ERROR"), **data}
        self.send_bytes(status, json.dumps(data, ensure_ascii=False).encode(), "application/json")

    def send_bytes(self, status, body, kind):
        self.send_response(status)
        self.send_header("Content-Type", kind + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def allowed_origin(self):
        port = self.server.server_port
        origins = {f"http://127.0.0.1:{port}", f"http://localhost:{port}",
                   "http://127.0.0.1:5173", "http://localhost:5173"}
        origins.update(origin.strip() for origin in os.environ.get("GARDEN_ALLOWED_ORIGINS", "").split(",") if origin.strip())
        return self.headers.get("Origin") in origins

    def end_headers(self):
        if self.allowed_origin():
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Vary", "Origin")
        super().end_headers()

    def do_OPTIONS(self):
        if not self.allowed_origin():
            self.reply(403, {"code": "ORIGIN_DENIED", "message": "Источник запроса не разрешён."})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID")
        self.end_headers()

    def handle_error(self, error):
        if isinstance(error, ApiError):
            self.reply(error.status, {"code": error.code, "message": str(error)})
        else:
            self.reply(422, {"code": "INVALID_REQUEST", "message": str(error)})

    def do_GET(self):
        request = urlsplit(self.path)
        self.path = request.path
        query = parse_qs(request.query)
        demo = query.get("view") == ["demo"]
        try:
            self.get(query, demo)
        except (ValueError, TypeError, KeyError) as error:
            self.handle_error(error)

    def get(self, query, demo):
        if self.path in {"/openapi.json", "/api/v1/openapi.json"}:
            self.reply(200, OPENAPI)
            return
        if self.path == "/":
            self.send_bytes(200, (ROOT / "index.html").read_bytes(), "text/html")
            return
        path = self.path.removeprefix("/api/v1")
        if not self.path.startswith("/api/v1/"):
            self.reply(404, {"message": "Страница не найдена."})
            return
        if not demo and WORD_API.get(path, query, self):
            return
        collections = {"/runs": "run", "/workflows": "workflow", "/templates": "template", "/snapshots": "snapshot"}
        if path in collections:
            rows = STORE.list(collections[path], 30 if path == "/runs" else -1)
            if path == "/snapshots":
                rows = [{"id": row["id"], "label": row["label"]} for row in rows]
            self.reply(200, rows)
            return
        if path.startswith("/runs/"):
            key, _, action = path.removeprefix("/runs/").partition("/")
            run = RUNS.get(key)
            row = run.result if run else STORE.get("run", key)
            if row and action == "events":
                self.stream(run, row, demo)
                return
            if row and not action:
                self.reply(200, row)
                return
        self.reply(404, {"message": "Запуск или маршрут не найден."})

    def stream(self, run, row, demo):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        try:
            index = max(0, int(self.headers.get("Last-Event-ID", "0"))) if not demo else 0
        except ValueError:
            index = 0
        try:
            while True:
                if not run:
                    saved = STORE.get("events", row["id"]) or [
                        {"type": "node.status", "nodeId": key, "step": step}
                        for key, step in row.get("steps", {}).items()]
                    if not saved or saved[-1]["type"] != "run.finished":
                        saved = [*saved, {"type": "run.finished"}]
                    events = saved[index:]
                    if not events:
                        return
                else:
                    with run.changed:
                        run.changed.wait_for(lambda: len(run.events) > index, timeout=10)
                        events = run.events[index:]
                if not events:
                    self.wfile.write(b": heartbeat\n\n")
                for event in events:
                    wire = event if demo else to_event(event, row["id"], index + 1, run.result if run else row)
                    prefix = "" if demo else f"id: {index + 1}\n"
                    self.wfile.write((prefix + "data: " + json.dumps(wire) + "\n\n").encode())
                    self.wfile.flush()
                    index += 1
                    if event["type"] == "run.finished":
                        return
        except (BrokenPipeError, ConnectionError):
            pass

    def read_body(self, limit):
        size = int(self.headers.get("Content-Length", 0))
        if size > limit:
            raise ArchiveTooLarge("Превышен допустимый размер запроса.")
        if size <= 0:
            raise ValueError("Пустой запрос.")
        return self.rfile.read(size)

    def import_archive(self):
        raw = self.read_body(MAX_UPLOAD + 4096)
        content_type = self.headers.get("Content-Type", "")
        if content_type.startswith("multipart/form-data"):
            message = BytesParser(policy=policy.default).parsebytes(
                b"Content-Type: " + content_type.encode("ascii") + b"\r\n\r\n" + raw)
            part = next((part for part in message.iter_parts()
                         if part.get_param("name", header="Content-Disposition") == "file"), None)
            if part is None:
                raise ValueError("Передайте ZIP в поле file.")
            raw, label = part.get_payload(decode=True), part.get_filename() or "Учебный ZIP"
        elif content_type == "application/zip":
            label = "Учебный ZIP"
        else:
            raise ValueError("Выберите ZIP.")
        if not isinstance(raw, bytes):
            raise ValueError("Не удалось прочитать ZIP.")
        snapshot = read_project(raw, uuid4().hex)
        row = {"id": snapshot.id, "label": label[:160], "files": snapshot.files}
        STORE.put("snapshot", snapshot.id, row)
        self.reply(201, {"id": row["id"], "label": row["label"]})

    def do_POST(self):
        try:
            request = urlsplit(self.path)
            self.path = request.path
            demo = parse_qs(request.query).get("view") == ["demo"]
            origin = self.headers.get("Origin")
            if origin and not self.allowed_origin():
                self.reply(403, {"message": "Сервер принимает запросы только из локального интерфейса."})
                return
            path = self.path.removeprefix("/api/v1")
            if self.path == "/api/v1/snapshots/import":
                try:
                    self.import_archive()
                except ArchiveTooLarge:
                    raise
                except ValueError as error:
                    raise ApiError(422, "INVALID_ARCHIVE", str(error)) from error
                return
            if not self.path.startswith("/api/v1/"):
                self.reply(404, {"message": "Маршрут не найден."})
                return
            if self.headers.get_content_type() != "application/json":
                raise ValueError("Отправьте JSON.")
            data = json.loads(self.read_body(65536))
            if not isinstance(data, dict):
                raise ValueError("Ожидался JSON-объект.")
            if not demo and WORD_API.post(path, data, self):
                return
            if path == "/runs":
                self.reply(202, launch(data))
            elif path == "/workflows":
                self.reply(201, save_workflow(data))
            elif path.startswith("/workflows/") and path.endswith("/save"):
                key = path.split("/")[2]
                if STORE.get("workflow", key) is None:
                    self.reply(404, {"message": "Сценарий не найден."})
                else:
                    self.reply(200, save_workflow(data, key))
            elif path == "/templates":
                workflow = STORE.get("workflow", data.get("workflowId")) if isinstance(data.get("workflowId"), str) else None
                description = data.get("description", "")
                if not workflow or not isinstance(description, str) or len(description) > 500:
                    raise ValueError("Сохраните сценарий и задайте описание до 500 символов.")
                graph = workflow["graph"]
                graph["nodes"] = [{k: v for k, v in node.items() if k not in {"schedule", "channelId"}}
                                  for node in graph["nodes"]]
                name = data.get("name", workflow["name"])
                if not isinstance(name, str) or not 0 < len(name.strip()) <= 100:
                    raise ValueError("Укажите название шаблона.")
                row = {"id": uuid4().hex, "name": name.strip(), "graph": graph, "description": description}
                STORE.put("template", row["id"], row)
                self.reply(201, row if demo else WORD_API.template(row))
            elif path.startswith("/templates/") and path.endswith("/copy"):
                template = STORE.get("template", path.split("/")[2])
                if not template:
                    self.reply(404, {"message": "Шаблон не найден."})
                else:
                    graph = template["graph"]
                    if not demo:
                        for node in graph["nodes"]:
                            if node["type"] == "telegram":
                                node["channelId"] = None
                    copied = save_workflow({"name": template["name"], "graph": graph})
                    if not demo:
                        copied = to_workflow(copied)
                    self.reply(201, copied)
            elif path == "/workflows/draft":
                prompt = data.get("prompt")
                if not isinstance(prompt, str) or not 0 < len(prompt.strip()) <= 2000:
                    raise ValueError("Введите задачу длиной до 2000 символов.")
                draft = generate_workflow(prompt.strip(), PROVIDER)
                try:
                    validate_graph(to_internal(draft))
                except (ValueError, TypeError, KeyError, re.error) as error:
                    raise ModelError("CodexGenerator вернул недопустимый граф.") from error
                self.reply(200, draft)
            else:
                self.reply(404, {"message": "Маршрут не найден."})
        except ModelError as error:
            self.reply(503, {"code": "AI_UNAVAILABLE", "message": str(error)})
        except ArchiveTooLarge as error:
            self.reply(413, {"code": "ARCHIVE_TOO_LARGE", "message": str(error)})
        except json.JSONDecodeError:
            self.reply(422, {"code": "INVALID_JSON", "message": "Неверный формат JSON."})
        except (ValueError, TypeError, KeyError, re.error) as error:
            self.handle_error(error)


def main():
    global STORE, ANALYZERS, WORD_API, ANALYSIS_VERSION
    STORE = Store(ROOT)
    default = ROOT / "docs/training-advisories.json"
    catalog = Path(os.environ.get("GARDEN_ADVISORIES", default))
    catalog_text = catalog.read_text(encoding="utf-8-sig")
    ANALYZERS = register_analysis_handlers(load_advisories(catalog_text))
    ANALYSIS_VERSION = "organizer-v1:" + sha256(catalog_text.encode()).hexdigest()
    WORD_API = WordApi(STORE, load_run, save_workflow, launch, project, condition, ANALYZERS)
    for row in STORE.list("run"):
        if row["status"] in {"queued", "running"}:
            STORE.put("run", row["id"], {**row, "status": "failed", "ci": "error", "findings": [],
                                        "recommendations": [], "scanned": [], "steps": {},
                                        "integrationErrors": [], "summary": "", "delivery": {"status": "skipped"}})
    port = int(os.environ.get("GARDEN_PORT", "8000"))
    with ThreadingHTTPServer(("127.0.0.1", port), Handler) as server:
        stop = Event()
        Thread(target=scheduler, args=(stop,), daemon=True).start()
        print(f"Cyber Garden: http://127.0.0.1:{port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            stop.set()


if __name__ == "__main__":
    main()
