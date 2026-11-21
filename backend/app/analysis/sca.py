from dataclasses import dataclass
from itertools import zip_longest
import re
import tomllib

from .maven_versions import VERSION_KEYS, maven_key
from .source import kotlin_source, line_at
from .types import Finding, Snapshot, finding


@dataclass(frozen=True)
class Dependency:
    group: str
    name: str
    version: str
    line: int


@dataclass(frozen=True)
class Declaration:
    group: str | None
    name: str
    version: str
    line: int


@dataclass(frozen=True)
class VersionRange:
    lower: str | None = None
    upper: str | None = None
    include_lower: bool = True
    include_upper: bool = False
    ordering: str | None = None
    fixed: str | None = None


@dataclass(frozen=True)
class Advisory:
    id: str
    group: str
    name: str
    severity: str
    ranges: list[VersionRange]
    aliases: tuple[str, ...] = ()
    versions: frozenset[str] = frozenset()
    source: str | None = None
    unsupported_ranges: bool = False


SCOPE = r"(?:api|implementation|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|developmentOnly)"
DECLARATION_START = r'(?m)(?:^|(?<=[;{]))\s*(?:' + SCOPE + r'\s*\(\s*|add\s*\(\s*"' + SCOPE + r'"\s*,\s*)'
DECLARATION = re.compile(
    DECLARATION_START + r'(?:platform\(\s*)?"(?P<group>[^":$\s]+):(?P<name>[^":$\s]+)(?::(?P<version>[^":\r\n]+))?"'
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


def read_declarations(text: str, properties="", *, catalog=None) -> list[Declaration]:
    text = kotlin_source(text)
    code = kotlin_source(text, keep_strings=False)
    values = dict(PROPERTY.findall(properties))
    for name, literal, provider, property_name in LOCAL.findall(text):
        value = literal or values.get(provider or property_name)
        if value:
            values[name] = value
    declarations = []
    for match in DECLARATION.finditer(text):
        if "(" not in code[match.start():match.start("group")]:
            continue
        group, name = match["group"], match["name"]
        version = REFERENCE.sub(lambda ref: values.get(ref[1] or ref[2], ref[0]), match["version"] or "")
        declarations.append(Declaration(group, name, version.strip(), line_at(text, match.start("group"))))
    aliases = catalog or {}
    for match in CATALOG_REFERENCE.finditer(text):
        if code[match.start(1)].isspace():
            continue
        group, name, version = aliases[match[1]] if match[1] in aliases else (None, match[1], "")
        declarations.append(Declaration(group, name, version.strip(), line_at(text, match.start(1))))
    return declarations


def read_dependencies(text: str, properties="", lockfile="", *, catalog=None, unresolved=None) -> list[Dependency]:
    locked = {(row.group, row.name): row.version for row in read_lockfile(lockfile)}
    result = []
    for row in read_declarations(text, properties, catalog=catalog):
        pinned = locked.get((row.group, row.name)) if row.group is not None else None
        version = pinned or row.version
        if row.group is not None and version and "$" not in version:
            result.append(Dependency(row.group, row.name, version, row.line))
        elif unresolved is not None:
            unresolved.append((row.line, "unknownAlias" if row.group is None else "unknownVersion"))
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
    if bounds.ordering:
        key = VERSION_KEYS[bounds.ordering]
        candidate = key(version)
        lower = compare_keys(candidate, key(bounds.lower)) if bounds.lower is not None else 1
        upper = compare_keys(candidate, key(bounds.upper)) if bounds.upper is not None else -1
    else:
        lower = compare_versions(version, bounds.lower) if bounds.lower is not None else 1
        upper = compare_versions(version, bounds.upper) if bounds.upper is not None else -1
    return (lower > 0 or lower == 0 and bounds.include_lower) and (
        upper < 0 or upper == 0 and bounds.include_upper)


def compare_keys(left, right):
    return (left > right) - (left < right)


def gradle_build_inputs(snapshot: Snapshot):
    catalogs = {}
    for path, content in sorted(snapshot.files.items()):
        if path.rsplit("/", 1)[-1] != "build.gradle.kts":
            continue
        prefix = path.removesuffix("build.gradle.kts")
        properties = snapshot.files.get(prefix + "gradle.properties", snapshot.files.get("gradle.properties", ""))
        catalog_path = prefix + CATALOG_PATH if prefix + CATALOG_PATH in snapshot.files else CATALOG_PATH
        if catalog_path in snapshot.files and catalog_path not in catalogs:
            catalogs[catalog_path] = read_version_catalog(snapshot.files[catalog_path])
        yield path, content, properties, catalogs.get(catalog_path)


def project_dependencies(snapshot: Snapshot, *, unresolved=None):
    covered_locks = {}
    for path, content, properties, catalog in gradle_build_inputs(snapshot):
        prefix = path.removesuffix("build.gradle.kts")
        lock_path = prefix + LOCKFILE if prefix + LOCKFILE in snapshot.files else LOCKFILE
        lockfile = snapshot.files.get(lock_path, "")
        skipped = [] if unresolved is not None else None
        for dependency in read_dependencies(content, properties, lockfile, catalog=catalog, unresolved=skipped):
            covered_locks.setdefault(lock_path, set()).add((dependency.group, dependency.name, dependency.version))
            yield path, dependency
        if unresolved is not None and skipped is not None:
            unresolved.extend((path, line, reason) for line, reason in skipped)

    for path, content in sorted(snapshot.files.items()):
        if path.rsplit("/", 1)[-1] != LOCKFILE:
            continue
        covered = covered_locks.get(path, ())
        for dependency in read_lockfile(content):
            if (dependency.group, dependency.name, dependency.version) not in covered:
                yield path, dependency


SEVERITY_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}


