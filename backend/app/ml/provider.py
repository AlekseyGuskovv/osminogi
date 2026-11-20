from dataclasses import dataclass
import json
import os
from typing import Protocol
from urllib.error import URLError
from urllib.request import Request, urlopen


class LlmProvider(Protocol):
    def generate_json(self, system: str, payload: dict) -> dict: ...


class ModelError(RuntimeError):
    pass


@dataclass(frozen=True)
class LlmSettings:
    kind: str
    url: str
    model: str
    api_key: str = ""
    timeout: float = 15

    @classmethod
    def from_env(cls) -> "LlmSettings":
        return cls(os.getenv("GARDEN_LLM_KIND", "ollama"),
                   os.getenv("GARDEN_LLM_URL", "http://localhost:11434/api/chat"),
                   os.getenv("GARDEN_LLM_MODEL", ""),
                   os.getenv("GARDEN_LLM_KEY", ""))


@dataclass(frozen=True)
class ChatProvider:
    settings: LlmSettings

    def generate_json(self, system: str, payload: dict) -> dict:
        settings = self.settings
        if not settings.model:
            raise ModelError("Модель не настроена")
        body = {"model": settings.model, "stream": False, "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ]}
        if settings.kind == "ollama":
            body["format"] = "json"
        else:
            body["response_format"] = {"type": "json_object"}
        headers = {"Content-Type": "application/json"}
        if settings.api_key:
            headers["Authorization"] = f"Bearer {settings.api_key}"
        request = Request(settings.url, json.dumps(body).encode(), headers)
        try:
            with urlopen(request, timeout=settings.timeout) as response:
                result = json.loads(response.read(1_000_000))
            message = (result["message"] if settings.kind == "ollama"
                       else result["choices"][0]["message"])
            data = json.loads(message["content"])
        except (URLError, TimeoutError, ValueError, KeyError, IndexError, TypeError) as error:
            raise ModelError("Модель недоступна или вернула неверный JSON") from error
        if not isinstance(data, dict):
            raise ModelError("Ожидался JSON-объект")
        return data


def build_provider(settings: LlmSettings) -> LlmProvider:
    if settings.kind not in {"ollama", "openai-compatible"}:
        raise ValueError("Unsupported model provider")
    return ChatProvider(settings)