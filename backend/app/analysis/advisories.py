import json
from hashlib import sha256

from .sca import Advisory, VersionRange


OSV_FORMAT = "osv-maven-v1"


def catalog_version(text: str) -> str:
    document = json.loads(text)
    if isinstance(document, dict) and document.get("format") == OSV_FORMAT:
        records = json.dumps(document["advisories"], sort_keys=True, separators=(",", ":"))
        return OSV_FORMAT + ":" + sha256(records.encode()).hexdigest()
    return "organizer-v3:" + sha256(text.encode()).hexdigest()


def load_advisories(text: str) -> list[Advisory]:
    data = json.loads(text)
    if isinstance(data, dict) and data.get("format") == OSV_FORMAT:
        rows = data["advisories"]
        if not rows:
            raise ValueError("Каталог OSV для Maven пуст.")
        return [
            Advisory(row["id"], row["group"], row["name"], row["severity"],
                     [VersionRange(**bounds) for bounds in row["ranges"]], tuple(row["aliases"]),
                     frozenset(row["versions"]), "osv", row["unsupported_ranges"])
            for row in rows
        ]
    if isinstance(data, dict):
        return [
            Advisory(row["id"], row["group"], row["artifact"], row["severity"].lower(),
                     [VersionRange(bounds.get("lower"), bounds.get("upper"),
                                   bounds.get("lowerInclusive", True), bounds.get("upperInclusive", False))
                      for bounds in row["ranges"]], tuple(row.get("aliases", [])))
            for row in data["vulnerabilities"]
        ]
    return [
        Advisory(row["id"], row["group"], row["name"], row["severity"],
                 [VersionRange(**bounds) for bounds in row["ranges"]])
        for row in data
    ]
