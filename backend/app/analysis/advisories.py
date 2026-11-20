import json

from .sca import Advisory, VersionRange


def load_advisories(text: str) -> list[Advisory]:
    data = json.loads(text)
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