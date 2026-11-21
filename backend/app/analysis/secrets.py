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
PEM_NEWLINE = r"(?:\r?\n|(?:\\r)?\\n)"
PRIVATE_KEY = re.compile(
    r"-----BEGIN (?P<kind>(?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY)-----[ \t]*"
    + PEM_NEWLINE + r"(?:[ \t]*[A-Za-z0-9+/=]{1,80}[ \t]*" + PEM_NEWLINE + r")+"
    + r"[ \t]*-----END (?P=kind)-----"
)
GITHUB_TOKEN = re.compile(r"(?<![\w-])(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})(?![\w-])")
SLACK_TOKEN = re.compile(r"(?<![\w-])xox[bp]-\d{8,15}-\d{8,15}-(?:\d{8,15}-)?[A-Za-z0-9]{20,64}(?![\w-])")
FORMATS = (
    (PRIVATE_KEY, "SECRET-PRIVATE-KEY", "private-key", "Приватный ключ в исходниках"),
    (GITHUB_TOKEN, "SECRET-GITHUB-TOKEN", "github-token", "Токен GitHub в исходниках"),
    (SLACK_TOKEN, "SECRET-SLACK-TOKEN", "slack-token", "Токен Slack в исходниках"),
)
CONFIG_COMMENTS = re.compile(r"(?m)^[ \t]*[#!][^\n]*")
CONFIG_SUFFIXES = (".yml", ".yaml", ".properties", ".env")
KEY_SUFFIXES = (".pem", ".key")
KOTLIN_SUFFIXES = (".kt", ".kts")


def secret_source(path: str) -> bool:
    return path.lower().endswith(CONFIG_SUFFIXES + KEY_SUFFIXES) or path.endswith(KOTLIN_SUFFIXES)


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


def scan_secret_formats(text, path, node_id, covered_lines):
    for pattern, rule, kind, title in FORMATS:
        for occurrence, match in enumerate(pattern.finditer(text), 1):
            line = line_at(text, match.start())
            if line in covered_lines:
                continue
            yield finding(rule, node_id, "critical", title, path, line,
                          "Значение скрыто: ••••", str(occurrence), category="SECRET", classification=kind,
                          endLine=line_at(text, match.end()),
                          remediation="Замените скомпрометированный секрет и храните новый в менеджере секретов.")


def scan_secrets(snapshot: Snapshot, node_id: str = "secret") -> list[Finding]:
    results = {}
    for path, content in sorted(snapshot.files.items()):
        occurrences, covered_lines = {}, set()

        def add(key, line, kind, end=None):
            normalized = key.lower()
            occurrences[normalized] = occurrences.get(normalized, 0) + 1
            item = finding("SECRET-01", node_id, "critical", "Секрет в настройках", path, line,
                           "Значение скрыто: ••••", f"{normalized}:{occurrences[normalized]}",
                           category="SECRET", classification=kind, endLine=end,
                           remediation="Удалите значение из исходников и передавайте его через защищённую настройку.")
            results[item.id] = item
            covered_lines.add(line)

        if path.lower().endswith(CONFIG_SUFFIXES):
            for line, config_line in enumerate(content.splitlines(), 1):
                match = CONFIG.match(config_line)
                if not match or not SENSITIVE.search(match["key"]):
                    continue
                key, value = match["key"], match["value"]
                fallback = re.fullmatch(r"\$\{[A-Za-z_][\w.]*:([^}]*)\}", value.strip().strip("\"'"))
                if fallback and literal_value(fallback[1]):
                    add(key, line, "secret-fallback")
                elif literal_value(value):
                    add(key, line, classify(key))
            text = CONFIG_COMMENTS.sub(lambda match: " " * len(match[0]), content)
        elif path.endswith(KOTLIN_SUFFIXES):
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
        elif path.lower().endswith(KEY_SUFFIXES):
            text = content
        else:
            continue
        for item in scan_secret_formats(text, path, node_id, covered_lines):
            results[item.id] = item
    return list(results.values())
