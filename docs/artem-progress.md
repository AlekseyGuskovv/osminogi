# Cyber Garden — запуск и проверка

## 1. Запустить приложение

В терминале PyCharm из папки osminogi:

```powershell
..\.venv\Scripts\python.exe -m examples.make_zips
..\.venv\Scripts\python.exe -m backend.app.demo_server
```

Откройте http://127.0.0.1:8000. ZIP лежат в examples/archives. Сервер хранит состояние в .garden-data/garden.sqlite3. GARDEN_DB и GARDEN_PORT позволяют запускать отдельный локальный экземпляр. Для справочника организаторов задайте GARDEN_ADVISORIES; формат показан в docs/training-advisories.json. Записи DEMO и TRAINING-POLICY — эталон учебной проверки, а не реальные CVE.

1. Загрузите training-before.zip и запустите граф. Ожидаются три находки и красный итог.
2. Загрузите training-fixed.zip. В поле «База для сравнения» выберите первую версию и снова запустите граф. Найденные ранее проблемы перейдут в «Устранено».
3. В блоке запуска установите время UTC и сохраните сценарий. В истории ищите пометку «по расписанию». Уберите время и сохраните, чтобы отключить запуск.
4. Опубликуйте сохранённый сценарий, выберите шаблон и создайте копию. Выберите ZIP для её запуска. Целевой Telegram-чат задаётся сервером.

## 2. CodexGenerator

Поднимите существующий сервис из AiStaff/CodexGenerator по его SERVICE.md. Приложение использует штатный AMQP-клиент и его окружение. GARDEN_CODEX_DIR переопределяет путь. Для защиты используйте выделенный брокер без другого потребителя результатов.

Откройте находку после AI-блока и проверьте источник «Совет CodexGenerator». Для черновика введите «Каждый день в 14:00 проверяй секреты и отправляй отчёт в Telegram». Недоступная модель показывает ошибку, а результаты анализаторов остаются доступны.

## 3. Закрытый Telegram-чат

Создайте бота в BotFather, добавьте его в чат и отправьте в чат команду с упоминанием бота. В локальном PowerShell введите токен скрыто:

```powershell
$env:GARDEN_TELEGRAM_BOT_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host 'Токен Telegram' -AsSecureString)).Password
..\.venv\Scripts\python.exe -m backend.app.telegram --discover
$env:GARDEN_TELEGRAM_CHAT_ID = Read-Host 'Числовой chatId нужного чата'
..\.venv\Scripts\python.exe -m backend.app.demo_server
```

Остановите прежний локальный сервер перед перезапуском в этом терминале. Выберите training-before.zip и запустите ветку Telegram. При подтверждённой доставке сервер покажет номер сообщения. Токен в Git, JSON и журнал не записывается.

## 4. GitHub Actions и локальная проверка

```powershell
..\.venv\Scripts\python.exe -m backend.app.analysis.scan examples/archives/training-before.zip
..\.venv\Scripts\python.exe -m backend.app.analysis.scan examples/archives/training-fixed.zip --base examples/archives/training-before.zip
```

Первый запуск даёт код 1, второй код 0. Код 2 означает ошибку анализа. Actions выполняет ту же команду на архиве из Git и не запускает код учебного проекта. В PR проверка называется Security scan. Обязательность проверки перед слиянием настраивает владелец GitHub-репозитория. Эталон организаторов проверяется отдельно после получения файлов.


## Подтверждённые прогоны

- Chrome: импорт двух ZIP, редактирование условия по регулярному выражению, красная и зелёная проверки, сравнение и сохранение сценария.
- Локальный API: запуск SQLite-расписания, копирование шаблона, отклонение невалидного ZIP. Существующая критическая находка тоже завершила проверку ошибкой.
- CodexGenerator: три рекомендации со сводкой и черновик графа с расписанием 14:00 UTC.
- Синтетический эталон: по одной верной находке и по нулю пропусков и ложных тревог у каждого анализатора.

Для отчёта по эталону добавьте к сканированию training-before.zip аргумент --expected examples/expected-findings.json.

