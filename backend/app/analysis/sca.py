from dataclasses import dataclass
from itertools import zip_longest
import re
import tomllib

from .source import kotlin_source, line_at
from .types import Finding, Snapshot, finding


@dataclass(frozen=True)
class Dependency:
    group: str
    name: str
    version: str
    line: int


@dataclass(frozen=True)
class VersionRange:
    lower: str | None = None
    upper: str | None = None
    include_lower: bool = True
    include_upper: bool = False


@dataclass(frozen=True)
class Advisory:
    id: str
    group: str
    name: str
    severity: str
    ranges: list[VersionRange]
    aliases: tuple[str, ...] = ()


SCOPE = r"(?:api|implementation|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|developmentOnly)"
DECLARATION_START = r'(?m)^\s*(?:' + SCOPE + r'\s*\(\s*|add\s*\(\s*"' + SCOPE + r'"\s*,\s*)'
DECLARATION = re.compile(
    DECLARATION_START + r'(?:platform\(\s*)?"(?P<group>[^":$\s]+):(?P<name>[^":$\s]+)(?::(?P<version>[^":\s]+))?"'
)
CATALOG_REFERENCE = re.compile(DECLARATION_START + r"(?:platform\(\s*)?libs\.(\w+(?:\.\w+)*)\s*\)")
CATALOG_PATH = "gradle/libs.versions.toml"
LOCKFILE = "gradle.lockfile"
PROPERTY = re.compile(r'(?m)^\s*([\w.-]+)\s*[=:]\s*([^\s#!]+)')
LOCAL = re.compile(r'(?m)^\s*(?:val|var)\s+(\w+)(?:\s*:\s*String)?\s*=\s*(?:"([^"\n]+)"|(?:providers\.)?gradleProperty\("([^"]+)"\)|findProperty\("([^"]+)"\))')
LOCKED = re.compile(r"([^:=\s]+):([^:=\s]+):([^=\s]+)=.+")
REFERENCE = re.compile(r"\$(?:\{([\w.-]+)\}|([\w]+))")
VERSION = re.compile(r"(\d+(?:\.\d+)*)(?:[-.]([A-Za-z]+)[.-]?(\d+)?)?(?:\+[.\w-]+)?")
QUALIFIERS = {"snapshot": -5, "alpha": -4, "a": -4, "beta": -3, "b": -3,
              "milestone": -2, "m": -2, "rc": -1, "cr": -1, "": 0,
              "final": 0, "release": 0, "ga": 0, "sp": 1}


def read_lockfile(text: str) -> list[Dependency]:
    return [Dependency(*match.groups(), line) for line, entry in enumerate(text.splitlines(), 1)
            if (match := LOCKED.fullmatch(entry))]


