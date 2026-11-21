from pathlib import Path
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT / "kotlin-project"


def training_archive(variant):
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        for source in sorted(PROJECT.rglob("*")):
            if not source.is_file() or source.suffix not in {".kts", ".kt", ".yml", ".yaml", ".properties"}:
                continue
            name = source.relative_to(PROJECT).as_posix()
            content = source.read_text(encoding="utf-8")
            if variant == "before":
                content = content.replace("api-key: ${TRAINING_API_KEY:}", "api-key: garden-synthetic-training")
                content = content.replace("spring-boot-starter-web:3.4.1", "spring-boot-starter-web:3.4.0")
                content = content.replace('.hasRole("ADMIN")', ".permitAll()")
            archive.writestr(name, content)
    return buffer.getvalue()


def main():
    target = ROOT / "archives"
    target.mkdir(exist_ok=True)
    for variant in ("fixed", "before"):
        (target / f"training-{variant}.zip").write_bytes(training_archive(variant))
    print(target)


if __name__ == "__main__":
    main()
