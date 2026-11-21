def ref(name):
    return {"$ref": f"#/components/schemas/{name}"}


def obj(required=(), **properties):
    return {"type": "object", "required": list(required), "properties": properties}


def array(item):
    return {"type": "array", "items": item}


def choice(*values):
    return {"type": "string", "enum": list(values)}


STRING = {"type": "string"}
INTEGER = {"type": "integer"}
NUMBER = {"type": "number"}
BOOL = {"type": "boolean"}
MAP = {"type": "object"}
CATALOG_SOURCE = choice("training", "osv", "custom")
FINDING_REVIEW_STATUS = choice("unreviewed", "in_progress", "false_positive")
SNAPSHOT = {"id": STRING, "label": STRING, "catalogSource": choice("organizer"),
            "createdAt": {"type": ["string", "null"], "format": "date-time"}, "fileCount": INTEGER}
NODE_TYPE = choice("start", "secrets", "sca", "sast", "gradle", "coverage", "ai", "condition", "telegram", "finish")
NODE_TEMPLATE = {"name": STRING, "description": STRING, "type": NODE_TYPE, "settings": MAP}
GRAPH = {"nodes": array(ref("Node")), "edges": array(ref("Edge"))}
DRAFT = {"name": STRING, "schedule": {"anyOf": [ref("Schedule"), {"type": "null"}]},
         "snapshotId": {"type": ["string", "null"]}, **GRAPH}
BASE = "application/json"

