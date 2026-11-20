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
