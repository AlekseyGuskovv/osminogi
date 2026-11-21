from .provider import ModelError, object_schema
from .workflow_draft import EMAIL, PROMPT, build_draft, valid_intent


def generate_workflow(prompt, provider):
    schema = object_schema({"checks": {"type": "array", "minItems": 1, "maxItems": 3,
                                        "items": {"enum": ["secrets", "sca", "sast"]}},
                            "explain": {"type": "boolean"}, "notify": {"type": "boolean"},
                            "time": {"anyOf": [{"type": "string", "pattern": "^[0-9]{2}:[0-9]{2}$"}, {"type": "null"}]}})
    intent = provider.generate_json(PROMPT, {"request": prompt}, schema=schema)
    if not valid_intent(intent):
        raise ModelError("Модель вернула неверные параметры графа.")
    return build_draft(intent, "UTC", bool(EMAIL.search(prompt)))
