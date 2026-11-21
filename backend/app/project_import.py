from io import BytesIO
import stat
from pathlib import PurePosixPath, PureWindowsPath
from urllib.error import URLError
from urllib.request import urlopen
from zipfile import BadZipFile, ZipFile

from .analysis.types import Snapshot


MAX_UPLOAD = 20 * 1024 * 1024
MAX_EXPANDED = 100 * 1024 * 1024
MAX_FILES = 5000
MAX_SOURCE = 2 * 1024 * 1024
SOURCE_TYPES = {".kt", ".kts", ".yaml", ".yml", ".properties", ".env", ".lockfile", ".pem", ".key"}
ORGANIZER_REPOSITORY = "https://github.com/TBagirov/training"
ORGANIZER_COMMIT = "fe1fcbe212669783480666b9b60147c8a8c6eef4"


class ArchiveTooLarge(ValueError):
    pass


def read_organizer_project(url, snapshot_id: str) -> tuple[Snapshot, str]:
    if url != ORGANIZER_REPOSITORY:
        raise ValueError("Выберите учебный репозиторий, предоставленный организаторами.")
    archive_url = f"https://codeload.github.com/TBagirov/training/zip/{ORGANIZER_COMMIT}"
    with urlopen(archive_url, timeout=12) as response:
        if response.geturl() != archive_url:
            raise URLError("Unexpected archive source")
        data = response.read(MAX_UPLOAD + 1)
    root = f"training-{ORGANIZER_COMMIT}"
    snapshot = read_project(data, snapshot_id, project_root=f"{root}/training-project")
    try:
        with ZipFile(BytesIO(data)) as archive:
            with archive.open(f"{root}/vulnerability-database/vulnerabilities.json") as source:
                catalog = source.read(MAX_SOURCE + 1)
        if len(catalog) > MAX_SOURCE:
            raise ValueError("Справочник превышает 2 МБ.")
        return snapshot, catalog.decode("utf-8-sig")
    except (OSError, KeyError, ValueError, BadZipFile, RuntimeError) as error:
        raise ValueError("В архиве отсутствует корректный справочник организаторов.") from error


def read_project(data: bytes, snapshot_id: str, *, project_root: str | None = None) -> Snapshot:
    if len(data) > MAX_UPLOAD:
        raise ArchiveTooLarge("ZIP превышает 20 МБ.")
    try:
        with ZipFile(BytesIO(data)) as archive:
            members = archive.infolist()
            if len(members) > MAX_FILES or sum(item.file_size for item in members) > MAX_EXPANDED:
                raise ArchiveTooLarge("Слишком много файлов или данных в ZIP.")
            files, seen = {}, set()
            for entry in members:
                name = entry.filename
                path = PurePosixPath(name)
                kind = stat.S_IFMT(entry.external_attr >> 16)
                if (not path.parts or path.is_absolute() or PureWindowsPath(name).drive
                        or ".." in path.parts or "\\" in name or "\x00" in entry.orig_filename
                        or kind not in (0, stat.S_IFREG, stat.S_IFDIR)
                        or entry.flag_bits & 1):
                    raise ValueError("ZIP содержит небезопасный путь, ссылку или зашифрованный файл.")
                key = path.as_posix()
                if key.casefold() in seen:
                    raise ValueError("В ZIP повторяется путь.")
                seen.add(key.casefold())
                if project_root is not None:
                    prefix = project_root + "/"
                    if not key.startswith(prefix):
                        continue
                    key = key[len(prefix):]
                if entry.is_dir() or (path.suffix.lower() not in SOURCE_TYPES
                                      and path.name not in {".env", "libs.versions.toml"}):
                    continue
                if entry.file_size > MAX_SOURCE:
                    raise ArchiveTooLarge("Исходный файл превышает 2 МБ.")
                with archive.open(entry) as source:
                    content = source.read(MAX_SOURCE + 1)
                if len(content) > MAX_SOURCE:
                    raise ArchiveTooLarge("Исходный файл превышает 2 МБ.")
                try:
                    files[key] = content.decode("utf-8-sig")
                except UnicodeDecodeError:
                    if path.suffix.lower() not in {".pem", ".key"}:
                        raise
    except (BadZipFile, UnicodeDecodeError, NotImplementedError, RuntimeError, OSError) as error:
        raise ValueError("Ожидался ZIP с исходниками в UTF-8.") from error
    if not any(PurePosixPath(name).name == "build.gradle.kts" for name in files):
        raise ValueError("В ZIP отсутствует build.gradle.kts.")
    if all("/" in name for name in files) and len({name.split("/", 1)[0] for name in files}) == 1:
        files = {name.split("/", 1)[1]: value for name, value in files.items()}
    return Snapshot(snapshot_id, files)
