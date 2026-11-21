import argparse
from collections.abc import Iterator
from dataclasses import asdict
from datetime import UTC, datetime
import json
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile, TemporaryDirectory
from urllib.request import urlopen
from zipfile import BadZipFile, ZipFile

from .advisories import OSV_FORMAT
from .maven_versions import VERSION_KEYS
from .sca import Advisory, VersionRange


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT = ROOT / ".garden-data" / "osv-maven.json"
OSV_MAVEN_URL = "https://storage.googleapis.com/osv-vulnerabilities/Maven/all.zip"
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_EXPANDED = 256 * 1024 * 1024
MAX_RECORD = 2 * 1024 * 1024
LABELS = {"LOW": "low", "MEDIUM": "medium", "MODERATE": "medium", "HIGH": "high", "CRITICAL": "critical"}


def severity(record, affected):
    for row in (affected, record):
        for field in ("database_specific", "ecosystem_specific"):
            value = row.get(field, {}).get("severity")
            if isinstance(value, str) and value.upper() in LABELS:
                return LABELS[value.upper()]
    return "medium"


def intervals(events: list[dict[str, str]], ordering: str) -> Iterator[VersionRange]:
    key = VERSION_KEYS[ordering]
    if not events or any(not isinstance(event, dict) or len(event) != 1 for event in events):
        raise ValueError("Invalid OSV range events")
    pairs = [next(iter(event.items())) for event in events]
    if any(kind not in {"introduced", "fixed", "last_affected", "limit"}
           or not isinstance(value, str) or not value for kind, value in pairs):
        raise ValueError("Invalid OSV range event")
    limits: list[str] = [value for kind, value in pairs if kind == "limit"]
    limit = max(limits, key=key) if limits and "*" not in limits else None
    timeline = sorted(((kind, value) for kind, value in pairs if kind != "limit"),
                      key=lambda row: (0,) if row == ("introduced", "0") else (1, key(row[1])))
    active, lower = False, None
    for kind, value in timeline:
        if kind == "introduced":
            if not active:
                lower = None if value == "0" else value
                active = True
        elif active:
            upper, inclusive = value, kind == "last_affected"
            if limit is not None and key(limit) <= key(upper):
                upper, inclusive = limit, False
            if lower is None or key(lower) < key(upper) or (inclusive and key(lower) == key(upper)):
                yield VersionRange(lower, upper, True, inclusive, ordering,
                                   value if kind == "fixed" and upper == value else None)
            active = False
    if active and (lower is None or limit is None or key(lower) < key(limit)):
        yield VersionRange(lower, limit, ordering=ordering)


def maven_advisories(record):
    if record.get("withdrawn"):
        return
    identifier = record["id"]
    aliases: set[str] = {alias for alias in record.get("aliases", ())
                         if isinstance(alias, str) and alias != identifier}
    for affected in record.get("affected", ()):
        package = affected["package"]
        if package["ecosystem"] != "Maven":
            continue
        group, separator, name = package["name"].partition(":")
        if not separator or not group or not name or ":" in name:
            continue
        versions = frozenset(affected.get("versions", ()))
        ranges, unsupported = [], False
        for row in affected.get("ranges", ()):
            ordering = row["type"]
            if ordering not in VERSION_KEYS:
                unsupported = unsupported or not versions
                continue
            try:
                ranges.extend(list(intervals(row["events"], ordering)))
            except ValueError:
                unsupported = True
        if versions or ranges or unsupported:
            yield Advisory(identifier, group, name, severity(record, affected), ranges,
                           tuple(sorted(aliases)), versions, "osv", unsupported)


def import_archive(path):
    if path.stat().st_size > MAX_ARCHIVE:
        raise ValueError("Архив OSV превышает допустимый размер.")
    with ZipFile(path) as archive:
        members = [entry for entry in archive.infolist() if not entry.is_dir() and entry.filename.endswith(".json")]
        if (any(entry.file_size > MAX_RECORD for entry in members)
                or sum(entry.file_size for entry in members) > MAX_EXPANDED):
            raise ValueError("Распакованные записи OSV превышают допустимый размер.")
        rows = [advisory for entry in members for advisory in maven_advisories(json.loads(archive.read(entry)))]
    if not any(row.ranges or row.versions for row in rows):
        raise ValueError("В архиве нет пригодных для проверки записей OSV для Maven.")
    return sorted(rows, key=lambda row: (row.group, row.name, row.id))


def download(path):
    with urlopen(OSV_MAVEN_URL, timeout=30) as response, path.open("wb") as output:
        received = 0
        while data := response.read(64 * 1024):
            received += len(data)
            if received > MAX_ARCHIVE:
                raise ValueError("Архив OSV превышает допустимый размер.")
            output.write(data)


def catalog_text(rows):
    payload = {"format": OSV_FORMAT, "source": OSV_MAVEN_URL, "importedAt": datetime.now(UTC).isoformat(),
               "advisories": [{**asdict(row), "versions": sorted(row.versions)} for row in rows]}
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"


def write_catalog_file(output, text):
    output.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=output.parent, prefix=output.name + ".", delete=False) as stream:
        temporary = Path(stream.name)
    try:
        temporary.write_text(text, encoding="utf-8")
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)


def write_catalog(output, rows):
    write_catalog_file(output, catalog_text(rows))


def fetch_advisories(archive=None):
    if archive is not None:
        return import_archive(archive)
    with TemporaryDirectory(prefix="cyber-garden-osv-") as temp:
        archive = Path(temp) / "maven.zip"
        download(archive)
        return import_archive(archive)


def main():
    parser = argparse.ArgumentParser(description="Update the local Cyber Garden OSV Maven catalog")
    parser.add_argument("--archive", type=Path, help="Import an existing Maven all.zip instead of downloading it")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    try:
        rows = fetch_advisories(args.archive)
        write_catalog(args.output, rows)
    except (OSError, BadZipFile, ValueError, KeyError, TypeError) as error:
        print(f"Не удалось обновить OSV: {error}", file=sys.stderr)
        return 2
    unsupported = sum(row.unsupported_ranges for row in rows)
    print(f"OSV Maven: {len(rows)} записей, с неподдерживаемыми диапазонами: {unsupported}. {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
