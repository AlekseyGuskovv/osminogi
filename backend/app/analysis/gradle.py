from collections import Counter
import re

from .sca import LOCKFILE, gradle_build_inputs, read_declarations, read_lockfile
from .source import kotlin_source, line_at
from .types import Finding, Snapshot, finding


GRADLE_SCRIPTS = ("build.gradle.kts", "settings.gradle.kts")
REPOSITORY = re.compile(r"\b(?:maven|ivy)\s*([({])")
DELIMITERS = re.compile(r"[(){}]")
REPO_BODY = re.compile(r"\s*\{")
HTTP_ARGUMENT = re.compile(r'\(\s*(?:url\s*=\s*)?(?:uri\s*\(\s*)?"http://', re.I)
HTTP_SETTING = re.compile(r'\b(?:url\s*=|setUrl\s*\()\s*(?:uri\s*\(\s*)?"http://', re.I)
ALLOW_HTTP = re.compile(r"\b(?:(?:isAllowInsecureProtocol|allowInsecureProtocol)\s*=\s*true\b"
                        r"|setAllowInsecureProtocol\s*\(\s*true\s*\))")
# Gradle ranges also accept reversed square brackets for exclusive bounds.
DYNAMIC_VERSION = re.compile(r"[\w.-]*\+|latest\.[\w.-]+|[][(].*,.*[])[]", re.I)


def gradle_script(path: str) -> bool:
    return path.rsplit("/", 1)[-1] in GRADLE_SCRIPTS


def closing_delimiter(code, start):
    opening = code[start]
    closing = {"(": ")", "{": "}"}[opening]
    depth = 0
    for match in DELIMITERS.finditer(code, start):
        if match[0] == opening:
            depth += 1
        elif match[0] == closing:
            depth -= 1
            if depth == 0:
                return match.end()
    return start + 1


def scan_repositories(path, content, node_id):
    text = kotlin_source(content)
    code = kotlin_source(content, keep_strings=False)
    occurrences = Counter()
    for match in REPOSITORY.finditer(code):
        start = match.start(1)
        end = closing_delimiter(code, start)
        if code[start] == "(" and (body := REPO_BODY.match(code, end)):
            end = closing_delimiter(code, body.end() - 1)
        insecure = ALLOW_HTTP.search(code, start, end)
        http = HTTP_ARGUMENT.match(text, start, end) or next(
            (url for url in HTTP_SETTING.finditer(text, start, end) if not code[url.start()].isspace()), None)
        if http:
            rule, severity = "GRADLE-HTTP-REPO", "high" if insecure else "medium"
            title, offset = "Репозиторий зависимостей использует HTTP", http.start()
        elif insecure:
            rule, severity = "GRADLE-INSECURE-PROTOCOL", "medium"
            title, offset = "Разрешён небезопасный протокол репозитория", insecure.start()
        else:
            continue
        occurrences[rule] += 1
        yield finding(rule, node_id, severity, title, path, line_at(text, offset), title,
                      str(occurrences[rule]), category="GRADLE", classification="insecure-repository",
                      remediation="Используйте HTTPS и уберите разрешение небезопасного протокола.")


def scan_gradle(snapshot: Snapshot, node_id: str = "gradle") -> list[Finding]:
    results = [row for path, content in sorted(snapshot.files.items()) if gradle_script(path)
               for row in scan_repositories(path, content, node_id)]
    for path, text, properties, catalog in gradle_build_inputs(snapshot):
        lock_path = path.removesuffix("build.gradle.kts") + LOCKFILE
        locked = {(row.group, row.name) for row in read_lockfile(snapshot.files.get(lock_path, ""))}
        occurrences = Counter()
        for declaration in read_declarations(text, properties, catalog=catalog):
            if declaration.group is None or not DYNAMIC_VERSION.fullmatch(declaration.version):
                continue
            coordinate = (declaration.group, declaration.name)
            has_lock = coordinate in locked
            occurrences[coordinate] += 1
            results.append(finding(
                "GRADLE-DYNAMIC-VERSION", node_id, "low" if has_lock else "medium",
                "Динамическая версия зависимости", path, declaration.line,
                "Зависимость есть в lock-файле модуля." if has_lock else "Запись в lock-файле модуля не найдена.",
                f"{declaration.group}:{declaration.name}:{occurrences[coordinate]}", category="GRADLE",
                classification="dynamic-version", remediation="Укажите фиксированную версию или настройте блокировку зависимостей.",
            ))
    return results
