import json
from http.client import HTTPConnection, HTTPException
import os
from pathlib import Path
import subprocess
from threading import Lock
from typing import Protocol


class LlmProvider(Protocol):
    def generate_json(self, system: str, payload: dict, *, schema: dict | None = None) -> dict: ...


def object_schema(properties: dict) -> dict:
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


class ModelError(RuntimeError):
    def __init__(self, message: str, code: str = "AI_INVALID_RESPONSE"):
        super().__init__(message)
        self.code = code


class CodexProvider:
    _consumer = Lock()

    def generate_json(self, system: str, payload: dict, *, schema: dict | None = None) -> dict:
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


class OllamaProvider:
    def __init__(self, model: str, port: int):
        self.model, self.port = model, port

    def generate_json(self, system: str, payload: dict, *, schema: dict | None = None) -> dict:
        prompt = (system + "\nВходные данные:\n" + json.dumps(payload, ensure_ascii=False)
                  + "\nСформируй JSON-ответ по описанной структуре.")
        body = json.dumps({"model": self.model, "prompt": prompt,
                           "format": schema if schema is not None else "json", "stream": False, "think": False,
                           "options": {"temperature": 0}}).encode()
        connection = HTTPConnection("127.0.0.1", self.port, timeout=90)
        try:
            connection.request("POST", "/api/generate", body, {"Content-Type": "application/json"})
            response = connection.getresponse()
            if response.status != 200:
                raise ModelError("Ollama не запустила модель. Проверьте имя установленной модели.", "AI_UNAVAILABLE")
            raw = response.read(512 * 1024 + 1)
        except TimeoutError as error:
            raise ModelError("Ollama не ответила вовремя.", "AI_TIMEOUT") from error
        except (OSError, HTTPException) as error:
            raise ModelError("Локальная Ollama недоступна.", "AI_UNAVAILABLE") from error
        finally:
            connection.close()
        try:
            if len(raw) > 512 * 1024:
                raise ValueError("Response is too large")
            result = json.loads(raw)
            answer = json.loads(result["response"])
            if result.get("done") is not True or not isinstance(answer, dict):
                raise ValueError("Expected a completed JSON object")
            return answer
        except (ValueError, KeyError, TypeError) as error:
            raise ModelError("Ollama вернула некорректный JSON.") from error


def build_provider() -> LlmProvider:
    provider = os.environ.get("GARDEN_LLM_PROVIDER", "codex").strip().lower()
    if provider == "codex":
        return CodexProvider()
    if provider == "ollama":
        model = os.environ.get("GARDEN_OLLAMA_MODEL", "qwen3:4b").strip()
        port = int(os.environ.get("GARDEN_OLLAMA_PORT", "11434"))
        if not model or not 1 <= port <= 65535:
            raise ValueError("Укажите имя локальной модели и порт Ollama.")
        return OllamaProvider(model, port)
    raise ValueError("GARDEN_LLM_PROVIDER должен быть codex или ollama.")