SCHEMAS = {
    "Error": obj(["code", "message"], code=STRING, message=STRING),
    "AdvisoryCatalog": obj(["source", "analysisVersion", "osvAvailable", "customAvailable", "updating"],
                           source=CATALOG_SOURCE, analysisVersion=STRING, osvAvailable=BOOL, customAvailable=BOOL,
                           updating=BOOL, osvUpdatedAt={"type": ["string", "null"]}, error={"type": ["string", "null"]},
                           refreshIntervalHours=INTEGER, nextRefreshAt={"type": ["string", "null"]}),
    "AiDiagnostics": obj(["mode", "checking", "providers"], mode=choice("auto", "codex", "ollama", "custom"), checking=BOOL,
                         providers=array(obj(["id", "name", "status"], id=STRING, name=STRING,
                                             model={"type": ["string", "null"]}, status=choice("unknown", "available", "unavailable"),
                                             message={"type": ["string", "null"]}, checkedAt=STRING))),
    "StorageUsage": obj(["databaseBytes", "snapshotCount", "snapshotBytes", "runCount", "runBytes"],
                        databaseBytes=INTEGER, snapshotCount=INTEGER, snapshotBytes=INTEGER, runCount=INTEGER, runBytes=INTEGER),
    "Schedule": obj(["time", "timezone"], time=STRING, timezone=STRING),
    "Node": obj(["id", "type", "x", "y", "settings"], id=STRING, x=NUMBER, y=NUMBER,
                type=NODE_TYPE, settings=MAP, name=STRING, description=STRING),
    "NodeTemplateDraft": obj(NODE_TEMPLATE, **NODE_TEMPLATE),
    "NodeTemplate": obj(["id", *NODE_TEMPLATE], id=STRING, **NODE_TEMPLATE),
    "Edge": obj(["from", "to", "branch"], **{"from": STRING, "to": STRING, "branch": choice("next", "yes", "no")}),
    "Snapshot": obj(["id", "label", "fileCount"], **SNAPSHOT),
    "SnapshotRun": obj(["id", "status", "ci", "role"], id=STRING, workflowId={"type": ["string", "null"]},
                       createdAt={"type": ["string", "null"]}, role=choice("current", "base"),
                       status=choice("queued", "running", "succeeded", "failed"), ci=choice("pending", "passed", "failed", "error")),
    "SnapshotLibraryItem": obj(["id", "label", "fileCount", "runCount", "latestRun"], **SNAPSHOT, runCount=INTEGER,
                               latestRun={"anyOf": [ref("SnapshotRun"), {"type": "null"}]}),
    "SnapshotComparison": obj(["baseSnapshotId", "snapshotId", "files", "dependencies", "unresolvedBefore", "unresolvedAfter"],
                              baseSnapshotId=STRING, snapshotId=STRING,
                              files=obj(["added", "modified", "removed"], added=array(STRING), modified=array(STRING), removed=array(STRING)),
                              dependencies=array(obj(["module", "group", "artifact", "before", "after"], module=STRING,
                                                     group=STRING, artifact=STRING, before=array(STRING), after=array(STRING))),
                              unresolvedBefore=INTEGER, unresolvedAfter=INTEGER),
    "WorkflowDraft": obj(["name", "nodes", "edges"], **DRAFT, warnings=array(STRING)),
    "WorkflowUpdate": obj(["revision", "name", "nodes", "edges"], **DRAFT, revision=INTEGER),
    "Workflow": obj(["id", "revision", "name", "nodes", "edges"], **DRAFT, id=STRING, revision=INTEGER),
    "RunAccepted": obj(["id", "status"], id=STRING, status=choice("queued")),
    "RunRequest": obj(trigger=choice("manual", "schedule", "ci"), snapshotId=STRING, baseSnapshotId=STRING),
    "Finding": obj(["id", "ruleId", "nodeId", "severity", "path", "line", "evidence"],
                   id=STRING, ruleId=STRING, nodeId=STRING, severity=choice("low", "medium", "high", "critical"),
                   title=STRING, path=STRING, line=INTEGER, endLine={"type": ["integer", "null"]}, evidence=STRING,
                   advisoryId={"type": ["string", "null"]}, category={"type": ["string", "null"]},
                   classification={"type": ["string", "null"]}, version={"type": ["string", "null"]},
                   group={"type": ["string", "null"]}, artifact={"type": ["string", "null"]},
                   remediation={"type": ["string", "null"]},
                   advisoryAliases={"anyOf": [array(STRING), {"type": "null"}]},
                   advisorySource={"type": ["string", "null"]}, fixedVersion={"type": ["string", "null"]}),
    "CoverageIssue": obj(["path", "line", "reason"], path=STRING, line=INTEGER,
                         reason=choice("unknownAlias", "unknownVersion", "unsupportedVersion", "unsupportedAdvisoryRange")),
    "SnapshotCoverage": obj(["filesInSnapshot", "filesByAnalyzer"], filesInSnapshot=INTEGER,
                            filesByAnalyzer={"type": "object", "additionalProperties": INTEGER},
                            sca=obj(["recognized", "comparable", "unresolved", "examples"],
                                    recognized=INTEGER, comparable=INTEGER, unresolved=INTEGER,
                                    examples=array(ref("CoverageIssue")))),
    "Coverage": obj(["completed", "current"], completed=array(choice("secrets", "sca", "sast", "gradle")),
                    current=ref("SnapshotCoverage"), base=ref("SnapshotCoverage")),
    "RunStep": obj(["nodeId", "status"], nodeId=STRING,
                   status=choice("queued", "running", "succeeded", "failed", "skipped"),
                   input={"type": ["integer", "null"]}, output=STRING, branch=choice("yes", "no"),
                   coverage=ref("Coverage")),
    "CiResult": obj(["status", "reason"], status=choice("pending", "passed", "failed", "error"), reason=STRING,
                    **{key: {"type": ["string", "null"]} for key in ("findingId", "nodeId", "gateNodeId", "branch")}),
    "Comparison": obj(["introduced", "existing", "resolved"], introduced=array(STRING), existing=array(STRING),
                      resolved=array(STRING), againstRunId=STRING),
    "Run": obj(["id", "status", "ci", "findings", "steps"], id=STRING,
               status=choice("queued", "running", "succeeded", "failed"), workflowId={"type": ["string", "null"]},
               workflowRevision={"type": ["integer", "null"]}, snapshotId=STRING, baseSnapshotId={"type": ["string", "null"]},
               createdAt={"type": "string", "format": "date-time"}, trigger=choice("manual", "schedule", "ci"),
               analysisVersion=STRING, catalogSource=choice("training", "organizer", "custom", "osv"),
               ci=ref("CiResult"), findings=array(ref("Finding")), steps=array(ref("RunStep")),
               graph=obj(["nodes", "edges"], **GRAPH), fixableFindingIds=array(STRING),
               comparison={"anyOf": [ref("Comparison"), {"type": "null"}]},
               recommendations=array(ref("Recommendation")),
               integrationErrors=array(obj(["nodeId", "message"], nodeId=STRING, message=STRING)),
               technicalErrors=array(obj(["stage", "code", "message"],
                                         stage=choice("ai", "telegram", "analysis", "comparison"),
                                         code=STRING, message=STRING, nodeId=STRING)),
               report=ref("RunReport")),
    "RunReport": obj(["summary", "delivery"], summary=STRING, delivery=choice("sent", "failed", "skipped"), messageId=INTEGER),
    "RunEvent": obj(["seq", "runId", "type", "at", "data"], seq=INTEGER, runId=STRING,
                    type=choice("run.status", "node.status", "run.finished"), at=STRING, data=MAP),
    "Template": obj(["id", "name", "description", "workflow"], id=STRING, name=STRING, description=STRING, workflow=ref("Workflow")),
    "Connection": obj(["id", "type", "name", "configured"], id=STRING, type=choice("telegram"), name=STRING, configured=BOOL),
    "ConnectionInput": obj(["type", "name", "token", "chatId"], type=choice("telegram"), name=STRING,
                           token={"type": "string", "writeOnly": True}, chatId={"type": ["string", "integer"]}),
    "FindingHistory": obj(["findingId", "entries"], findingId=STRING,
                          entries=array(obj(["runId", "state"], runId=STRING, state=choice("found", "resolved", "returned")))),
    "Recommendation": obj(["findingId", "source", "explanation", "action"],
                          findingId=STRING, source=STRING, explanation=STRING, action=STRING),
    "FindingReview": obj(["findingId", "status", "reason", "updatedAt"], findingId=STRING,
                         status=FINDING_REVIEW_STATUS, reason=STRING, updatedAt={"type": "string", "format": "date-time"}),
    "FindingRecord": obj(["finding", "category", "state", "lastSeenRunId", "occurrences"],
                         finding=ref("Finding"), category=STRING, state=choice("open", "resolved", "unverified"),
                         firstSeenAt={"type": ["string", "null"]}, lastSeenAt={"type": ["string", "null"]},
                         lastSeenRunId=STRING, occurrences=INTEGER,
                         recommendation={"anyOf": [ref("Recommendation"), {"type": "null"}]},
                         review={"anyOf": [ref("FindingReview"), {"type": "null"}]}),
    "FindingsOverview": obj(["latestRunId", "findings"], latestRunId={"type": ["string", "null"]},
                            findings=array(ref("FindingRecord"))),
    "ThresholdPreview": obj(["nodeId", "value", "branch", "wouldNotify"], nodeId=STRING,
                            value={"type": ["integer", "string", "object"]}, branch=choice("yes", "no"), wouldNotify=BOOL),
    "FixPreview": obj(["previewId", "path", "line", "before", "after"], previewId=STRING, path=STRING,
                      line=INTEGER, before=STRING, after=STRING),
}


