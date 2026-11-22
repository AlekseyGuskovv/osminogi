from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
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
    def __init__(self, training: Path, configured: Path, cache: Path = DEFAULT_OUTPUT, *, store=None):
        self._lock = Lock()
        self._cache = cache
        self._store = store
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
        saved = (store.get("setting", "catalog") or {}) if store is not None else {}
        self._source = saved.get("source")
        self._interval = saved.get("refreshIntervalHours", 0)
        self._last_attempt = saved.get("lastAttemptAt")
        selection = self._selection(self._source)
        if selection is not None:
            self._active = selection

    def _selection(self, source):
        if source == "training":
            return self._training
        if source == "osv":
            return self._osv
        if source == "custom" and self._configured.source == "custom":
            return self._configured
        return None

    def _save(self, source, interval, last_attempt):
        if self._store is not None:
            self._store.put("setting", "catalog", {"source": source, "refreshIntervalHours": interval,
                                                   "lastAttemptAt": last_attempt})
        self._source, self._interval, self._last_attempt = source, interval, last_attempt

    def _next_refresh(self, now):
        if not self._interval:
            return None
        time = self._last_attempt or (self._osv.imported_at if self._osv else None)
        if not isinstance(time, str):
            return now
        try:
            parsed = datetime.fromisoformat(time)
        except ValueError:
            return now
        return (parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)) + timedelta(hours=self._interval)

    def current(self) -> ActiveCatalog:
        with self._lock:
            return self._active

    def _status(self):
        next_refresh = self._next_refresh(datetime.now(UTC))
        return {"source": self._active.source, "analysisVersion": self._active.version,
                "osvAvailable": self._osv is not None,
                "osvUpdatedAt": self._osv.imported_at if self._osv else None,
                "customAvailable": self._configured.source == "custom",
                "updating": self._updating, "error": self._error, "refreshIntervalHours": self._interval,
                "nextRefreshAt": next_refresh.isoformat() if next_refresh else None}

    def status(self):
        with self._lock:
            return self._status()

    def select(self, source):
        with self._lock:
            selection = self._selection(source)
            if selection is None:
                if source == "osv":
                    raise ApiError(409, "OSV_UNAVAILABLE", "Сначала обновите каталог OSV.")
                raise ApiError(422, "INVALID_CATALOG_SOURCE", "Выберите доступный справочник уязвимостей.")
            self._save(source, self._interval, self._last_attempt)
            self._active = selection
            return self._status()

    def schedule(self, interval):
        if type(interval) is not int or interval not in (0, 24, 168):
            raise ApiError(422, "INVALID_CATALOG_SCHEDULE", "Выберите ручное, ежедневное или еженедельное обновление.")
        with self._lock:
            self._save(self._source, interval, self._last_attempt)
            return self._status()

    def refresh(self):
        with self._lock:
            if not self._updating:
                self._start_refresh(datetime.now(UTC))
            return self._status()

    def refresh_due(self, now):
        with self._lock:
            due = self._next_refresh(now)
            if not self._updating and due is not None and due <= now:
                self._start_refresh(now)

    def _start_refresh(self, now):
        self._save(self._source, self._interval, now.isoformat())
        self._updating, self._error = True, None
        try:
            Thread(target=self._refresh, daemon=True).start()
        except RuntimeError:
            self._updating = False
            self._error = "Не удалось запустить обновление OSV."
            raise ApiError(503, "OSV_UPDATE_UNAVAILABLE", self._error) from None

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
                if self._source == "osv" or self._active.source == "osv":
                    self._active = updated
                self._updating = False
