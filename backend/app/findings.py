from datetime import UTC, datetime

from .contract import ApiError


def completed_checks(runs):
    return [run for run in runs if run.get("ci") in {"passed", "failed"}]


def analysis_signature(run):
    if not run.get("analysisVersion") or not run.get("scanned"):
        return None
    return run["analysisVersion"], frozenset(run["scanned"])


def findings_overview(runs, reviews):
    checks = completed_checks(runs)
    if not checks:
        return {"latestRunId": None, "findings": []}
    latest = checks[0]
    latest_signature = analysis_signature(latest)
    records = {}
    for run in checks:
        comparable = latest_signature is not None and latest_signature == analysis_signature(run)
        state = "open" if run is latest else "resolved" if comparable else "unverified"
        recommendations = {item["findingId"]: item for item in run.get("recommendations", [])}
        for finding in run.get("findings", []):
            key = finding["id"]
            if key in records:
                record = records[key]
                record["occurrences"] += 1
                record["firstSeenAt"] = run.get("createdAt") or record["firstSeenAt"]
                continue
            records[key] = {
                "finding": finding,
                "category": finding.get("category") or finding["ruleId"].split("-", 1)[0],
                "state": state,
                "firstSeenAt": run.get("createdAt"),
                "lastSeenAt": run.get("createdAt"),
                "lastSeenRunId": run["id"],
                "occurrences": 1,
                "recommendation": recommendations.get(key),
                "review": reviews.get(key),
            }
    return {"latestRunId": latest["id"], "findings": list(records.values())}


def finding_history(runs, finding_id):
    entries, state, last_signature = [], None, None
    for run in reversed(completed_checks(runs)):
        signature = analysis_signature(run)
        present = any(item["id"] == finding_id for item in run.get("findings", []))
        if present:
            last_signature = signature
            if state in {"found", "returned"}:
                continue
            state = "found" if state is None else "returned"
        elif state in {"found", "returned"} and signature is not None and signature == last_signature:
            state = "resolved"
        else:
            continue
        entries.append({"runId": run["id"], "state": state})
    return {"findingId": finding_id, "entries": entries}


def review_finding(store, workflow_id, finding_id, runs, data):
    status, reason = data.get("status"), data.get("reason", "")
    if (status not in ("unreviewed", "in_progress", "false_positive")
            or not isinstance(reason, str) or len(reason.strip()) > 500):
        raise ApiError(422, "INVALID_FINDING_REVIEW", "Выберите статус и укажите причину длиной до 500 символов.")
    reason = reason.strip()
    if status == "false_positive" and not reason:
        raise ApiError(422, "FINDING_REVIEW_REASON_REQUIRED", "Укажите, почему это ложное срабатывание.")
    if not any(item["id"] == finding_id for run in completed_checks(runs) for item in run.get("findings", [])):
        raise ApiError(404, "FINDING_NOT_FOUND", "Находка не найдена в этом сценарии.")
    kind = f"finding-review:{workflow_id}"
    saved = store.get(kind, finding_id)
    if saved and saved["status"] == status and saved["reason"] == reason:
        return saved
    review = {"findingId": finding_id, "status": status, "reason": reason, "updatedAt": datetime.now(UTC).isoformat()}
    store.put(kind, finding_id, review)
    return review
