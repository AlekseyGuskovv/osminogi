from dataclasses import dataclass

from .types import Finding


@dataclass(frozen=True)
class ExpectedFinding:
    id: str
    analyzer: str


@dataclass(frozen=True)
class Score:
    true_positives: int
    missed: int
    false_positives: int


def score_findings(actual: list[Finding], expected: list[ExpectedFinding]) -> dict[str, Score]:
    scores = {}
    for analyzer, prefix in {"secrets": "SECRET-", "sca": "SCA-", "sast": "SAST-"}.items():
        seen = {item.id for item in actual if item.ruleId.startswith(prefix)}
        target = {item.id for item in expected if item.analyzer == analyzer}
        scores[analyzer] = Score(len(seen & target), len(target - seen), len(seen - target))
    return scores