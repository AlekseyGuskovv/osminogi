from dataclasses import asdict
from datetime import UTC, datetime
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
from threading import Condition, Event, Thread
from uuid import uuid4

from .analysis.advisories import load_advisories
from .analysis.registry import register_analysis_handlers
from .analysis.types import Snapshot
from .ml.live import generate_report
from .ml.live_draft import generate_workflow
from .ml.provider import ModelError, build_provider
from .project_import import ArchiveTooLarge, MAX_UPLOAD, read_project
from .store import Store
from .telegram import DeliveryError, send_report


ROOT = Path(__file__).resolve().parents[2]
PROVIDER = build_provider()
SCAN_TYPES = {"secrets": "secrets", "deps": "sca", "code": "sast"}
LEVELS = {"low": 0, "medium": 0, "high": 1, "critical": 2}
LINEAR = {"start", "ai", *SCAN_TYPES}
TERMINAL = {"finish", "telegram"}
RUNS = {}
STORE = None
ANALYZERS = None


def condition(node, findings):
    metric, value = node.get("metric", "severity"), node.get("threshold", 2)
    if metric == "severity" and type(value) is int and value in (0, 1, 2):
        return any(LEVELS[item.severity] >= value for item in findings)
    if metric == "count" and type(value) is int and 0 <= value <= 5000:
        return len(findings) >= value
    if metric == "title":
        # Accept ordinary patterns without groups, backreferences or nested repetition.
        if (isinstance(value, str) and 0 < len(value) <= 80
                and not any(char in value for char in "(){}\\")
                and len(re.findall(r"[*+?]", value)) <= 1):
            pattern = re.compile(value, re.IGNORECASE)
            return any(pattern.search(item.title) for item in findings)
    raise ValueError("Неверное условие ветвления.")


def validate_graph(graph):
    if not isinstance(graph, dict):
        raise ValueError("Укажите граф.")
    nodes, edges = graph.get("nodes"), graph.get("edges")
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 50 or not isinstance(edges, list) or len(edges) > 100:
        raise ValueError("Добавьте от 1 до 50 блоков и до 100 связей.")
    by_id, links = {}, {}
    for node in nodes:
        if not isinstance(node, dict):
            raise ValueError("Неверный формат блока.")
        key, kind = node.get("id"), node.get("type")
        if not isinstance(key, str) or not re.fullmatch(r"[\w-]{1,80}", key) or key in by_id:
            raise ValueError("У каждого блока должен быть свой ID.")
        if not isinstance(kind, str) or kind not in LINEAR | TERMINAL | {"gate"}:
            raise ValueError("Неизвестный тип блока.")
        if any(type(node.get(axis)) not in (int, float) or not 0 <= node[axis] <= 10000 for axis in ("x", "y")):
            raise ValueError("Неверные координаты блока.")
        if kind == "gate":
            condition(node, [])
        by_id[key], links[key] = node, {}
    for edge in edges:
        if not isinstance(edge, dict):
            raise ValueError("Неверный формат связи.")
        source, target, branch = (edge.get(key) for key in ("source", "target", "branch"))
        if (not all(isinstance(value, str) for value in (source, target, branch))
                or source not in by_id or target not in by_id or branch in links[source]):
            raise ValueError("Проверьте связи между блоками.")
        links[source][branch] = target
    starts = [key for key, node in by_id.items() if node["type"] == "start"]
    if len(starts) != 1:
        raise ValueError("Добавьте ровно один блок «Запуск».")
    for key, node in by_id.items():
        kind = node["type"]
        expected = {""} if kind in LINEAR else {"yes", "no"} if kind == "gate" else set()
        if links[key].keys() != expected:
            raise ValueError("Соедините все выходы, включая обе ветки условия.")
    seen, visiting = set(), set()

    def visit(key):
        if key in visiting:
            raise ValueError("В сценарии есть цикл.")
        if key in seen:
            return
        visiting.add(key)
        for target in links[key].values():
            visit(target)
        visiting.remove(key)
        seen.add(key)

    visit(starts[0])
    if seen != by_id.keys():
        raise ValueError("Соедините все блоки с запуском или удалите лишние.")
    return by_id, links, starts[0]


def project(snapshot_id):
    row = STORE.get("snapshot", snapshot_id) if isinstance(snapshot_id, str) else None
    if row is None:
        raise ValueError("Выберите загруженный учебный проект.")
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
            self.events.append(event)
            self.changed.notify_all()

    def finish(self, result):
        with self.changed:
            self.result = {**self.result, **result}
            STORE.put("run", self.id, self.result)
            self.events.append({"type": "run.finished"})
            self.changed.notify_all()
        RUNS.pop(self.id, None)


