from .gradle import gradle_script
from .sca import project_dependencies, version_parts
from .secrets import secret_source
from .spring_config import APPLICATION
from .types import Snapshot


SCAN_LABELS = {"secrets": "Поиск секретов", "sca": "SCA", "sast": "SAST", "gradle": "Gradle"}
REASONS = {"unknownAlias": "псевдоним отсутствует в каталоге версий",
           "unknownVersion": "не удалось определить версию",
           "unsupportedVersion": "версия не поддерживается сравнением SCA"}
SAMPLE_LIMIT = 8


def dependency_coverage(snapshot: Snapshot):
    unresolved = []
    comparable = 0
    for path, dependency in project_dependencies(snapshot, unresolved=unresolved):
        try:
            version_parts(dependency.version)
        except ValueError:
            unresolved.append((path, dependency.line, "unsupportedVersion"))
        else:
            comparable += 1
    return {"recognized": comparable + len(unresolved), "comparable": comparable,
            "unresolved": len(unresolved), "examples": [
                {"path": path, "line": line, "reason": reason}
                for path, line, reason in sorted(unresolved)[:SAMPLE_LIMIT]]}


def snapshot_coverage(snapshot: Snapshot, scanned: set[str]):
    files = snapshot.files
    counts = {}
    if "secrets" in scanned:
        counts["secrets"] = sum(secret_source(path) for path in files)
    if "sast" in scanned:
        counts["sast"] = sum(path.endswith(".kt") or bool(APPLICATION.fullmatch(path.rsplit("/", 1)[-1]))
                             for path in files)
    if "gradle" in scanned:
        counts["gradle"] = sum(gradle_script(path) for path in files)
    result = {"filesInSnapshot": len(files), "filesByAnalyzer": counts}
    if "sca" in scanned:
        result["sca"] = dependency_coverage(snapshot)
    return result


def snapshot_summary(title, coverage):
    lines = [f"{title} · файлов в снимке: {coverage['filesInSnapshot']}"]
    lines.extend(f"{SCAN_LABELS[name]} · файлов по правилам анализатора: {count}"
                 for name, count in coverage["filesByAnalyzer"].items())
    if sca := coverage.get("sca"):
        lines.append(f"SCA · версию можно сравнить у {sca['comparable']} из {sca['recognized']} "
                     f"распознанных записей. Пропусков: {sca['unresolved']}.")
        lines.extend(f"{item['path']}:{item['line']} · {REASONS[item['reason']]}" for item in sca["examples"])
        if sca["unresolved"] > len(sca["examples"]):
            lines.append("Показаны только первые причины пропусков.")
    return lines


def summarize_coverage(snapshot: Snapshot, base: Snapshot | None, scanned: set[str]):
    current = snapshot_coverage(snapshot, scanned)
    result = {"completed": sorted(scanned), "current": current}
    completed = ", ".join(label for name, label in SCAN_LABELS.items() if name in scanned) or "нет"
    pending = ", ".join(label for name, label in SCAN_LABELS.items() if name not in scanned) or "нет"
    lines = [f"Выполнены к этому блоку: {completed}.", f"К этому блоку не выполнялись: {pending}.", "",
             *snapshot_summary("Текущий снимок", current)]
    if base is not None:
        baseline = snapshot_coverage(base, scanned)
        result["base"] = baseline
        lines.extend(["", *snapshot_summary("База · доступность данных", baseline)])
    return result, "\n".join(lines)
