from collections.abc import Callable

from .gradle import scan_gradle
from .sca import Advisory, scan_dependencies
from .sast import scan_kotlin
from .secrets import scan_secrets
from .types import Finding, Snapshot


Analyzer = Callable[[Snapshot, str], list[Finding]]


def register_analysis_handlers(advisories: list[Advisory]) -> dict[str, Analyzer]:
    def sca(snapshot: Snapshot, node_id: str) -> list[Finding]:
        return scan_dependencies(snapshot, advisories, node_id)

    return {"secrets": scan_secrets, "sca": sca, "sast": scan_kotlin, "gradle": scan_gradle}