- [Pull Request № 2](https://github.com/AlekseyGuskovv/osminogi/pull/2)
- [Красный CI на синтетической критической находке](https://github.com/AlekseyGuskovv/osminogi/actions/runs/44775013945)
- [Зелёный CI на исправленном проекте](https://github.com/AlekseyGuskovv/osminogi/actions/runs/44776191238)

Доставка в закрытый Telegram-чат ждёт настроенного бота и подтверждения целевого чата. Набор организаторов ещё не получен.


## API для фронтенда · Word v2

Запускайте тот же модуль backend.app.demo_server. Существующая SQLite открывается без пересоздания. Для шифрования Telegram-подключений и часовых поясов установите requirements.txt в окружение проекта. Интерфейс по умолчанию слушает только 127.0.0.1. Схема доступна на /openapi.json, API — на /api/v1. Для Vite уже разрешены localhost:5173 и 127.0.0.1:5173. Другой доверенный адрес задаётся через GARDEN_ALLOWED_ORIGINS.

1. Сохраните WorkflowDraft через POST /api/v1/workflows. При последующем POST /workflows/{id}/save передайте текущую revision. 409 REVISION_CONFLICT означает, что интерфейсу нужно перечитать сценарий.
2. Загрузите ZIP как multipart-поле file в /api/v1/snapshots/import. Вызовите POST /api/v1/workflows/{id}/runs с snapshotId. Для сравнения с базой добавьте baseSnapshotId.
3. Из ответа 202 возьмите id. Подпишитесь через EventSource на /api/v1/runs/{id}/events. Каждое сообщение содержит seq, runId, type, at, data. После run.finished перечитайте GET /api/v1/runs/{id} и закройте поток. Возобновление использует Last-Event-ID.
4. Экспорт: GET /api/v1/runs/{id}/report?format=json или format=markdown. /comparison отвечает за состав изменений, ci.status — за решение проверки. Существующая критическая находка тоже даёт failed.
5. GET /api/v1/connections возвращает подключения без токенов. GARDEN_CONNECTION_KEY задаёт серверный ключ Fernet. При первом добавлении в пустое хранилище без этой переменной сервер создаёт локальный ключ рядом с SQLite. При переносе базы сохрани исходный ключ отдельно. Существующий чат из окружения доступен как telegram-env. Для локальных рабочих пространств можно задать GARDEN_WORKSPACE_ID на экземпляре сервера; графы и запуски раздельны, каталог шаблонов общий.
6. Текущий HTML использует явный режим view=demo. Фронтенд по Word v2 использует обычные маршруты без этого параметра.

## Открытый набор организаторов

Внешний проект, эталон и справочник хранятся в TBagirov/training. Для воспроизводимой проверки используйте commit fe1fcbe. Нужен ZIP содержимого training-project; не запускайте Gradle для статического анализа. Пример:

    git clone https://github.com/TBagirov/training.git organizer-training
    git -C organizer-training archive --format=zip -o ../organizer-training.zip fe1fcbe:training-project
    ..\.venv\Scripts\python.exe -m backend.app.analysis.scan organizer-training.zip --advisories organizer-training/vulnerability-database/vulnerabilities.json --ground-truth organizer-training/ground-truth/training-findings.json --graph docs/ci-workflow.json --report-json findings.json --report-markdown findings.md

Подтверждённый открытый замер: SECRET 5/5, SCA 5/5, SAST 5/5; пропусков, лишних находок и срабатываний на шести контрольных примерах нет. JSON и Markdown строятся из одного массива. GitHub Actions использует общий исполнитель и публикует оба формата как артефакты.

Приёмка Word v2: импорт открытого ZIP, конфликт ревизии, возобновление SSE, 15 находок и оба отчёта, проигрывание условия, идемпотентная учебная правка, история возвращения, независимая копия шаблона, шифрование подключения и живой черновик CodexGenerator. Фронтенд команды пока не предоставлен. Скрытый набор не проверялся.
### Каталог OSV для Maven

В разделе «Настройки» откройте «Справочник уязвимостей». Кнопка «Обновить OSV» скачивает каталог в фоне. Выбор «OSV Maven» включает его для новых проверок. Можно включить обновление раз в день или раз в неделю. Выбор источника и период сохраняются в SQLite. Переменная `GARDEN_ADVISORIES` задаёт исходный справочник, пока в приложении не выбрали другой.

По умолчанию используется учебный каталог. Из корня репозитория можно скачать официальный архив OSV, преобразовать его в локальный справочник и запустить сервер с этим справочником:

```powershell
.\.venv\Scripts\python.exe -m backend.app.analysis.osv_catalog
$env:GARDEN_ADVISORIES = Join-Path (Get-Location).Path '.garden-data\osv-maven.json'
.\.venv\Scripts\python.exe -m backend.app.demo_server
```

Для импорта уже скачанного архива передайте `--archive <путь-к-Maven-all.zip>`. CLI проверяет ZIP командой `python -m backend.app.analysis.scan <проект.zip>` и читает ту же переменную. Параметр `--advisories <файл>` позволяет явно выбрать каталог для одного запуска. Чтобы сервер прочитал обновлённый каталог, перезапустите его.

При проверке обеих версий используется один загруженный каталог. Нода «Полнота проверки» показывает неподдерживаемые диапазоны. Для записей без текстовой критичности используется уровень `medium`. Источник данных — [OSV.dev](https://google.github.io/osv.dev/data/).
