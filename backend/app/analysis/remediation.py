from dataclasses import dataclass

from .secrets import scan_secrets
from .types import Finding, Snapshot


PATH = "src/main/resources/application.yml"
BEFORE = "api-key: demo-training-value"
AFTER = "api-key: ${DEMO_API_KEY}"


@dataclass(frozen=True)
class SuggestedPatch:
    path: str
    line: int
    before: str
    after: str


def build_safe_patch(snapshot: Snapshot, finding: Finding) -> SuggestedPatch:
    content = snapshot.files.get(PATH, "")
    lines = content.splitlines()
    matching_id = any(item.id == finding.id and item.line == finding.line
                      for item in scan_secrets(snapshot))
    if (finding.ruleId != "SECRET-01" or finding.path != PATH or not matching_id
            or not 1 <= finding.line <= len(lines) or lines[finding.line - 1] != BEFORE
            or lines.count(BEFORE) != 1):
        raise ValueError("FIX_UNAVAILABLE")
    return SuggestedPatch(PATH, finding.line, "api-key: ••••", AFTER)


def apply_training_patch(snapshot: Snapshot, finding: Finding, new_id: str) -> Snapshot:
    patch = build_safe_patch(snapshot, finding)
    files = dict(snapshot.files)
    files[patch.path] = files[patch.path].replace(BEFORE, patch.after, 1)
    return Snapshot(new_id, files)