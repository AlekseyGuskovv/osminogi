from .provider import ModelError
from .workflow_draft import EMAIL, PROMPT, build_draft, valid_intent


def generate_workflow(prompt, provider):
    intent = provider.generate_json(PROMPT, {"request": prompt})
    if not valid_intent(intent):
        raise ModelError("Модель вернула неверные параметры графа.")
    return build_draft(intent, "UTC", bool(EMAIL.search(prompt)))
