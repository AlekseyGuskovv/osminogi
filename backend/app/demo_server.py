"""Local server for the browser walkthrough."""
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Condition, Thread
from uuid import uuid4

from .analysis.demo import training_fixture
from .analysis.remediation import apply_training_patch
from .ml.provider import build_provider
from .ml.recommendations import explain_findings
from .ml.workflow_draft import draft_workflow


ROOT = Path(__file__).resolve().parents[2]
INITIAL, ANALYZERS = training_fixture()
PROVIDER = build_provider()
SCAN_TYPES = {"secrets": "secrets", "deps": "sca", "code": "sast"}
LEVELS = {"low": 0, "medium": 0, "high": 1, "critical": 2}
LINEAR = {"start", "ai", *SCAN_TYPES}
TERMINAL = {"finish", "telegram"}
SNAPSHOTS = {INITIAL.id: INITIAL}
RUNS = {}


def repaired_snapshot():
    secret, = ANALYZERS["secrets"](INITIAL, "secret")
    return apply_training_patch(INITIAL, secret, "pr-2")


# Stable demo IDs make a browser reload or server restart repeatable.
SNAPSHOTS["pr-2"] = repaired_snapshot()


def validate_graph(graph):
    nodes, edges = graph.get("nodes"), graph.get("edges")
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 50 or not isinstance(edges, list):
        raise ValueError("Добавьте от 1 до 50 блоков.")
    by_id, links = {}, {}
    for node in nodes:
        if not isinstance(node, dict):
            raise ValueError("Неверный формат блока.")
        key, kind = node.get("id"), node.get("type")
        if not isinstance(key, str) or not key or len(key) > 80 or key in by_id:
            raise ValueError("У каждого блока должен быть свой ID.")
        if not isinstance(kind, str) or kind not in LINEAR | TERMINAL | {"gate"}:
            raise ValueError("Неизвестный тип блока.")
        if kind == "gate" and (type(node.get("threshold", 2)) is not int
                               or node.get("threshold", 2) not in (0, 1, 2)):
            raise ValueError("Укажите порог критичности.")
        by_id[key] = node
        links[key] = {}
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
            raise ValueError("Соедините выходы каждого блока, включая обе ветки условия.")
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


class Run:
    def __init__(self):
        self.id = uuid4().hex
        self.events = []
        self.result = {"id": self.id, "status": "queued"}
        self.changed = Condition()

    def emit(self, event):
        with self.changed:
            self.events.append(event)
            self.changed.notify_all()

    def finish(self, result):
        with self.changed:
            self.result = {"id": self.id, **result}
            self.events.append({"type": "run.finished"})
            self.changed.notify_all()


def execute(run, graph, snapshot):
    nodes, links, key = graph
    findings, advice, steps, scanned = {}, {}, {}, set()

    def step(node_id, status, input_count=None, output=""):
        payload = {"status": status, "input": input_count, "output": output}
        steps[node_id] = payload
        run.emit({"type": "node.status", "nodeId": node_id, "step": payload})

    active = None
    try:
        while key is not None:
            active = key
            node = nodes[key]
            kind = node["type"]
            count = len(findings)
            step(key, "running", count)
            branch = ""
            output = f"Находок на выходе: {count}"
            if kind == "start":
                output = f"Учебный снимок {snapshot.id}"
            elif kind in SCAN_TYPES:
                rows = ANALYZERS[SCAN_TYPES[kind]](snapshot, key)
                scanned.add(SCAN_TYPES[kind])
                for item in rows:
                    findings[item.id] = item
                output = "\n".join(f"{item.title} · {item.path}:{item.line}" for item in rows) or "Находок нет."
            elif kind == "ai":
                advice.update({row.findingId: row for row in explain_findings(list(findings.values()), PROVIDER)})
                sources = {"ai": "CodexGenerator", "rule": "совет из правила"}
                output = "\n".join(f"{sources[row.source]} · {row.action}" for row in advice.values()) or "Находок нет."
            elif kind == "gate":
                threshold = node.get("threshold", 2)
                branch = "yes" if any(LEVELS[item.severity] >= threshold for item in findings.values()) else "no"
                output = "Ветка: " + ("Да" if branch == "yes" else "Нет")
            elif kind == "telegram":
                output = "Предпросмотр Telegram\n" + ("\n".join(item.title for item in findings.values()) or "Находок нет.")
            step(key, "done", count, output)
            key = links[key].get(branch)
            active = None
        status = "succeeded"
    except Exception:
        step(active, "failed", len(findings), "Не удалось выполнить блок.")
        status = "failed"
    for node_id in nodes:
        if node_id not in steps:
            step(node_id, "skipped")
    ci = ("error" if status == "failed" else
          "failed" if any(item.severity == "critical" for item in findings.values()) else
          "passed" if scanned else "unchecked")
    run.finish({"status": status, "ci": ci, "findings": [asdict(item) for item in findings.values()],
                "recommendations": [asdict(row) for row in advice.values()],
                "scanned": sorted(scanned), "steps": steps})


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        self.send_payload(status, json.dumps(payload, ensure_ascii=False).encode(), "application/json")

    def send_payload(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/":
            self.send_payload(200, (ROOT / "index.html").read_bytes(), "text/html")
            return
        prefix = "/api/v1/runs/"
        tail = self.path.removeprefix(prefix).split("/")
        run = RUNS.get(tail[0]) if self.path.startswith(prefix) else None
        if run and len(tail) == 1:
            self.send_json(200, run.result)
        elif run and tail[1:] == ["events"]:
            self.stream(run)
        else:
            self.send_json(404, {"message": "Страница или запуск не найдены."})

    def stream(self, run):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        # Replay all events. Each update replaces a node state, so replay is idempotent.
        index = 0
        try:
            while True:
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
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return

    def do_POST(self):
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= 65536 or self.headers.get_content_type() != "application/json":
                raise ValueError("Отправьте JSON размером до 64 КБ.")
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError("Ожидался JSON-объект.")
            if self.path == "/api/v1/runs":
                graph = data.get("graph")
                snapshot_id = data.get("snapshotId")
                if not isinstance(graph, dict) or not isinstance(snapshot_id, str) or snapshot_id not in SNAPSHOTS:
                    raise ValueError("Укажите граф и учебный снимок.")
                validated = validate_graph(graph)
                run = Run()
                RUNS[run.id] = run
                Thread(target=execute, args=(run, validated, SNAPSHOTS[snapshot_id]), daemon=True).start()
                self.send_json(202, {"id": run.id, "status": "queued"})
            elif self.path == "/api/v1/fixes/demo":
                snapshot = repaired_snapshot()
                SNAPSHOTS[snapshot.id] = snapshot
                self.send_json(200, {"snapshotId": snapshot.id})
            elif self.path == "/api/v1/workflows/draft":
                prompt = data.get("prompt")
                if not isinstance(prompt, str) or not 0 < len(prompt.strip()) <= 2000:
                    raise ValueError("Введите задачу длиной до 2000 символов.")
                self.send_json(200, draft_workflow(prompt.strip(), PROVIDER, include_source=True))
            else:
                self.send_json(404, {"message": "Маршрут не найден."})
        except (ValueError, TypeError) as error:
            message = str(error) if not isinstance(error, json.JSONDecodeError) else "Неверный формат JSON."
            self.send_json(422, {"message": message})


if __name__ == "__main__":
    with ThreadingHTTPServer(("127.0.0.1", 8000), Handler) as server:
        print("Cyber Garden: http://127.0.0.1:8000", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
