import re

from .source import kotlin_source, line_at
from .types import Finding, Snapshot, finding


SQL = re.compile(r'\b(?:jdbc|jdbcTemplate)\.(?:query\w*|execute|update)\s*\(\s*"(?P<query>[^"\n]*)"', re.I)
INPUT = re.compile(r"@(?:RequestParam|PathVariable)(?:\([^)]*\))?\s+(\w+)")
INTERPOLATION = re.compile(r"\$(?:\{(\w+)\}|(\w+))")
TLS = re.compile(r'\bhostnameVerifier\s*=\s*HostnameVerifier\s*\{[^{}\n]*->\s*true\s*\}')
CORS = re.compile(r'\b(?:allowedOriginPatterns|allowedOrigins)\s*=\s*(?:listOf|setOf)\(\s*"\*"\s*\)')
CREDENTIALS = re.compile(r"\ballowCredentials\s*=\s*true\b")
ROUTE = re.compile(r'\brequestMatchers\s*\(\s*(?:[\w.]+\s*,\s*)?"([^"\n]+)"\s*\)\s*\.permitAll\s*\(')
RESTRICTED = re.compile(r'\brequestMatchers\s*\(\s*(?:[\w.]+\s*,\s*)?"([^"\n]+)/\*\*"\s*\)\s*\.(?:hasRole|hasAuthority|authenticated)\(')
OBJECT_QUERY = re.compile(r'\bfun\s+(\w+)\(\s*(\w+(?:Id|Code))\s*:[^)\n]+\)[^=\n]*=\s*\w+\.query\(\s*"(?P<sql>SELECT[^"\n]+)"', re.I)
OWNER = re.compile(r"\b(?:customer|owner|account|tenant|user)_id\b", re.I)


def scan_kotlin(snapshot: Snapshot, node_id: str = "code") -> list[Finding]:
    results = {}
    for path, content in sorted(snapshot.files.items()):
        if not path.endswith(".kt"):
            continue
        text = kotlin_source(content)

        def add(rule, kind, title, start, end, anchor, remediation):
            line = line_at(text, start)
            end_line = min(line_at(text, end), line + 14)
            item = finding(rule, node_id, "high", title, path, line, title, anchor,
                           category="SAST", classification=kind, endLine=end_line, remediation=remediation)
            results.setdefault(item.id, item)

        for match in SQL.finditer(text):
            prefix = text[:match.start()]
            function_start = prefix.rfind("fun ")
            signature = prefix[function_start:] if function_start >= 0 else ""
            inputs = set(INPUT.findall(signature))
            variables = {left or right for left, right in INTERPOLATION.findall(match["query"])}
            if inputs & variables:
                name = re.match(r"fun\s+(\w+)", signature)
                add("SAST-SQL", "sql-injection", "Входной параметр попадает в SQL", function_start,
                    match.end(), name[1] if name else "query", "Передавайте параметр отдельно от текста SQL.")
        for match in TLS.finditer(text):
            add("SAST-TLS", "tls-verification", "Проверка имени сервера отключена", match.start(),
                match.end(), "hostname-verifier", "Используйте штатную проверку имени сервера.")
        for match in CORS.finditer(text):
            end = text.find("}", match.end())
            start = text.rfind("{", 0, match.start()) + 1
            credentials = CREDENTIALS.search(text, start, end if end >= 0 else match.end())
            if credentials:
                add("SAST-CORS", "credentialed-cors", "CORS пропускает любой источник с учётными данными",
                    min(match.start(), credentials.start()), max(match.end(), credentials.end()),
                    "credentialed-wildcard", "Ограничьте список разрешённых источников.")
        if "HttpSecurity" in text or "SecurityFilterChain" in text:
            for match in ROUTE.finditer(text):
                route = match[1]
                overrides = any(route.startswith(protected[1] + "/") for protected in RESTRICTED.finditer(text, match.end()))
                if overrides or re.search(r"/(?:admin|internal|manage|actuator)(?:/|$)", route, re.I):
                    add("SAST-01", "route-authorization", "Служебный маршрут открыт", match.start(),
                        match.end(), route, "Примените требуемую роль до публичного правила.")
        if "JdbcTemplate" in text and "@Repository" in text:
            for match in OBJECT_QUERY.finditer(text):
                clause = re.split(r"\bwhere\b", match["sql"], maxsplit=1, flags=re.I)
                if len(clause) == 2 and OWNER.search(clause[0]) and not OWNER.search(clause[1]) and "?" in clause[1]:
                    add("SAST-OBJECT", "object-authorization", "Запрос объекта не ограничен владельцем",
                        match.start(), match.end(), match[1], "Ограничьте выборку владельцем или проверьте право доступа.")
    return list(results.values())