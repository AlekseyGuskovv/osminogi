from collections.abc import Callable

from .gradle import scan_gradle
from .sca import Advisory, DependencyScanner
from .sast import scan_kotlin
from .secrets import scan_secrets
from .types import Finding, Snapshot


Analyzer = Callable[[Snapshot, str], list[Finding]]


def register_analysis_handlers(advisories: list[Advisory]) -> dict[str, Analyzer]:
    return {"secrets": scan_secrets, "sca": DependencyScanner(advisories), "sast": scan_kotlin, "gradle": scan_gradle}
