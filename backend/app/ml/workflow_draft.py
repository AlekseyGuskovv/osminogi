import re


PROMPT = ("Преобразуй запрос в JSON с полями checks (непустой список secrets/sca/sast), "
          "explain (bool), notify (bool), time (HH:MM или null). "
          "Не возвращай команды, ссылки, токены и настройки подключения.")
EMAIL = re.compile(r"\b(?:email|e-mail|smtp)\b|почт", re.IGNORECASE)
TIME = re.compile(r"\b(?:[01]?\d|2[0-3]):[0-5]\d\b")


def valid_intent(intent: dict) -> bool:
    checks = intent.get("checks")
    time = intent.get("time")
    return (isinstance(checks, list) and bool(checks)
            and all(check in ("secrets", "sca", "sast") for check in checks)
            and isinstance(intent.get("explain"), bool) and isinstance(intent.get("notify"), bool)
            and (time is None or isinstance(time, str) and TIME.fullmatch(time) is not None))


def build_draft(intent: dict, timezone: str, email: bool) -> dict:
    chain = ["start", *dict.fromkeys(intent["checks"])]
    if intent["explain"]:
        chain.append("ai")
    chain.append("condition")
    terminal = "telegram" if intent["notify"] or email else "finish"
    nodes = [{"id": f"n{index}", "type": kind, "x": 40 + (index % 4) * 200,
              "y": 40 + (index // 4) * 120, "settings": {}}
             for index, kind in enumerate([*chain, terminal, "finish"])]
    gate = nodes[len(chain) - 1]
    gate["settings"] = {"metric": "maxSeverity", "operator": "gte", "value": "critical"}
    edges = [{"from": nodes[index]["id"], "to": nodes[index + 1]["id"], "branch": "next"}
             for index in range(len(chain) - 1)]
    edges += [{"from": gate["id"], "to": nodes[-2]["id"], "branch": "yes"},
              {"from": gate["id"], "to": nodes[-1]["id"], "branch": "no"}]
    schedule = {"time": intent["time"].zfill(5), "timezone": timezone} if intent["time"] else None
    warnings = ["Доступен Telegram. Выберите подключение для уведомлений."] if email else []
    return {"name": "Проверка кода", "nodes": nodes, "edges": edges,
            "schedule": schedule, "warnings": warnings}
