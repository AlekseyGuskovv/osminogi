from datetime import UTC, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


NODE_TYPES = {"sca": "deps", "sast": "code", "condition": "gate"}
TO_WORD = {value: key for key, value in NODE_TYPES.items()}
SEVERITIES = ["medium", "high", "critical"]
METRICS = {"maxSeverity": ("severity", "gte"), "findingCount": ("count", "gte"),
           "findingTitle": ("title", "regex")}
BACKEND_METRICS = {value[0]: (key, value[1]) for key, value in METRICS.items()}


class ApiError(ValueError):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code = status, code


def zone(name):
    if name == "UTC":
        return UTC
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as error:
        if name == "Europe/Moscow":
            return timezone(timedelta(hours=3), "Europe/Moscow")
        raise ValueError("Часовой пояс недоступен. Укажите UTC.") from error


def schedule_value(value):
    if isinstance(value, str):
        return {"time": value, "timezone": "UTC"}
    if value is None:
        return None
    if not isinstance(value, dict) or not isinstance(value.get("time"), str) or not isinstance(value.get("timezone"), str):
        raise ValueError("Укажите время и часовой пояс.")
    zone(value["timezone"])
    return {"time": value["time"], "timezone": value["timezone"]}


def to_internal(data):
    nodes, edges = data.get("nodes"), data.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise ValueError("Укажите массивы nodes и edges.")
    converted = []
    for row in nodes:
        if not isinstance(row, dict) or not isinstance(row.get("type"), str):
            raise ValueError("Неверные данные блока.")
        kind, settings = row["type"], row.get("settings", {})
        if not isinstance(settings, dict):
            raise ValueError("settings должен быть объектом.")
        node = {key: row.get(key) for key in ("id", "x", "y")}
        node["type"] = NODE_TYPES.get(kind, kind)
        if kind == "condition":
            metric, operator = METRICS.get(settings.get("metric"), ("", ""))
            if not metric or settings.get("operator") != operator:
                raise ValueError("Неизвестное условие ветвления.")
            value = settings.get("value")
            if metric == "severity":
                value = 0 if value == "low" else SEVERITIES.index(value)
            node.update(metric=metric, threshold=value)
        if kind == "telegram" and settings.get("channelId") is not None:
            if not isinstance(settings["channelId"], str):
                raise ValueError("Укажите ID подключения.")
            node["channelId"] = settings["channelId"]
        converted.append(node)
    return {"nodes": converted, "edges": [
        {"source": edge["from"], "target": edge["to"], "branch": "" if edge["branch"] == "next" else edge["branch"]}
        for edge in edges]}


def to_word_graph(graph):
    nodes = []
    for row in graph["nodes"]:
        kind = row["type"]
        item = {key: row[key] for key in ("id", "x", "y")}
        settings = {}
        if kind == "gate":
            metric, operator = BACKEND_METRICS[row.get("metric", "severity")]
            threshold = row.get("threshold", 2)
            settings = {"metric": metric, "operator": operator,
                        "value": SEVERITIES[threshold] if metric == "maxSeverity" else threshold}
        if kind == "telegram" and row.get("channelId"):
            settings["channelId"] = row["channelId"]
        nodes.append({**item, "type": TO_WORD.get(kind, kind), "settings": settings})
    return {"nodes": nodes, "edges": [{"from": e["source"], "to": e["target"], "branch": e["branch"] or "next"}
                                     for e in graph["edges"]]}


def to_workflow(row):
    return {"id": row["id"], "name": row["name"], "revision": row.get("revision", 1),
            "snapshotId": row.get("snapshotId"), "schedule": schedule_value(row.get("schedule")),
            **to_word_graph(row["graph"])}


def step_data(node, step):
    return {"nodeId": node, **step, "status": "succeeded" if step["status"] == "done" else step["status"]}


def to_run(row):
    findings = row.get("findings", [])
    ci = row.get("ci", "pending")
    critical = next((item for item in findings if item["severity"] == "critical"), None)
    gate_id = next((node["id"] for node in row.get("graph", {}).get("nodes", [])
                    if node["type"] == "gate" and row.get("steps", {}).get(node["id"], {}).get("branch")), None)
    reason = {"failed": "CRITICAL_FOUND", "passed": "NO_CRITICAL", "error": "SCAN_FAILED",
              "unchecked": "NO_ANALYSIS", "pending": "PENDING"}
    delivery = row.get("delivery", {"status": "skipped"})
    return {**{key: value for key, value in row.items() if key != "graph"},
            "status": "succeeded" if row["status"] == "partial" else row["status"],
            "findings": findings, "steps": [step_data(key, step) for key, step in row.get("steps", {}).items()],
            "ci": {"status": "error" if ci == "unchecked" else ci, "reason": reason[ci],
                   "findingId": critical["id"] if critical else None, "nodeId": critical["nodeId"] if critical else None,
                   "gateNodeId": gate_id, "branch": row.get("steps", {}).get(gate_id, {}).get("branch")},
            "delivery": delivery["status"],
            "report": {"summary": row.get("summary", ""), "delivery": delivery["status"],
                       **({"messageId": delivery["messageId"]} if "messageId" in delivery else {})}}


def to_event(event, run_id, seq, row):
    if event["type"] == "node.status":
        data = step_data(event["nodeId"], event["step"])
    elif event["type"] == "run.finished":
        data = {"status": to_run(row)["status"], "ciStatus": to_run(row)["ci"]["status"]}
    else:
        data = {"status": event["status"]}
    return {"seq": seq, "runId": run_id, "type": event["type"],
            "at": event.get("at", datetime.now(UTC).isoformat()), "data": data}