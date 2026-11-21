import operator
import re


LEVELS = {"low": -1, "medium": 0, "high": 1, "critical": 2}
COMPARISONS = {"eq": operator.eq, "ne": operator.ne, "gte": operator.ge,
               "gt": operator.gt, "lte": operator.le, "lt": operator.lt}
CATEGORIES = ("SECRET", "SCA", "SAST", "GRADLE")
MAX_RULES = 5


def title_matches(pattern, findings):
    if (not isinstance(pattern, str) or not 0 < len(pattern) <= 80
            or any(char in pattern for char in "(){}\\") or len(re.findall(r"[*+?]", pattern)) > 1):
        raise ValueError("Укажите простое регулярное выражение длиной до 80 символов.")
    regex = re.compile(pattern, re.IGNORECASE)
    return any(regex.search(item.title) for item in findings)


def match_rule(rule, findings):
    if not isinstance(rule, dict):
        raise ValueError("Неверный формат правила.")
    metric, op, value = (rule.get(key) for key in ("metric", "operator", "value"))
    fields = {"metric", "operator", "value"}
    if metric == "filteredCount":
        fields.update(("severity", "category"))
    if set(rule) != fields:
        raise ValueError("Неверные параметры правила.")
    if metric == "maxSeverity" and op == "gte" and isinstance(value, str) and value in LEVELS:
        return any(LEVELS[item.severity] >= LEVELS[value] for item in findings)
    if metric == "findingTitle" and op == "regex":
        return title_matches(value, findings)
    if metric == "findingPath" and op == "contains" and isinstance(value, str) and 0 < len(value.strip()) <= 80:
        return any(value.strip().casefold() in item.path.casefold() for item in findings)
    if (metric in ("findingCount", "filteredCount") and isinstance(op, str) and op in COMPARISONS
            and type(value) is int and 0 <= value <= 5000):
        if metric == "findingCount":
            return COMPARISONS[op](len(findings), value)
        severity, category = rule["severity"], rule["category"]
        if severity in (*LEVELS, "any") and category in (*CATEGORIES, "any"):
            count = sum((severity == "any" or item.severity == severity)
                        and (category == "any" or (item.category or item.ruleId.split("-", 1)[0]) == category)
                        for item in findings)
            return COMPARISONS[op](count, value)
    raise ValueError("Неизвестное правило ветвления.")


def match_rules(settings, findings):
    if (not isinstance(settings, dict) or set(settings) != {"mode", "rules"}
            or settings["mode"] not in ("all", "any")
            or not isinstance(settings["rules"], list) or not 1 <= len(settings["rules"]) <= MAX_RULES):
        raise ValueError("Укажите режим «все» или «любое» и от одного до пяти правил.")
    results = [match_rule(rule, findings) for rule in settings["rules"]]
    return all(results) if settings["mode"] == "all" else any(results)
