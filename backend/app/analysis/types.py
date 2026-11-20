from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import PurePosixPath


@dataclass(frozen=True)
class Snapshot:
    id: str
    files: dict[str, str]


@dataclass(frozen=True)
class Finding:
    id: str
    ruleId: str
    nodeId: str
    severity: str
    title: str
    path: str
    line: int
    evidence: str
    advisoryId: str | None = None
    category: str | None = None
    classification: str | None = None
    endLine: int | None = None
    group: str | None = None
    artifact: str | None = None
    version: str | None = None
    remediation: str | None = None


def make_finding_id(rule_id: str, path: str, anchor: str) -> str:
    """Hash a safe anchor without secret values or line numbers."""
    path = PurePosixPath(path.replace(chr(92), "/")).as_posix()
    key = [rule_id, path, " ".join(anchor.split())]
    return "F-" + sha256(json.dumps(key, ensure_ascii=False).encode()).hexdigest()[:24]


def finding(rule_id: str, node_id: str, severity: str, title: str, path: str,
            line: int, evidence: str, anchor: str, advisory_id: str | None = None,
            **details) -> Finding:
    return Finding(make_finding_id(rule_id, path, anchor), rule_id, node_id,
                   severity, title, path, line, evidence, advisory_id, **details)