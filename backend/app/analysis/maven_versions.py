import re


MAVEN = re.compile(r"([0-9]+(?:\.[0-9]+)*)(?:[._-]?([a-z]+)(?:[.-]?([0-9]+))?)?", re.I | re.ASCII)
QUALIFIERS = {"alpha": -5, "a": -5, "beta": -4, "b": -4, "milestone": -3, "m": -3,
              "rc": -2, "cr": -2, "snapshot": -1, "": 0, "ga": 0, "final": 0, "release": 0, "sp": 1}
SEMVER = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
                    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?")


def maven_key(version: str):
    match = MAVEN.fullmatch(version)
    if not match:
        raise ValueError("Unsupported Maven version")
    qualifier = (match[2] or "").lower()
    serial = int(match[3] or 0)
    if qualifier in {"ga", "final", "release"} and serial:
        raise ValueError("Unsupported Maven qualifier")
    numbers = list(map(int, match[1].split(".")))
    while len(numbers) > 1 and numbers[-1] == 0:
        numbers.pop()
    rank = QUALIFIERS.get(qualifier)
    if qualifier in {"a", "b", "m"} and not match[3]:
        rank = None
    return tuple(numbers), rank if rank is not None else 2, qualifier if rank is None else "", serial


def semver_key(version: str):
    match = SEMVER.fullmatch(version)
    if not match:
        raise ValueError("Unsupported SemVer version")
    parts = []
    for token in (match[4] or "").split(".") if match[4] else ():
        if token.isdigit():
            if len(token) > 1 and token.startswith("0"):
                raise ValueError("Invalid numeric SemVer prerelease identifier")
            parts.append((0, int(token)))
        else:
            parts.append((1, token))
    return tuple(map(int, match.groups()[:3])), not parts, tuple(parts)


VERSION_KEYS = {"ECOSYSTEM": maven_key, "SEMVER": semver_key}
