from dataclasses import dataclass
from itertools import zip_longest
import re

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


DECLARATION = re.compile(
    r'^\s*(?:api|implementation|compileOnly|runtimeOnly|testImplementation|developmentOnly)\s*'
    r'\(\s*(?:platform\(\s*)?"([^":$\s]+):([^":$\s]+):([^":$\s]+)"'
)
VERSION = re.compile(r"(\d+(?:\.\d+)*)(?:[-.]([A-Za-z]+)[.-]?(\d+)?)?(?:\+[.\w-]+)?")
QUALIFIERS = {"snapshot": -5, "alpha": -4, "a": -4, "beta": -3, "b": -3,
              "milestone": -2, "m": -2, "rc": -1, "cr": -1, "": 0,
              "final": 0, "release": 0, "ga": 0, "sp": 1}


def read_dependencies(text: str) -> list[Dependency]:
    result = []
    for line, source in enumerate(text.splitlines(), 1):
        match = DECLARATION.match(source)
        if match:
            result.append(Dependency(*match.groups(), line))
    return result


def version_parts(version: str) -> tuple[tuple[int, ...], tuple[int, int]]:
    match = VERSION.fullmatch(version)
    if not match or (match[2] or "").lower() not in QUALIFIERS:
        raise ValueError(f"Unsupported Gradle version: {version}")
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
    results = []
    for path, content in sorted(snapshot.files.items()):
        if path.rsplit("/", 1)[-1] != "build.gradle.kts":
            continue
        for dependency in read_dependencies(content):
            for advisory in advisories:
                if (dependency.group, dependency.name) != (advisory.group, advisory.name):
                    continue
                if any(version_in_range(dependency.version, bounds) for bounds in advisory.ranges):
                    coordinate = f"{dependency.group}:{dependency.name}"
                    results.append(finding("SCA-01", node_id, advisory.severity,
                                           "Зависимость требует обновления", path, dependency.line,
                                           f"{coordinate}:{dependency.version}",
                                           f"{coordinate}:{advisory.id}", advisory.id))
    return list({item.id: item for item in results}.values())