def compare(findings, previous):
    return {"introduced": sorted(findings.keys() - previous.keys()),
            "existing": sorted(findings.keys() & previous.keys()),
            "resolved": sorted(previous.keys() - findings.keys())}


def execute(run, graph, snapshot, base):
    nodes, links, key = graph
    findings, advice, steps, scanned = {}, {}, {}, set()
    summary, delivery, integration_errors = "", {"status": "skipped"}, []
    status, delta, resolved = "succeeded", None, None

    def step(node_id, state, count=None, output=""):
        payload = {"status": state, "input": count, "output": output}
        steps[node_id] = payload
        run.emit({"type": "node.status", "nodeId": node_id, "step": payload})

    while key is not None:
        kind = nodes[key]["type"]
        count, branch = len(findings), ""
        step(key, "running", count)
        output = f"Находок на выходе: {count}"
        try:
            if kind == "start":
                output = f"Снимок {snapshot.id}"
            elif kind in SCAN_TYPES:
                analyzer = SCAN_TYPES[kind]
                rows = ANALYZERS[analyzer](snapshot, key)
                scanned.add(analyzer)
                findings.update({item.id: item for item in rows})
                output = "\n".join(f"{item.title} · {item.path}:{item.line}" for item in rows) or "Находок нет."
            elif kind == "ai":
                summary, rows = generate_report(list(findings.values()), PROVIDER)
                advice.update({row.findingId: row for row in rows})
                output = summary
            elif kind == "gate":
                branch = "yes" if condition(nodes[key], list(findings.values())) else "no"
                output = "Ветка: " + ("Да" if branch == "yes" else "Нет")
            elif kind == "telegram":
                rows = [f"{item.severity.upper()} · {item.title} · {item.path}:{item.line}"
                        for item in findings.values()]
                report = "\n".join(["Cyber Garden", summary or f"Найдено: {count}", *rows])
                message_id = send_report(report)
                delivery = {"status": "sent", "messageId": message_id}
                output = f"Telegram принял отчёт. Номер сообщения: {message_id}."
            step(key, "done", count, output)
        except (ModelError, DeliveryError) as error:
            integration_errors.append({"nodeId": key, "message": str(error)})
            if kind == "telegram":
                delivery = {"status": "failed", "message": str(error)}
            step(key, "failed", count, str(error))
        except Exception:
            step(key, "failed", count, "Не удалось выполнить анализ.")
            status = "failed"
            break
        key = links[key].get(branch)
    for node_id in nodes.keys() - steps.keys():
        step(node_id, "skipped")
    if base is not None and status == "succeeded":
        try:
            previous = {row.id: row for name in scanned for row in ANALYZERS[name](base, name)}
            delta = compare(findings, previous)
            resolved = [asdict(previous[key]) for key in delta["resolved"]]
        except (ValueError, KeyError):
            status = "failed"
    ci = ("error" if status == "failed" else
          "failed" if any(item.severity == "critical" for item in findings.values()) else
          "passed" if scanned else "unchecked")
    run.finish({"status": "partial" if status == "succeeded" and integration_errors else status,
                "ci": ci, "findings": [asdict(item) for item in findings.values()],
                "recommendations": [asdict(row) for row in advice.values()], "comparison": delta,
                "resolvedFindings": resolved, "scanned": sorted(scanned), "steps": steps, "delivery": delivery,
                "summary": summary, "integrationErrors": integration_errors})


def launch(data, trigger="manual"):
    validated = validate_graph(data.get("graph"))
    snapshot = project(data.get("snapshotId"))
    base = project(data["baseSnapshotId"]) if data.get("baseSnapshotId") else None
    run = Run({"graph": data["graph"], "snapshotId": snapshot.id, "baseSnapshotId": base.id if base else None,
               "trigger": trigger, "createdAt": datetime.now(UTC).isoformat()})
    RUNS[run.id] = run
    Thread(target=execute, args=(run, validated, snapshot, base), daemon=True).start()
    return {"id": run.id, "status": "queued"}