def catalog_version(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return value.get("strictly") or value.get("require") or ""
    return ""


def read_version_catalog(text: str) -> dict[str, tuple[str, str, str]]:
    try:
        document = tomllib.loads(text)
    except tomllib.TOMLDecodeError as error:
        raise ValueError("Некорректный каталог gradle/libs.versions.toml.") from error
    versions = document.get("versions", {})
    libraries = document.get("libraries", {})
    if not isinstance(versions, dict) or not isinstance(libraries, dict):
        raise ValueError("Некорректный каталог gradle/libs.versions.toml.")
    result = {}
    for alias, spec in libraries.items():
        if isinstance(spec, str):
            parts = spec.split(":")
            if len(parts) != 3:
                continue
            group, name, version = parts
        elif isinstance(spec, dict):
            module = spec.get("module")
            group, _, name = module.partition(":") if isinstance(module, str) else ("", "", "")
            group, name = spec.get("group", group), spec.get("name", name)
            value = spec.get("version")
            if isinstance(value, dict) and isinstance(value.get("ref"), str):
                value = versions.get(value["ref"])
            version = catalog_version(value)
        else:
            continue
        if isinstance(group, str) and isinstance(name, str) and isinstance(version, str) and group and name:
            result[re.sub(r"[-_.]", ".", alias)] = (group, name, version)
    return result


def read_dependencies(text: str, properties="", lockfile="", *, catalog=None) -> list[Dependency]:
    text = kotlin_source(text)
    values = dict(PROPERTY.findall(properties))
    for name, literal, provider, property_name in LOCAL.findall(text):
        value = literal or values.get(provider or property_name)
        if value:
            values[name] = value
    locked = {(row.group, row.name): row.version for row in read_lockfile(lockfile)}
    declarations = []
    for match in DECLARATION.finditer(text):
        group, name = match["group"], match["name"]
        version = REFERENCE.sub(lambda ref: values.get(ref[1] or ref[2], ref[0]), match["version"] or "")
        declarations.append((group, name, version, match.start("group")))
    if catalog:
        for match in CATALOG_REFERENCE.finditer(text):
            if match[1] in catalog:
                declarations.append((*catalog[match[1]], match.start(1)))
    result = []
    for group, name, raw, offset in declarations:
        version = locked.get((group, name)) or raw
        if version and "$" not in version:
            result.append(Dependency(group, name, version, line_at(text, offset)))
    return result


def version_parts(version: str) -> tuple[tuple[int, ...], tuple[int, int]]:
    match = VERSION.fullmatch(version)
    if not match or (match[2] or "").lower() not in QUALIFIERS:
        raise ValueError("Unsupported Gradle version")
    return tuple(map(int, match[1].split("."))), (QUALIFIERS[(match[2] or "").lower()], int(match[3] or 0))


def compare_versions(left: str, right: str) -> int:
    a, a_suffix = version_parts(left)
    b, b_suffix = version_parts(right)
    for first, second in zip_longest(a, b, fillvalue=0):
        if first != second:
            return (first > second) - (first < second)
    return (a_suffix > b_suffix) - (a_suffix < b_suffix)


def version_in_range(version: str, bounds: VersionRange) -> bool:
    lower = compare_versions(version, bounds.lower) if bounds.lower is not None else 1
    upper = compare_versions(version, bounds.upper) if bounds.upper is not None else -1
    return (lower > 0 or lower == 0 and bounds.include_lower) and (
        upper < 0 or upper == 0 and bounds.include_upper)


def project_dependencies(snapshot: Snapshot):
    catalogs = {}
    covered_locks = {}
    for path, content in sorted(snapshot.files.items()):
        if path.rsplit("/", 1)[-1] != "build.gradle.kts":
            continue
        prefix = path.removesuffix("build.gradle.kts")
        properties = snapshot.files.get(prefix + "gradle.properties", snapshot.files.get("gradle.properties", ""))
        lock_path = prefix + LOCKFILE if prefix + LOCKFILE in snapshot.files else LOCKFILE
        catalog_path = prefix + CATALOG_PATH if prefix + CATALOG_PATH in snapshot.files else CATALOG_PATH
        if catalog_path in snapshot.files and catalog_path not in catalogs:
            catalogs[catalog_path] = read_version_catalog(snapshot.files[catalog_path])
        lockfile = snapshot.files.get(lock_path, "")
        for dependency in read_dependencies(content, properties, lockfile, catalog=catalogs.get(catalog_path)):
            covered_locks.setdefault(lock_path, set()).add((dependency.group, dependency.name, dependency.version))
            yield path, dependency

    for path, content in sorted(snapshot.files.items()):
        if path.rsplit("/", 1)[-1] != LOCKFILE:
            continue
        covered = covered_locks.get(path, ())
        for dependency in read_lockfile(content):
            if (dependency.group, dependency.name, dependency.version) not in covered:
                yield path, dependency


def scan_dependencies(snapshot: Snapshot, advisories: list[Advisory],
                      node_id: str = "deps") -> list[Finding]:
    results = {}
    by_coordinate = {}
    for advisory in advisories:
        by_coordinate.setdefault((advisory.group, advisory.name), []).append(advisory)
    for path, dependency in project_dependencies(snapshot):
        coordinate = f"{dependency.group}:{dependency.name}"
        for advisory in by_coordinate.get((dependency.group, dependency.name), ()):
            if any(version_in_range(dependency.version, bounds) for bounds in advisory.ranges):
                item = finding("SCA-01", node_id, advisory.severity,
                               "Зависимость требует обновления", path, dependency.line,
                               f"{coordinate}:{dependency.version}", f"{coordinate}:{advisory.id}",
                               advisory.id, category="SCA", group=dependency.group, artifact=dependency.name,
                               version=dependency.version,
                               remediation="Обновите зависимость до версии вне затронутого диапазона.")
                results.setdefault(item.id, item)
    return list(results.values())
