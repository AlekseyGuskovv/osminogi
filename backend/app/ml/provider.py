import json
import os
from pathlib import Path
import subprocess
from threading import Lock
from typing import Protocol


class LlmProvider(Protocol):
    def generate_json(self, system: str, payload: dict) -> dict: ...


class ModelError(RuntimeError):
    def __init__(self, message: str, code: str = "AI_INVALID_RESPONSE"):
        super().__init__(message)
        self.code = code


class CodexProvider:
    _consumer = Lock()

    def generate_json(self, system: str, payload: dict) -> dict:
        default = Path(__file__).resolve().parents[5] / "AiStaff" / "CodexGenerator"
        root = Path(os.environ.get("GARDEN_CODEX_DIR", default)).expanduser().resolve()
        python = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        question = system + "\nОтветь одним JSON-объектом. Входные данные:\n"
        question += json.dumps(payload, ensure_ascii=False)
        try:
            with self._consumer:
                call = subprocess.run(
                    [str(python), "examples/amqp_client.py", question,
                     "--effort", "low", "--timeout", "80"],
                    cwd=root, capture_output=True, encoding="utf-8", timeout=90,
                    env={**os.environ, "PYTHONIOENCODING": "utf-8"},
                )
        except subprocess.TimeoutExpired as error:
            raise ModelError("CodexGenerator не ответил вовремя.", "AI_TIMEOUT") from error
        except OSError as error:
            raise ModelError("Не удалось запустить клиент CodexGenerator.", "AI_UNAVAILABLE") from error
        except UnicodeError as error:
            raise ModelError("CodexGenerator вернул ответ в неверной кодировке.") from error
        if call.returncode:
            raise ModelError("CodexGenerator недоступен или завершил запрос с ошибкой.", "AI_UNAVAILABLE")
        try:
            result = json.loads(call.stdout)
            if result["status"] != "succeeded":
                raise ModelError("CodexGenerator завершил запрос с ошибкой.", "AI_UNAVAILABLE")
            answer = json.loads(result["answer"])
            if not isinstance(answer, dict):
                raise ValueError("Expected a JSON object")
            return answer
        except (ValueError, KeyError, TypeError) as error:
            raise ModelError("CodexGenerator вернул некорректный JSON.") from error


def build_provider() -> LlmProvider:
    return CodexProvider()
