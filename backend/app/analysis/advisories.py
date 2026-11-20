import json

from .sca import Advisory, VersionRange


def load_advisories(text: str) -> list[Advisory]:
    """Read the normalized local interchange format used by this module."""
    return [
        Advisory(row["id"], row["group"], row["name"], row["severity"],
                 [VersionRange(**bounds) for bounds in row["ranges"]])
        for row in json.loads(text)
    ]