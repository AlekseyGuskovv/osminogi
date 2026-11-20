from dataclasses import asdict
import re

from .ml.live import generate_report
from .ml.provider import ModelError
from .telegram import DeliveryError


SCAN_TYPES = {"secrets": "secrets", "deps": "sca", "code": "sast"}
LEVELS = {"low": -1, "medium": 0, "high": 1, "critical": 2}
LINEAR = {"start", "ai", *SCAN_TYPES}
TERMINAL = {"finish", "telegram"}


def condition(node, findings):
    metric, value = node.get("metric", "severity"), node.get("threshold", 2)
    if metric == "severity" and type(value) is int and value in (-1, 0, 1, 2):
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


def compare(findings, previous):
    return {"introduced": sorted(findings.keys() - previous.keys()),
            "existing": sorted(findings.keys() & previous.keys()),
            "resolved": sorted(previous.keys() - findings.keys())}


def execute(run, graph, snapshot, base, analyzers, provider, notify, *, require_complete=False):
    nodes, links, key = graph
    findings, advice, steps, scanned = {}, {}, {}, set()
    summary, delivery, integration_errors = "", {"status": "skipped"}, []
    status, delta, resolved = "succeeded", None, None

    run.emit({"type": "run.status", "status": "running"})

    def step(node_id, state, count=None, output="", **extra):
        payload = {"status": state, "input": count, "output": output, **extra}
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
                rows = analyzers[analyzer](snapshot, key)
                scanned.add(analyzer)
                findings.update({item.id: item for item in rows})
                output = "\n".join(f"{item.title} · {item.path}:{item.line}" for item in rows) or "Находок нет."
            elif kind == "ai":
                summary, rows = generate_report(list(findings.values()), provider)
                advice.update({row.findingId: row for row in rows})
                output = summary
            elif kind == "gate":
                branch = "yes" if condition(nodes[key], list(findings.values())) else "no"
                output = "Ветка: " + ("Да" if branch == "yes" else "Нет")
            elif kind == "telegram":
                rows = [f"{item.severity.upper()} · {item.title} · {item.path}:{item.line}"
                        for item in findings.values()]
                report = "\n".join(["Cyber Garden", summary or f"Найдено: {count}", *rows])
                message_id = notify(nodes[key], report)
                delivery = {"status": "sent", "messageId": message_id}
                output = f"Telegram принял отчёт. Номер сообщения: {message_id}."
            details = ({"branch": branch, "inputFindings": [asdict(item) for item in findings.values()]}
                       if kind == "gate" else {})
            step(key, "done", count, output, **details)
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
            previous = {row.id: row for name in scanned for row in analyzers[name](base, name)}
            delta = compare(findings, previous)
            resolved = [asdict(previous[key]) for key in delta["resolved"]]
        except (ValueError, KeyError):
            status = "failed"
    if require_complete and scanned != set(SCAN_TYPES.values()):
        status = "failed"
    ci = ("error" if status == "failed" else
          "failed" if any(item.severity == "critical" for item in findings.values()) else
          "passed" if scanned else "unchecked")
    run.finish({"status": "partial" if status == "succeeded" and integration_errors else status,
                "ci": ci, "findings": [asdict(item) for item in findings.values()],
                "recommendations": [asdict(row) for row in advice.values()], "comparison": delta,
                "resolvedFindings": resolved, "scanned": sorted(scanned), "steps": steps, "delivery": delivery,
                "summary": summary, "integrationErrors": integration_errors})


class HeadlessRun:
    def emit(self, event):
        pass

    def finish(self, result):
        self.result = result


def execute_headless(graph, snapshot, base, analyzers):
    validated = validate_graph(graph)
    if any(node["type"] in {"ai", "telegram"} for node in graph["nodes"]):
        raise ValueError("CI graph must contain only local analysis and conditions.")
    run = HeadlessRun()
    execute(run, validated, snapshot, base, analyzers, None, None, require_complete=True)
    return run.result
