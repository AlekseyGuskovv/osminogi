from collections import defaultdict
from datetime import UTC, datetime
from pathlib import PurePosixPath

from .analysis.sca import project_dependencies
from .analysis.types import Snapshot
from .contract import ApiError


def snapshot_ref(row):
    public = {"id": row["id"], "label": row["label"], "createdAt": row.get("createdAt"),
              "fileCount": len(row["files"])}
    if "organizerCatalog" in row:
        public["catalogSource"] = "organizer"
    return public


def save_version(store, snapshot, label, *, organizer_catalog=None):
    row = {"id": snapshot.id, "label": label, "files": snapshot.files, "fileCount": len(snapshot.files),
           "createdAt": datetime.now(UTC).isoformat()}
    if organizer_catalog is not None:
        row["organizerCatalog"] = organizer_catalog
    return snapshot_ref(store.insert_or_get("snapshot", snapshot.id, row))


def require_snapshot(store, key):
    row = store.get("snapshot", key)
    if row is None:
        raise ApiError(404, "SNAPSHOT_NOT_FOUND", "Снимок не найден.")
    return row


def rename_snapshot(store, key, label):
    if not isinstance(label, str) or not 0 < len(label.strip()) <= 160:
        raise ApiError(422, "INVALID_SNAPSHOT_LABEL", "Укажите имя снимка длиной от 1 до 160 символов.")
    row = require_snapshot(store, key)
    row["label"] = label.strip()
    store.put("snapshot", key, row)
    return snapshot_ref(row)


def snapshot_run_index(runs):
    indexed = defaultdict(list)
    for row in runs:
        summary = {"id": row["id"], "workflowId": row.get("workflowId"), "createdAt": row.get("createdAt"),
                   "status": "succeeded" if row["status"] == "partial" else row["status"],
                   "ci": "error" if row.get("ci") == "unchecked" else row.get("ci") or "pending"}
        current, base = row.get("snapshotId"), row.get("baseSnapshotId")
        if current:
            indexed[current].append({**summary, "role": "current"})
        if base and base != current:
            indexed[base].append({**summary, "role": "base"})
    return indexed


def snapshot_library(store):
    indexed = snapshot_run_index(store.snapshot_run_rows())
    snapshots = sorted(store.snapshot_refs(), key=lambda row: row.get("createdAt") or "", reverse=True)
    return [{**row, "runCount": len(indexed[row["id"]]),
             "latestRun": next((run for run in indexed[row["id"]] if run["role"] == "current"), None)}
            for row in snapshots]


def dependency_versions(snapshot):
    versions, unresolved = defaultdict(set), []
    for path, item in project_dependencies(snapshot, unresolved=unresolved):
        versions[(str(PurePosixPath(path).parent), item.group, item.name)].add(item.version)
    return versions, len(unresolved)


def compare_snapshots(base, current):
    before, after = base["files"], current["files"]
    old_versions, old_unresolved = dependency_versions(Snapshot(base["id"], before))
    new_versions, new_unresolved = dependency_versions(Snapshot(current["id"], after))
    dependencies = []
    for key in sorted(old_versions.keys() | new_versions.keys()):
        module, group, artifact = key
        previous = sorted(old_versions.get(key, ()))
        selected = sorted(new_versions.get(key, ()))
        if previous != selected:
            dependencies.append({"module": module, "group": group, "artifact": artifact,
                                 "before": previous, "after": selected})
    return {"baseSnapshotId": base["id"], "snapshotId": current["id"],
            "files": {"added": sorted(after.keys() - before.keys()),
                      "modified": sorted(path for path in before.keys() & after.keys() if before[path] != after[path]),
                      "removed": sorted(before.keys() - after.keys())},
            "dependencies": dependencies, "unresolvedBefore": old_unresolved, "unresolvedAfter": new_unresolved}
