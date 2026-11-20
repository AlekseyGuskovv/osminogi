from dataclasses import dataclass

from .secrets import scan_secrets
from .types import Finding, Snapshot


PATH = "src/main/resources/application.yml"
TRAINING_VALUES = {"api-key: demo-training-value", "api-key: garden-synthetic-training"}
AFTER = "api-key: ${TRAINING_API_KEY:}"


@dataclass(frozen=True)
class SuggestedPatch:
    path: str
    line: int
    before: str
    after: str


def build_safe_patch(snapshot: Snapshot, finding: Finding) -> SuggestedPatch:
    lines = snapshot.files.get(PATH, "").splitlines()
    matching_id = any(item.id == finding.id and item.line == finding.line
                      for item in scan_secrets(snapshot))
    if (finding.ruleId != "SECRET-01" or finding.path != PATH or not matching_id
            or not 1 <= finding.line <= len(lines) or lines[finding.line - 1] not in TRAINING_VALUES):
        raise ValueError("FIX_UNAVAILABLE")
    return SuggestedPatch(PATH, finding.line, "api-key: ••••", AFTER)


def apply_training_patch(snapshot: Snapshot, finding: Finding, new_id: str) -> Snapshot:
    patch = build_safe_patch(snapshot, finding)
    files = dict(snapshot.files)
    lines = files[patch.path].splitlines(keepends=True)
    line = lines[patch.line - 1]
    ending = line[len(line.rstrip("\r\n")):]
    lines[patch.line - 1] = patch.after + ending
    files[patch.path] = "".join(lines)
    return Snapshot(new_id, files)