from dataclasses import asdict
from uuid import uuid4

from .analysis.remediation import apply_training_patch, build_safe_patch
from .analysis.report import markdown, submission
from .analysis.types import Finding
from .connections import connections, save_connection
from .contract import ApiError, SEVERITIES, to_internal, to_run, to_workflow


def missing(message):
    raise ApiError(404, "NOT_FOUND", message)


class WordApi:
    def __init__(self, store, load_run, save_workflow, launch, project, condition):
        self.store, self.load_run = store, load_run
        self.save_workflow, self.launch, self.project, self.condition = save_workflow, launch, project, condition

    def workflow(self, key):
        row = self.store.get("workflow", key)
        if not row:
            missing("Сценарий не найден.")
        return row

    def run(self, key):
        row = self.load_run(key)
        if not row:
            missing("Запуск не найден.")
        return row

    def runs(self, workflow_id):
        return [row for row in self.store.list("run") if row.get("workflowId") == workflow_id]

    def save(self, data, key=None):
        prepared = {**data, "graph": to_internal(data), "wordSave": True}
        return to_workflow(self.save_workflow(prepared, key))

    def compare_runs(self, current, older):
        signature = ("scanned", "analysisVersion")
        if (current.get("ci") in (None, "pending", "error", "unchecked")
                or older.get("ci") in (None, "pending", "error", "unchecked")
                or any(current.get(key) != older.get(key) for key in signature)):
            raise ApiError(409, "INCOMPARABLE_RUNS", "Наборы выполненных анализаторов или версии правил различаются.")
        found = {item["id"] for item in current["findings"]}
        before = {item["id"] for item in older["findings"]}
        return {"againstRunId": older["id"], "introduced": sorted(found - before),
                "existing": sorted(found & before), "resolved": sorted(before - found)}

    def finding_history(self, key, finding_id):
        source = self.runs(key)
        if not source:
            return {"findingId": finding_id, "entries": []}
        anchor = next((row for row in reversed(source) if row.get("ci") in {"passed", "failed"}
                       and any(item["id"] == finding_id for item in row.get("findings", []))), None)
        entries, state = [], None
        for row in reversed(source) if anchor else []:
            if (row.get("ci") not in {"passed", "failed"} or row.get("analysisVersion") != anchor.get("analysisVersion")
                    or row.get("scanned") != anchor.get("scanned")):
                continue
            present = any(item["id"] == finding_id for item in row.get("findings", []))
            transition = ("found" if state is None else "returned") if present else "resolved"
            if (present and state not in {"found", "returned"}) or (not present and state in {"found", "returned"}):
                entries.append({"runId": row["id"], "state": transition})
                state = transition
        return {"findingId": finding_id, "entries": entries}

    def preview_threshold(self, row, data):
        node_id, value = data.get("nodeId"), data.get("value")
        graph = row.get("graph", {})
        node = next((n for n in graph.get("nodes", []) if n["id"] == node_id and n["type"] == "gate"), None)
        inputs = row.get("steps", {}).get(node_id, {}).get("inputFindings") if isinstance(node_id, str) else None
        if node is None or inputs is None:
            raise ApiError(422, "CONDITION_UNAVAILABLE", "Нет сохранённого входа для этого блока.")
        metric = node.get("metric", "severity")
        threshold = (-1 if value == "low" else SEVERITIES.index(value)) if metric == "severity" else value
        facts = [Finding(**item) for item in inputs]
        branch = "yes" if self.condition({**node, "threshold": threshold}, facts) else "no"
        nodes = {item["id"]: item for item in graph["nodes"]}
        source, first = node_id, branch
        while True:
            edge = next((item for item in graph["edges"] if item["source"] == source and item["branch"] == branch), None)
            if edge is None:
                return {"nodeId": node_id, "value": value, "branch": first, "wouldNotify": False}
            source = edge["target"]
            target = nodes[source]
            if target["type"] in {"telegram", "finish"}:
                return {"nodeId": node_id, "value": value, "branch": first, "wouldNotify": target["type"] == "telegram"}
            if target["type"] in {"gate", "secrets", "deps", "code"}:
                # No reliable prediction beyond an additional scanner or decision.
                return {"nodeId": node_id, "value": value, "branch": first, "wouldNotify": None}
            branch = ""

    def fix(self, row, action, data):
        snapshot = self.project(row["snapshotId"])
        if action == "fix-preview":
            raw = next((item for item in row.get("findings", []) if item["id"] == data.get("findingId")), None)
            if raw is None:
                raise ApiError(422, "FIX_UNAVAILABLE", "Правка недоступна для этой находки.")
            try:
                patch = build_safe_patch(snapshot, Finding(**raw))
            except ValueError as error:
                raise ApiError(422, "FIX_UNAVAILABLE", "Правка доступна для встроенного учебного шаблона.") from error
            key = uuid4().hex
            self.store.put("fix", key, {"runId": row["id"], "finding": raw, "snapshotId": snapshot.id})
            return 200, {"previewId": key, **asdict(patch)}
        key = data.get("previewId")
        saved = self.store.get("fix", key) if isinstance(key, str) else None
        if not saved or saved["runId"] != row["id"] or saved["snapshotId"] != snapshot.id:
            raise ApiError(409, "STALE_PREVIEW", "Создайте новый предпросмотр правки.")
        fixed = apply_training_patch(snapshot, Finding(**saved["finding"]), "fix-" + key)
        self.store.put("snapshot", fixed.id, {"id": fixed.id, "label": "Учебный снимок после правки", "files": fixed.files})
        return 201, {"snapshotId": fixed.id}

    def get(self, path, query, handler):
        pieces = path.strip("/").split("/")
        if path == "/workflows":
            handler.reply(200, [to_workflow(row) for row in self.store.list("workflow")])
        elif path == "/connections":
            handler.reply(200, connections(self.store))
        elif path == "/templates":
            rows = self.store.list("template")
            handler.reply(200, [self.template(row) for row in rows])
        elif pieces[0] == "workflows" and len(pieces) >= 2:
            key = pieces[1]
            row = self.workflow(key)
            if len(pieces) == 2:
                handler.reply(200, to_workflow(row))
            elif pieces[2:] == ["runs"]:
                handler.reply(200, [to_run(item) for item in self.runs(key)])
            elif len(pieces) == 5 and pieces[2] == "findings" and pieces[4] == "history":
                handler.reply(200, self.finding_history(key, pieces[3]))
            else:
                return False
        elif pieces[0] == "runs" and len(pieces) >= 2:
            row = self.run(pieces[1])
            if len(pieces) == 2:
                handler.reply(200, to_run(row))
            elif pieces[2:] == ["comparison"]:
                other = query.get("againstRunId", [None])[0]
                result = self.compare_runs(row, self.run(other)) if other else row.get("comparison")
                if result is None:
                    raise ApiError(409, "INCOMPARABLE_RUNS", "Для запуска не задан базовый снимок.")
                handler.reply(200, result)
            elif pieces[2:] == ["report"]:
                if row["status"] in {"queued", "running"}:
                    raise ApiError(409, "RUN_IN_PROGRESS", "Дождитесь завершения проверки.")
                report = submission(row.get("findings", []))
                kind = query.get("format", ["json"])[0]
                if kind == "markdown":
                    handler.send_bytes(200, markdown(report).encode(), "text/markdown")
                elif kind == "json":
                    handler.reply(200, report)
                else:
                    raise ApiError(422, "INVALID_FORMAT", "Выберите json или markdown.")
            else:
                return False
        else:
            return False
        return True

    def template(self, row):
        return {key: value for key, value in row.items() if key != "graph"} | {
            "workflow": to_workflow({**row, "snapshotId": None, "schedule": None})}

    def post(self, path, data, handler):
        pieces = path.strip("/").split("/")
        if path == "/workflows":
            handler.reply(201, self.save(data))
        elif path == "/connections":
            handler.reply(201, save_connection(self.store, data))
        elif len(pieces) == 3 and pieces[0] == "workflows":
            row = self.workflow(pieces[1])
            if pieces[2] == "save":
                handler.reply(200, self.save(data, row["id"]))
            elif pieces[2] == "runs":
                trigger = data.get("trigger", "manual")
                if trigger not in ("manual", "schedule", "ci"):
                    raise ApiError(422, "INVALID_TRIGGER", "Неизвестный способ запуска.")
                handler.reply(202, self.launch({"graph": row["graph"], "snapshotId": data.get("snapshotId") or row["snapshotId"],
                                               "baseSnapshotId": data.get("baseSnapshotId"), "workflowId": row["id"],
                                               "workflowRevision": row.get("revision", 1)}, trigger))
            else:
                return False
        elif len(pieces) == 3 and pieces[0] == "runs":
            row = self.run(pieces[1])
            if pieces[2] == "threshold-preview":
                handler.reply(200, self.preview_threshold(row, data))
            elif pieces[2] in ("fix-preview", "apply-fix"):
                handler.reply(*self.fix(row, pieces[2], data))
            else:
                return False
        else:
            return False
        return True
