from dataclasses import dataclass
import json
import logging
from pathlib import Path
from threading import Lock, Thread

from ..contract import ApiError
from .advisories import OSV_FORMAT, catalog_version, load_advisories
from .osv_catalog import DEFAULT_OUTPUT, catalog_text, fetch_advisories, write_catalog_file
from .registry import Analyzer, register_analysis_handlers


@dataclass(frozen=True)
class ActiveCatalog:
    source: str
    version: str
    analyzers: dict[str, Analyzer]
    imported_at: str | None = None


def parse_catalog(text: str, source: str) -> ActiveCatalog:
    version = catalog_version(text)
    is_osv = version.startswith(OSV_FORMAT + ":")
    imported_at = json.loads(text).get("importedAt") if is_osv else None
    return ActiveCatalog("osv" if is_osv else source, version,
                         register_analysis_handlers(load_advisories(text)), imported_at)


class CatalogService:
    def __init__(self, training: Path, configured: Path, cache: Path = DEFAULT_OUTPUT):
        self._lock = Lock()
        self._cache = cache
        self._training = parse_catalog(training.read_text(encoding="utf-8-sig"), "training")
        self._configured = (self._training if configured.resolve() == training.resolve()
                            else parse_catalog(configured.read_text(encoding="utf-8-sig"), "custom"))
        self._active = self._configured
        self._osv = self._active if self._active.source == "osv" else None
        if cache.is_file() and configured.resolve() != cache.resolve():
            try:
                cached = parse_catalog(cache.read_text(encoding="utf-8-sig"), "custom")
                if cached.source == "osv":
                    self._osv = cached
            except (OSError, ValueError, KeyError, TypeError):
                logging.warning("Could not read the cached OSV catalog.")
        self._updating = False
        self._error = None

    def current(self) -> ActiveCatalog:
        with self._lock:
            return self._active

    def _status(self):
        return {"source": self._active.source, "analysisVersion": self._active.version,
                "osvAvailable": self._osv is not None,
                "osvUpdatedAt": self._osv.imported_at if self._osv else None,
                "customAvailable": self._configured.source == "custom",
                "updating": self._updating, "error": self._error}

    def status(self):
        with self._lock:
            return self._status()

    def select(self, source):
        with self._lock:
            if source == "training":
                self._active = self._training
            elif source == "osv":
                if self._osv is None:
                    raise ApiError(409, "OSV_UNAVAILABLE", "Сначала обновите каталог OSV.")
                self._active = self._osv
            elif source == "custom" and self._configured.source == "custom":
                self._active = self._configured
            else:
                raise ApiError(422, "INVALID_CATALOG_SOURCE", "Выберите доступный справочник уязвимостей.")
            return self._status()

    def refresh(self):
        with self._lock:
            if not self._updating:
                self._updating, self._error = True, None
                try:
                    Thread(target=self._refresh, daemon=True).start()
                except RuntimeError:
                    self._updating = False
                    raise ApiError(503, "OSV_UPDATE_UNAVAILABLE", "Не удалось запустить обновление OSV.") from None
            return self._status()

    def _refresh(self):
        try:
            text = catalog_text(fetch_advisories())
            updated = parse_catalog(text, "osv")
            write_catalog_file(self._cache, text)
        except Exception:
            logging.exception("Could not update the OSV catalog.")
            with self._lock:
                self._error = "Не удалось обновить OSV. Предыдущий каталог сохранён."
                self._updating = False
        else:
            with self._lock:
                self._osv = updated
                if self._active.source == "osv":
                    self._active = updated
                self._updating = False
