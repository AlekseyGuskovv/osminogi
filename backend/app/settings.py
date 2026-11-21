from datetime import UTC, datetime
import logging
from threading import Lock, Thread

from .contract import ApiError
from .ml.provider import CodexProvider, FallbackProvider, ModelError, OllamaProvider, object_schema


def provider_info(provider):
    if isinstance(provider, OllamaProvider):
        return {"id": "ollama", "name": "Ollama", "model": provider.model}
    if isinstance(provider, CodexProvider):
        return {"id": "codex", "name": "CodexGenerator", "model": None}
    return {"id": "custom", "name": "Провайдер сервера", "model": None}


class AiDiagnostics:
    def __init__(self, provider):
        fallback = isinstance(provider, FallbackProvider)
        self._providers = (provider.primary, provider.fallback) if fallback else (provider,)
        self._info = tuple(provider_info(item) for item in self._providers)
        self._mode = "auto" if fallback else self._info[0]["id"]
        self._results = {}
        self._checking = False
        self._lock = Lock()

    def _status(self):
        return {"mode": self._mode, "checking": self._checking,
                "providers": [{**item, **self._results.get(item["id"], {"status": "unknown"})} for item in self._info]}

    def status(self):
        with self._lock:
            return self._status()

    def start(self):
        with self._lock:
            if not self._checking:
                self._checking = True
                self._results = {}
                try:
                    Thread(target=self._check, daemon=True).start()
                except RuntimeError:
                    self._checking = False
                    raise ApiError(503, "AI_TEST_UNAVAILABLE", "Не удалось запустить проверку AI.") from None
            return self._status()

    def _check(self):
        try:
            for info, provider in zip(self._info, self._providers, strict=True):
                status, message = "available", None
                try:
                    response = provider.generate_json("Проверка подключения. Ответь объектом JSON {\"ok\": true}.", {},
                                                      schema=object_schema({"ok": {"type": "boolean"}}))
                    if response.get("ok") is not True:
                        raise ModelError("Ответ модели не прошёл проверку.")
                except ModelError as error:
                    status, message = "unavailable", str(error)
                except Exception:
                    logging.exception("AI connection check failed")
                    status, message = "unavailable", "Провайдер завершил проверку с ошибкой."
                with self._lock:
                    self._results[info["id"]] = {"status": status, "message": message, "checkedAt": datetime.now(UTC).isoformat()}
        finally:
            with self._lock:
                self._checking = False