def save_workflow(data, workflow_id=None):
    validate_graph(data.get("graph"))
    snapshot_id, schedule = data.get("snapshotId"), data.get("schedule") or None
    if snapshot_id is not None:
        project(snapshot_id)
    if schedule and (not isinstance(schedule, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", schedule)):
        raise ValueError("Укажите время в формате ЧЧ:ММ (UTC).")
    if schedule and snapshot_id is None:
        raise ValueError("Для расписания нужен загруженный проект.")
    name = data.get("name", "Проверка")
    if not isinstance(name, str) or not 0 < len(name.strip()) <= 100:
        raise ValueError("Укажите короткое название сценария.")
    key = workflow_id or uuid4().hex
    row = {"id": key, "name": name.strip(), "graph": data["graph"], "snapshotId": snapshot_id, "schedule": schedule}
    STORE.put("workflow", key, row)
    return row


def scheduler(stop):
    while not stop.is_set():
        now = datetime.now(UTC)
        for workflow in STORE.list("workflow"):
            if workflow["schedule"] == now.strftime("%H:%M"):
                key = f"{workflow['id']}:{now.date()}"
                if STORE.claim("schedule", key):
                    launch(workflow, "schedule")
        stop.wait(2)


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data):
        self.send_bytes(status, json.dumps(data, ensure_ascii=False).encode(), "application/json")

    def send_bytes(self, status, body, kind):
        self.send_response(status)
        self.send_header("Content-Type", kind + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/":
            self.send_bytes(200, (ROOT / "index.html").read_bytes(), "text/html")
            return
        path = self.path.removeprefix("/api/v1")
        if not self.path.startswith("/api/v1/"):
            self.reply(404, {"message": "Страница не найдена."})
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
                self.stream(run, row)
                return
            if row and not action:
                self.reply(200, row)
                return
        self.reply(404, {"message": "Запуск или маршрут не найден."})

    def stream(self, run, row):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        index = 0
        try:
            while True:
                if not run:
                    events = [{"type": "node.status", "nodeId": key, "step": step}
                              for key, step in row.get("steps", {}).items()]
                    events.append({"type": "run.finished"})
                else:
                    with run.changed:
                        run.changed.wait_for(lambda: len(run.events) > index, timeout=10)
                        events = run.events[index:]
                if not events:
                    self.wfile.write(b": heartbeat\n\n")
                for event in events:
                    self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode())
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
            origin = self.headers.get("Origin")
            port = self.server.server_port
            if origin and origin not in {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}:
                self.reply(403, {"message": "Сервер принимает запросы только из локального интерфейса."})
                return
            path = self.path.removeprefix("/api/v1")
            if self.path == "/api/v1/snapshots/import":
                self.import_archive()
                return
            if not self.path.startswith("/api/v1/"):
                self.reply(404, {"message": "Маршрут не найден."})
                return
            if self.headers.get_content_type() != "application/json":
                raise ValueError("Отправьте JSON.")
            data = json.loads(self.read_body(65536))
            if not isinstance(data, dict):
                raise ValueError("Ожидался JSON-объект.")
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
                row = {"id": uuid4().hex, "name": workflow["name"], "graph": graph, "description": description}
                STORE.put("template", row["id"], row)
                self.reply(201, row)
            elif path.startswith("/templates/") and path.endswith("/copy"):
                template = STORE.get("template", path.split("/")[2])
                if not template:
                    self.reply(404, {"message": "Шаблон не найден."})
                else:
                    self.reply(201, save_workflow({"name": template["name"], "graph": template["graph"]}))
            elif path == "/workflows/draft":
                prompt = data.get("prompt")
                if not isinstance(prompt, str) or not 0 < len(prompt.strip()) <= 2000:
                    raise ValueError("Введите задачу длиной до 2000 символов.")
                self.reply(200, generate_workflow(prompt.strip(), PROVIDER))
            else:
                self.reply(404, {"message": "Маршрут не найден."})
        except ModelError as error:
            self.reply(503, {"code": "AI_UNAVAILABLE", "message": str(error)})
        except ArchiveTooLarge as error:
            self.reply(413, {"code": "ARCHIVE_TOO_LARGE", "message": str(error)})
        except (ValueError, TypeError, re.error) as error:
            self.reply(422, {"message": "Неверный формат JSON." if isinstance(error, json.JSONDecodeError) else str(error)})


def main():
    global STORE, ANALYZERS
    STORE = Store(ROOT)
    default = ROOT / "docs/training-advisories.json"
    catalog = Path(os.environ.get("GARDEN_ADVISORIES", default))
    ANALYZERS = register_analysis_handlers(load_advisories(catalog.read_text(encoding="utf-8")))
    for row in STORE.list("run"):
        if row["status"] == "queued":
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