@dataclass
class AdvisoryMatch:
    advisory: Advisory
    fixes: list[tuple[str, str]]
    uncertain: bool
    affected: bool = True


class DependencyScanner:
    def __init__(self, advisories):
        self.by_coordinate = {}
        self.osv = any(advisory.source == "osv" for advisory in advisories)
        for advisory in advisories:
            self.by_coordinate.setdefault((advisory.group, advisory.name), []).append(advisory)

    def evaluate(self, dependency):
        relevant = self.by_coordinate.get((dependency.group, dependency.name), ())
        evaluated, uncertain = [], False
        for advisory in relevant:
            if advisory.source != "osv":
                if any(version_in_range(dependency.version, bounds) for bounds in advisory.ranges):
                    evaluated.append(AdvisoryMatch(advisory, [], False))
                continue
            found = dependency.version in advisory.versions
            incomplete = advisory.unsupported_ranges
            fixes = []
            for bounds in advisory.ranges:
                try:
                    affected = version_in_range(dependency.version, bounds)
                except ValueError:
                    incomplete = True
                    continue
                if affected:
                    found = True
                    if bounds.fixed and bounds.ordering:
                        fixes.append((bounds.ordering, bounds.fixed))
            evaluated.append(AdvisoryMatch(advisory, fixes, incomplete, found))
            uncertain = uncertain or incomplete
        return evaluated, uncertain

    def coverage_issue(self, dependency):
        try:
            if self.osv and self.by_coordinate.get((dependency.group, dependency.name)):
                _, uncertain = self.evaluate(dependency)
                return "unsupportedAdvisoryRange" if uncertain else None
            (maven_key if self.osv else version_parts)(dependency.version)
        except ValueError:
            return "unsupportedVersion"
        return None

    def __call__(self, snapshot: Snapshot, node_id: str = "deps") -> list[Finding]:
        results = {}
        for path, dependency in project_dependencies(snapshot):
            coordinate = f"{dependency.group}:{dependency.name}"
            evaluated, _ = self.evaluate(dependency)
            for group in group_matches(evaluated):
                affected = [match.advisory for match in group if match.affected]
                if not affected:
                    continue
                lead = min(affected, key=lambda row: row.id)
                severity = max((advisory.severity for advisory in affected), key=SEVERITY_ORDER.__getitem__)
                details = {}
                anchor = lead.id
                if lead.source == "osv":
                    identifiers = {item for match in group for item in (match.advisory.id, *match.advisory.aliases)}
                    anchor = min(identifiers, key=lambda item: (not item.startswith("CVE-"), item))
                    details = {"advisoryAliases": sorted(identifiers - {lead.id}), "advisorySource": "OSV",
                               "fixedVersion": fix_version(group)}
                item = finding("SCA-01", node_id, severity, "Зависимость требует обновления", path, dependency.line,
                               f"{coordinate}:{dependency.version}", f"{coordinate}:{anchor}",
                               lead.id, category="SCA", group=dependency.group, artifact=dependency.name,
                               version=dependency.version,
                               remediation="Обновите зависимость до версии вне затронутого диапазона.", **details)
                results.setdefault(item.id, item)
        return list(results.values())


def group_matches(matches):
    groups = []
    for match in matches:
        advisory = match.advisory
        ids = {advisory.id, *advisory.aliases} if advisory.source == "osv" else set()
        merged = [match]
        remaining = []
        for other_ids, other_matches in groups:
            if ids & other_ids:
                ids.update(other_ids)
                merged.extend(other_matches)
            else:
                remaining.append((other_ids, other_matches))
        groups = [*remaining, (ids, merged)]
    return [rows for _, rows in groups]


def fix_version(group):
    if any(match.uncertain for match in group):
        return None
    candidates = {fix for match in group for fix in match.fixes}
    if len({ordering for ordering, _ in candidates}) > 1:
        return None
    for _, version in sorted(candidates, key=lambda row: VERSION_KEYS[row[0]](row[1])):
        try:
            if all(version not in match.advisory.versions
                   and not any(version_in_range(version, bounds) for bounds in match.advisory.ranges)
                   for match in group):
                return version
        except ValueError:
            continue
    return None


def scan_dependencies(snapshot: Snapshot, advisories: list[Advisory],
                      node_id: str = "deps") -> list[Finding]:
    return DependencyScanner(advisories)(snapshot, node_id)
