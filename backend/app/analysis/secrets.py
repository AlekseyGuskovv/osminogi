import re

from .types import Finding, Snapshot, finding


SECRET_SETTING = re.compile(
    r"""^\s*(?P<key>[\w.-]*(?:password|passwd|api[-_.]?key|token|secret)[\w.-]*)["']?\s*[:=]\s*(?P<value>.+)$""",
    re.IGNORECASE,
)


def scan_secrets(snapshot: Snapshot, node_id: str = "secret") -> list[Finding]:
    results = []
    for path, content in sorted(snapshot.files.items()):
        if not path.lower().endswith((".yml", ".yaml", ".properties", ".env", ".kt", ".kts")):
            continue
        occurrences: dict[str, int] = {}
        for line, text in enumerate(content.splitlines(), 1):
            match = SECRET_SETTING.match(text.lstrip('"').lstrip("'"))
            if not match:
                continue
            key = match["key"]
            normalized_key = key.lower()
            occurrence = occurrences.get(normalized_key, 0) + 1
            occurrences[normalized_key] = occurrence
            value = match["value"].split(" #", 1)[0].strip().strip("\"'")
            if (not value or value.startswith(("${", "$", "System.getenv(", "env("))
                    or value.lower() in {"null", "~", "changeme", "example", "placeholder"}):
                continue
            results.append(finding("SECRET-01", node_id, "critical", "Секрет в настройках",
                                   path, line, f"{key}: ••••", f"{normalized_key}:{occurrence}"))
    return results