from collections import Counter
from pathlib import PurePosixPath
import re

from .types import Finding, Snapshot, finding


APPLICATION = re.compile(r"application(?:-(?P<profile>[^.]+))?\.(?:ya?ml|properties)")
PROPERTY = re.compile(r"([\w.-]+)\s*[:=]\s*(.*)")
YAML_KEY = re.compile(r"""["']?([\w.-]+)["']?\s*:(?:\s+(.*)|$)""")
LOCAL_PROFILES = {"dev", "local", "test"}
EXPOSURE = "management.endpoints.web.exposure.include"
RULES = {
    EXPOSURE: ("SAST-ACTUATOR-EXPOSURE", "actuator-exposure",
               "Все эндпоинты Actuator включены для HTTP",
               "Перечислите только необходимые эндпоинты и ограничьте доступ к ним."),
    "server.servlet.session.cookie.secure": (
        "SAST-COOKIE-SECURE", "insecure-session-cookie",
        "Сессионная cookie может передаваться по HTTP", "Установите secure=true для HTTPS."),
    "server.servlet.session.cookie.httponly": (
        "SAST-COOKIE-HTTP-ONLY", "script-accessible-session-cookie",
        "Сессионная cookie доступна JavaScript", "Установите http-only=true."),
}


def property_name(key):
    return key.lower().replace("-", "").replace("_", "")


def scalar(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1].strip()
    return value


def config_documents(content, *, yaml):
    """Read Spring scalar settings and simple YAML sequences with source lines."""
    settings, parents, block_indent = {}, [], None
    for line, raw in enumerate(content.splitlines(), 1):
        if raw.rstrip() == "---" or (not yaml and raw.rstrip() in {"#---", "!---"}):
            yield settings
            settings, parents, block_indent = {}, [], None
            continue
        text = raw.lstrip()
        if not text or text.startswith(("#", "!")):
            continue
        if not yaml:
            match = PROPERTY.fullmatch(text)
            if match:
                settings[property_name(match[1])] = (line, [scalar(match[2])])
            continue

        indent = len(raw) - len(text)
        if block_indent is not None:
            if indent > block_indent:
                continue
            block_indent = None
        text = re.split(r"\s+#", text, maxsplit=1)[0].rstrip()
        if text.startswith("- ") and parents and indent >= parents[-1][0]:
            key = ".".join(parent[1] for parent in parents)
            if key in settings:
                settings[key][1].append(scalar(text[2:]))
            continue
        match = YAML_KEY.fullmatch(text)
        while parents and indent <= parents[-1][0]:
            parents.pop()
        if not match:
            continue
        key = property_name(match[1])
        path = ".".join([*(parent[1] for parent in parents), key])
        value = (match[2] or "").strip()
        if re.fullmatch(r"[|>][1-9+-]{0,2}", value):
            block_indent = indent
        if not value:
            parents.append((indent, key))
        values = value[1:-1].split(",") if value.startswith("[") and value.endswith("]") else [value]
        settings[path] = (line, [scalar(item) for item in values])
    yield settings


def scan_spring_config(snapshot: Snapshot, node_id: str) -> list[Finding]:
    results = []
    for path, content in sorted(snapshot.files.items()):
        parts = PurePosixPath(path).parts
        application = APPLICATION.fullmatch(parts[-1])
        if not application:
            continue
        file_profile = application["profile"] or ""
        is_test = "/src/test/resources/" in f"/{path}"
        occurrences = Counter()
        for settings in config_documents(content, yaml=not path.endswith(".properties")):
            _, profile_values = settings.get("spring.config.activate.onprofile",
                                             settings.get("spring.profiles", (0, [])))
            profiles = {name.strip() for value in [file_profile, *profile_values] for name in value.split(",")}
            profiles.discard("")
            local = is_test or (bool(profiles) and profiles <= LOCAL_PROFILES)
            for key, (rule, kind, title, remediation) in RULES.items():
                if key not in settings:
                    continue
                line, values = settings[key]
                if key == EXPOSURE:
                    unsafe = any(item.strip() == "*" for value in values for item in value.split(","))
                else:
                    unsafe = any(value.lower() == "false" for value in values)
                if unsafe:
                    profile = ",".join(sorted(profiles))
                    anchor = (rule, profile)
                    occurrences[anchor] += 1
                    results.append(finding(rule, node_id, "low" if local else "medium", title, path, line,
                                           title, f"{key}:{profile}:{occurrences[anchor]}",
                                           category="SAST", classification=kind, remediation=remediation))
    return results
