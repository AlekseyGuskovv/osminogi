import re

from .source import kotlin_source, line_at
from .types import Finding, Snapshot, finding


SENSITIVE = re.compile(r"password|passwd|api[-_.]?key|token|secret|authorization", re.I)
CONFIG = re.compile(r"""^\s*["']?(?P<key>[\w.-]+)["']?\s*[:=]\s*(?P<value>.+)$""")
LITERAL = r'"(?P<value>(?:\\.|[^"\\])*)"'
ASSIGNMENT = re.compile(r"\b(?:val|var)\s+(?P<name>\w+)\s*(?::\s*String\??\s*)?=\s*" + LITERAL + r"(?=\s*(?:$|;))", re.M)
ENV_FALLBACK = re.compile(r"\b(?:val|var)\s+(?P<name>\w+)\s*=\s*System\.getenv\([^)\n]+\)\s*\?:\s*" + LITERAL)
BEARER = re.compile(r"\bsetBearerAuth\(\s*(\w+)\s*\)")
CONCAT = re.compile(r"\b(?:val|var)\s+(\w+)\s*=\s*(\w+)\s*\+\s*(\w+)\s*(?:$|;)", re.M)
PLACEHOLDER = re.compile(r"^(?:example|sample|placeholder|changeme|replace[-_ ]?me|null|~|<[^>]+>)$", re.I)


def classify(key):
    key = key.lower()
    if "password" in key or "passwd" in key:
        return "password"
    if re.search(r"api[-_.]?key", key):
        return "api-key"
    return "configuration-token"


def literal_value(value):
    text = value.split(" #", 1)[0].strip().strip("\"'")
    return bool(text and "$" not in text and not PLACEHOLDER.fullmatch(text)
                and not text.startswith(("System.getenv(", "env(", "ENC(")))


def scan_secrets(snapshot: Snapshot, node_id: str = "secret") -> list[Finding]:
    results = {}
    for path, content in sorted(snapshot.files.items()):
        occurrences = {}

        def add(key, line, kind, end=None):
            normalized = key.lower()
            occurrences[normalized] = occurrences.get(normalized, 0) + 1
            item = finding("SECRET-01", node_id, "critical", "Секрет в настройках", path, line,
                           "Значение скрыто: ••••", f"{normalized}:{occurrences[normalized]}",
                           category="SECRET", classification=kind, endLine=end,
                           remediation="Удалите значение из исходников и передавайте его через защищённую настройку.")
            results[item.id] = item

        if path.lower().endswith((".yml", ".yaml", ".properties", ".env")) or path.rsplit("/", 1)[-1] == ".env":
            for line, text in enumerate(content.splitlines(), 1):
                match = CONFIG.match(text)
                if not match or not SENSITIVE.search(match["key"]):
                    continue
                key, value = match["key"], match["value"]
                fallback = re.fullmatch(r"\$\{[A-Za-z_][\w.]*:([^}]*)\}", value.strip().strip("\"'"))
                if fallback and literal_value(fallback[1]):
                    add(key, line, "secret-fallback")
                elif literal_value(value):
                    add(key, line, classify(key))
        elif path.endswith((".kt", ".kts")):
            text = kotlin_source(content)
            literals = {match["name"]: match for match in ASSIGNMENT.finditer(text) if literal_value(match["value"])}
            for key, match in literals.items():
                if SENSITIVE.search(key):
                    add(key, line_at(text, match.start()), classify(key))
            for match in ENV_FALLBACK.finditer(text):
                name = match["name"]
                sink = re.search(r'\b(?:setBearerAuth|header)\([^\n]*\b' + re.escape(name) + r'\b', text[match.end():])
                if literal_value(match["value"]) and (SENSITIVE.search(name) or sink):
                    add(name, line_at(text, match.start()), "secret-fallback")
            for combo in CONCAT.finditer(text):
                name, left, right = combo.groups()
                sink = next((match for match in BEARER.finditer(text, combo.end()) if match[1] == name), None)
                if sink and left in literals and right in literals:
                    start = min(literals[left].start(), literals[right].start())
                    if start < combo.start():
                        add(name, line_at(text, start), "recoverable-token", line_at(text, sink.start()))
    return list(results.values())