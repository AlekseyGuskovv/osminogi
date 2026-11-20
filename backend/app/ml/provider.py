import json
import os
from pathlib import Path
import subprocess
from typing import Protocol


class LlmProvider(Protocol):
    def generate_json(self, system: str, payload: dict) -> dict: ...


class ModelError(RuntimeError):
    pass


class CodexProvider:
    def generate_json(self, system: str, payload: dict) -> dict:
        default = Path(__file__).resolve().parents[5] / "AiStaff" / "CodexGenerator"
        root = Path(os.environ.get("GARDEN_CODEX_DIR", default)).expanduser().resolve()
        python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        question = system + "\nОтветь одним JSON-объектом. Входные данные:\n"
        question += json.dumps(payload, ensure_ascii=False)
        try:
            call = subprocess.run(
                [str(python), "examples/amqp_client.py", question,
                 "--effort", "low", "--timeout", "25"],
                cwd=root, capture_output=True, encoding="utf-8", timeout=30,
                env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            )
            result = json.loads(call.stdout)
            if call.returncode or result["status"] != "succeeded":
                raise ValueError("Generation failed")
            answer = json.loads(result["answer"])
            if not isinstance(answer, dict):
                raise ValueError("Expected a JSON object")
            return answer
        except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError) as error:
            raise ModelError("CodexGenerator недоступен или вернул неверный JSON") from error


def build_provider() -> LlmProvider:
    return CodexProvider()
