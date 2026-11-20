import re

from .types import Finding, Snapshot, finding


PUBLIC_ADMIN = re.compile(
    r'\brequestMatchers\s*\(\s*"(?P<route>/admin(?:/[^"]*)?)"\s*\)\s*\.permitAll\s*\(\s*\)'
)


def scan_kotlin(snapshot: Snapshot, node_id: str = "code") -> list[Finding]:
    results = {}
    for path, content in sorted(snapshot.files.items()):
        if not path.endswith(".kt") or ("SecurityFilterChain" not in content and "HttpSecurity" not in content):
            continue
        for match in PUBLIC_ADMIN.finditer(content):
            line = content.count("\n", 0, match.start()) + 1
            route = match["route"]
            item = finding("SAST-01", node_id, "high", "Служебный маршрут открыт",
                           path, line, "Служебный маршрут разрешён без проверки роли", route)
            results.setdefault(item.id, item)
    return list(results.values())