def operation(method, status, response, body=None, content=BASE, request_content=BASE, params=()):
    entry = {"responses": {str(status): {"description": "Success", "content": {content: {"schema": response}}},
                            "default": {"description": "API error", "content": {BASE: {"schema": ref("Error")}}}}}
    if body is not None:
        entry["requestBody"] = {"required": True, "content": {request_content: {"schema": body}}}
    if params:
        entry["parameters"] = list(params)
    return method, entry


def describe(*operations):
    return dict(operations)


PATHS = {
    "/advisory-catalog": describe(operation("get", 200, ref("AdvisoryCatalog"))),
    "/advisory-catalog/refresh": describe(operation("post", 202, ref("AdvisoryCatalog"), MAP)),
    "/advisory-catalog/source": describe(operation("post", 200, ref("AdvisoryCatalog"),
                                                 obj(["source"], source=CATALOG_SOURCE))),
    "/advisory-catalog/schedule": describe(operation("post", 200, ref("AdvisoryCatalog"),
                                                    obj(["refreshIntervalHours"], refreshIntervalHours={"type": "integer", "enum": [0, 24, 168]}))),
    "/settings/ai": describe(operation("get", 200, ref("AiDiagnostics"))),
    "/settings/ai/test": describe(operation("post", 202, ref("AiDiagnostics"), MAP)),
    "/settings/storage": describe(operation("get", 200, ref("StorageUsage"))),
    "/settings/storage/backup": describe(operation("get", 200, {"type": "string", "format": "binary"},
                                                   content="application/vnd.sqlite3")),
    "/snapshots": describe(operation("get", 200, array(ref("Snapshot")))),
    "/snapshots/library": describe(operation("get", 200, array(ref("SnapshotLibraryItem")))),
    "/snapshots/{id}/runs": describe(operation("get", 200, array(ref("SnapshotRun")))),
    "/snapshots/{id}/comparison": describe(operation("get", 200, ref("SnapshotComparison"), params=(
        {"name": "againstSnapshotId", "in": "query", "required": True, "schema": STRING},))),
    "/snapshots/{id}/rename": describe(operation("post", 200, ref("Snapshot"), obj(["label"], label=STRING))),
    "/snapshots/import-repository": describe(operation("post", 201, ref("Snapshot"), obj(["url"], url=STRING))),
    "/training/runs": describe(operation("post", 202, ref("RunAccepted"),
                                         obj(["variant"], variant=choice("before", "fixed")))),
    "/snapshots/import": describe(operation("post", 201, ref("Snapshot"),
                                            obj(["file"], file={"type": "string", "format": "binary"}), request_content="multipart/form-data")),
    "/workflows": describe(operation("get", 200, array(ref("Workflow"))),
                           operation("post", 201, ref("Workflow"), ref("WorkflowDraft"))),
    "/workflows/{id}": describe(operation("get", 200, ref("Workflow"))),
    "/workflows/{id}/github-actions": describe(operation("get", 200, STRING, content="application/yaml")),
    "/ci/client": describe(operation("get", 200, STRING, content="text/plain")),
    "/workflows/{id}/save": describe(operation("post", 200, ref("Workflow"), ref("WorkflowUpdate"))),
    "/workflows/{id}/runs": describe(operation("get", 200, array(ref("Run"))),
                                     operation("post", 202, ref("RunAccepted"), ref("RunRequest"))),
    "/workflows/draft": describe(operation("post", 200, ref("WorkflowDraft"), obj(["prompt"], prompt=STRING))),
    "/node-templates/draft": describe(operation("post", 200, ref("NodeTemplateDraft"), obj(["prompt"], prompt=STRING))),
    "/node-templates": describe(operation("get", 200, array(ref("NodeTemplate"))),
                                operation("post", 201, ref("NodeTemplate"), ref("NodeTemplateDraft"))),
    "/workflows/{id}/findings/{findingId}/history": describe(operation("get", 200, ref("FindingHistory"))),
    "/workflows/{id}/findings": describe(operation("get", 200, ref("FindingsOverview"))),
    "/workflows/{id}/findings/{findingId}/review": describe(operation("post", 200, ref("FindingReview"),
                                                                     obj(["status"], status=FINDING_REVIEW_STATUS, reason=STRING))),
    "/runs/{id}": describe(operation("get", 200, ref("Run"))),
    "/runs/{id}/events": describe(operation("get", 200, {"type": "string", "description": "SSE data is RunEvent JSON"},
                                             content="text/event-stream", params=({"name":"Last-Event-ID","in":"header","schema":INTEGER},))),
    "/runs/{id}/comparison": describe(operation("get", 200, ref("Comparison"),
                                                 params=({"name":"againstRunId","in":"query","schema":STRING},))),
    "/runs/{id}/report": describe(operation("get", 200, obj(["findings"], findings=array(MAP)),
                                             params=({"name":"format","in":"query","schema":choice("json","markdown")},))),
    "/runs/{id}/threshold-preview": describe(operation("post", 200, ref("ThresholdPreview"),
                                                       obj(["nodeId", "value"], nodeId=STRING, value={"type":["integer","string","object"]}))),
    "/runs/{id}/fix-preview": describe(operation("post", 200, ref("FixPreview"), obj(["findingId"], findingId=STRING))),
    "/runs/{id}/apply-fix": describe(operation("post", 201, obj(["snapshotId"], snapshotId=STRING),
                                                obj(["previewId"], previewId=STRING))),
    "/templates": describe(operation("get", 200, array(ref("Template"))),
                           operation("post", 201, ref("Template"),
                                     obj(["workflowId", "name", "description"], workflowId=STRING, name=STRING, description=STRING))),
    "/templates/{id}/copy": describe(operation("post", 201, ref("Workflow"), MAP)),
    "/templates/{id}": describe(operation("get", 200, ref("Template"))),
    "/templates/{id}/yaml": describe(operation("get", 200, STRING, content="application/yaml")),
    "/templates/import": describe(operation("post", 201, ref("Workflow"),
                                             {"type": "string", "format": "binary"}, request_content="application/yaml")),
    "/connections": describe(operation("get", 200, array(ref("Connection"))),
                             operation("post", 201, ref("Connection"), ref("ConnectionInput"))),
    "/connections/{id}/edit": describe(operation("post", 200, ref("Connection"),
                                                  obj(name=STRING, configured=BOOL, token={"type": "string", "writeOnly": True},
                                                      chatId={"type": ["string", "integer"]}))),
    "/connections/{id}/test": describe(operation("post", 200, obj(["messageId"], messageId=INTEGER), MAP)),
}

for path, entry in PATHS.items():
    params = [part[1:-1] for part in path.split("/") if part.startswith("{")]
    if params:
        entry["parameters"] = [{"in": "path", "name": name, "required": True, "schema": STRING} for name in params]
PATHS["/runs/{id}/report"]["get"]["responses"]["200"]["content"]["text/markdown"] = {"schema": STRING}

OPENAPI = {"openapi": "3.1.0", "info": {"title": "Cyber Garden Word v2", "version": "2.0"},
           "servers": [{"url": "/api/v1"}], "paths": PATHS, "components": {"schemas": SCHEMAS}}
