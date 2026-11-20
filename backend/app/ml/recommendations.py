from dataclasses import dataclass
import re

@dataclass(frozen=True)
class Recommendation:
    findingId: str
    source: str
    explanation: str
    action: str


REFERENCE = re.compile(r"CVE-\d+|(?:строк[аеуи]|line)\s*[#:№]?\s*\d+|[\w.-]+\.(?:kts?|ya?ml|properties|env)\b",
                       re.IGNORECASE)
def validate_recommendations(raw: dict, allowed_ids: set[str]) -> list[Recommendation]:
    rows = raw.get("recommendations")
    if not isinstance(rows, list):
        return []
    result = {}
    duplicates = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"findingId", "explanation", "action"}:
            continue
        item_id, explanation, action = row["findingId"], row["explanation"], row["action"]
        if not isinstance(item_id, str) or item_id not in allowed_ids:
            continue
        if not all(isinstance(value, str) and 0 < len(value.strip()) <= 500
                   and not REFERENCE.search(value) for value in (explanation, action)):
            continue
        if item_id in result:
            duplicates.add(item_id)
        result[item_id] = Recommendation(item_id, "ai", explanation.strip(), action.strip())
    return [value for key, value in result.items() if key not in duplicates]
