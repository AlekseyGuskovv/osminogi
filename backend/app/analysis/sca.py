from dataclasses import dataclass
from itertools import zip_longest
import re

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
DECLARATION = re.compile(
    r'(?m)^\s*(?:' + SCOPE + r'\s*\(\s*|add\s*\(\s*"' + SCOPE + r'"\s*,\s*)'
    r'(?:platform\(\s*)?"(?P<group>[^":$\s]+):(?P<name>[^":$\s]+)(?::(?P<version>[^":\s]+))?"'
)
PROPERTY = re.compile(r'(?m)^\s*([\w.-]+)\s*[=:]\s*([^\s#!]+)')
LOCAL = re.compile(r'(?m)^\s*(?:val|var)\s+(\w+)(?:\s*:\s*String)?\s*=\s*(?:"([^"\n]+)"|(?:providers\.)?gradleProperty\("([^"]+)"\)|findProperty\("([^"]+)"\))')
LOCKED = re.compile(r"(?m)^([^:=\s]+):([^:=\s]+):([^=\s]+)=[^\n]+$")
REFERENCE = re.compile(r"\$(?:\{([\w.-]+)\}|([\w]+))")
VERSION = re.compile(r"(\d+(?:\.\d+)*)(?:[-.]([A-Za-z]+)[.-]?(\d+)?)?(?:\+[.\w-]+)?")
QUALIFIERS = {"snapshot": -5, "alpha": -4, "a": -4, "beta": -3, "b": -3,
              "milestone": -2, "m": -2, "rc": -1, "cr": -1, "": 0,
              "final": 0, "release": 0, "ga": 0, "sp": 1}


def read_dependencies(text: str, properties="", lockfile="") -> list[Dependency]:
    text = kotlin_source(text)
    values = dict(PROPERTY.findall(properties))
    for name, literal, provider, property_name in LOCAL.findall(text):
        value = literal or values.get(provider or property_name)
        if value:
            values[name] = value
    locked = {(group, name): version for group, name, version in LOCKED.findall(lockfile)}
    result = []
    for match in DECLARATION.finditer(text):
        group, name = match["group"], match["name"]
        raw = match["version"] or ""
        version = locked.get((group, name)) or REFERENCE.sub(
            lambda ref: values.get(ref[1] or ref[2], ref[0]), raw)
        if version and "$" not in version:
            result.append(Dependency(group, name, version, line_at(text, match.start("group"))))
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


def scan_dependencies(snapshot: Snapshot, advisories: list[Advisory],
                      node_id: str = "deps") -> list[Finding]:
    results = {}
    for path, content in sorted(snapshot.files.items()):
        if path.rsplit("/", 1)[-1] != "build.gradle.kts":
            continue
        prefix = path.removesuffix("build.gradle.kts")
        properties = snapshot.files.get(prefix + "gradle.properties", snapshot.files.get("gradle.properties", ""))
        lockfile = snapshot.files.get(prefix + "gradle.lockfile", snapshot.files.get("gradle.lockfile", ""))
        for dependency in read_dependencies(content, properties, lockfile):
            for advisory in advisories:
                if (dependency.group, dependency.name) != (advisory.group, advisory.name):
                    continue
                if any(version_in_range(dependency.version, bounds) for bounds in advisory.ranges):
                    coordinate = f"{dependency.group}:{dependency.name}"
                    item = finding("SCA-01", node_id, advisory.severity,
                                   "Зависимость требует обновления", path, dependency.line,
                                   f"{coordinate}:{dependency.version}", f"{coordinate}:{advisory.id}",
                                   advisory.id, category="SCA", group=dependency.group, artifact=dependency.name,
                                   version=dependency.version,
                                   remediation="Обновите зависимость до версии вне затронутого диапазона.")
                    results.setdefault(item.id, item)
    return list(results.values())