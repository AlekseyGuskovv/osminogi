param(
    [Parameter(Mandatory=$true)][string]$LaunchFolder,
    [switch]$SkipModels,
    [switch]$StopAfterCheck
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $LaunchFolder '..\..'))
$front = Join-Path $root 'frontend'
$backendUrl = 'http://127.0.0.1:18020'
$frontUrl = 'http://127.0.0.1:5188'
$ollamaUrl = 'http://127.0.0.1:11434'
$model = 'qwen3:4b'
$children = @()

function Ready($url) {
    try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $url).StatusCode -eq 200 }
    catch { return $false }
}
function WaitReady($url, $process) {
    $limit = [DateTime]::UtcNow.AddSeconds(30)
    do {
        if ($process -and $process.HasExited) { throw 'Процесс завершился. Посмотри сообщения в этом окне.' }
        if (Ready $url) { return }
        Start-Sleep -Milliseconds 400
    } while ([DateTime]::UtcNow -lt $limit)
    throw "Сервис не ответил по адресу $url."
}
function FindOllama {
    $command = Get-Command ollama.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $path = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    if (Test-Path -LiteralPath $path) { return $path }
}
function ModelReady {
    try {
        $tags = Invoke-RestMethod -TimeoutSec 3 "$ollamaUrl/api/tags"
        return $model -in @($tags.models | ForEach-Object { $_.name })
    } catch { return $false }
}
function DockerReady {
    try {
        & $docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}
function PrepareCodex {
    $docker = (Get-Command docker.exe -ErrorAction SilentlyContinue).Source
    if (!$docker -or !(Test-Path -LiteralPath (Join-Path $codexRoot 'compose.yaml'))) {
        throw 'Docker CLI или compose.yaml CodexGenerator отсутствует.'
    }
    if (!(DockerReady)) {
        $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
        if (!(Test-Path -LiteralPath $desktop)) { throw 'Docker Desktop отсутствует.' }
        if (!(Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)) {
            Start-Process -FilePath $desktop -WindowStyle Hidden
        }
        $limit = [DateTime]::UtcNow.AddSeconds(60)
        do {
            if (DockerReady) { break }
            Start-Sleep -Seconds 2
        } while ([DateTime]::UtcNow -lt $limit)
        if (!(DockerReady)) { throw 'Движок Docker не запустился.' }
    }
    Push-Location -LiteralPath $codexRoot
    try {
        & $docker compose up -d --no-build --wait --wait-timeout 45
        if ($LASTEXITCODE -ne 0) { throw 'Сервисы CodexGenerator не запустились. Смотри вывод Docker выше.' }
    } finally { Pop-Location }
}
function PrepareOllama {
    $ollama = FindOllama
    if (!$ollama -and !(Ready "$ollamaUrl/api/tags")) {
        $winget = (Get-Command winget.exe -ErrorAction SilentlyContinue).Source
        if (!$winget) { throw 'Ollama не найдена и Winget недоступен.' }
        Write-Host 'Устанавливаю Ollama через Winget.'
        & $winget install --id Ollama.Ollama --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
        $ollama = FindOllama
        if (!$ollama) { throw 'Не удалось найти Ollama после установки.' }
    }
    if (!(Ready "$ollamaUrl/api/tags")) {
        $env:OLLAMA_HOST = '127.0.0.1:11434'
        $server = Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden -PassThru
        try { WaitReady "$ollamaUrl/api/tags" $server }
        catch { if (!(Ready "$ollamaUrl/api/tags")) { throw } }
    }
    if (!(ModelReady)) {
        if (!$ollama) { throw 'Нужна команда ollama.exe для загрузки модели.' }
        Write-Host "Загружаю модель $model. Первый запуск может занять несколько минут."
        & $ollama pull $model
        if ($LASTEXITCODE -ne 0 -or !(ModelReady)) { throw 'Модель не загрузилась.' }
    }
}

try {
    $config = @{}
    $settingsPath = Join-Path $LaunchFolder 'Telegram.txt'
    if (!(Test-Path -LiteralPath $settingsPath)) {
        Copy-Item -LiteralPath (Join-Path $LaunchFolder 'Telegram.example.txt') -Destination $settingsPath
    }
    foreach ($line in (Get-Content -Raw -Encoding UTF8 -LiteralPath $settingsPath) -split '\r?\n') {
        $line = $line.Trim()
        if (!$line -or $line.StartsWith('#')) { continue }
        if ($line -notmatch '^(BOT_TOKEN|CHAT_ID)\s*=\s*(.*)$') { throw 'В Telegram.txt ожидаются строки BOT_TOKEN= и CHAT_ID=.' }
        if ($config.ContainsKey($Matches[1])) { throw 'В Telegram.txt повторяется настройка.' }
        $config[$Matches[1]] = $Matches[2].Trim()
    }
    $token = $config['BOT_TOKEN']
    $chatId = $config['CHAT_ID']
    if (($token -or $chatId) -and ($token -cnotmatch '^\d+:[A-Za-z0-9_-]+$' -or $chatId -notmatch '^-?\d{1,20}$')) {
        throw 'Проверь Telegram.txt. Нужны и токен бота, и числовой ID чата.'
    }
    if (!$token) { Write-Warning 'Telegram.txt пуст. Редактор запустится без Telegram.' }
    $python = Join-Path (Split-Path -Parent $root) '.venv\Scripts\python.exe'
    if (!(Test-Path -LiteralPath $python)) { $python = Join-Path $root '.venv\Scripts\python.exe' }
    if (!(Test-Path -LiteralPath $python)) { throw 'Виртуальная среда Python не найдена рядом с osminogi.' }
    $runtime = Get-Command node.exe -ErrorAction SilentlyContinue
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (!$runtime -or !$npm) {
        $ideRuntime = Join-Path $env:LOCALAPPDATA 'JetBrains\PyCharm2026.2\acp-agents\.runtimes\node'
        $installed = Get-ChildItem -LiteralPath $ideRuntime -Directory -ErrorAction SilentlyContinue |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'node.exe') } |
            Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
        if (!$installed) { throw 'Node.js и npm не найдены в PATH и окружении PyCharm.' }
        $env:Path = "$($installed.FullName);$env:Path"
    }
    $node = (Get-Command node.exe).Source
    $npmPath = (Get-Command npm.cmd).Source
    $codexRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $root)) 'AiStaff\CodexGenerator'
    $env:GARDEN_CODEX_DIR = $codexRoot
    $env:GARDEN_LLM_PROVIDER = 'auto'
    $env:GARDEN_OLLAMA_PORT = '11434'
    $env:GARDEN_OLLAMA_MODEL = $model
    $env:GARDEN_PORT = '18020'
    $env:GARDEN_ALLOWED_ORIGINS = $frontUrl
    $env:GARDEN_BACKEND_URL = $backendUrl
    $env:GARDEN_DB = Join-Path $root '.garden-data\defense-launch.sqlite3'
    $env:VITE_USE_MOCKS = 'false'
    $env:VITE_API_BASE = '/api/v1'

    $ports = @(Get-NetTCPConnection -State Listen -LocalPort 18020,5188 -ErrorAction SilentlyContinue)
    if ($ports.Count) { throw 'Порт 18020 или 5188 занят. Закрой предыдущий запуск защиты.' }

    Write-Host 'Проверяю зависимости Python и собираю интерфейс.'
    & $python -c 'import cryptography, tzdata'
    if ($LASTEXITCODE -ne 0) {
        & $python -m pip install -r (Join-Path $root 'requirements.txt')
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить зависимости Python.' }
    }
    Push-Location -LiteralPath $front
    try {
        if (!(Test-Path -LiteralPath 'node_modules\vite\bin\vite.js') -or !(Test-Path -LiteralPath 'node_modules\typescript\bin\tsc')) {
            & $npmPath ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить зависимости интерфейса.' }
        }
        & $npmPath run build
        if ($LASTEXITCODE -ne 0) { throw 'Сборка интерфейса завершилась ошибкой.' }
    } finally { Pop-Location }

    if (!$SkipModels) {
        Write-Host 'Запускаю CodexGenerator.'
        try { PrepareCodex; Write-Host 'Контейнеры CodexGenerator запущены.' }
        catch { Write-Warning $_.Exception.Message }
        Write-Host 'Проверяю резервную Ollama.'
        try { PrepareOllama; Write-Host "Ollama и $model доступны." }
        catch { Write-Warning $_.Exception.Message }
    }

    Write-Host 'Запускаю бэкенд и интерфейс.'
    $savedToken = $env:GARDEN_TELEGRAM_BOT_TOKEN
    $savedChat = $env:GARDEN_TELEGRAM_CHAT_ID
    try {
        $env:GARDEN_TELEGRAM_BOT_TOKEN = $token
        $env:GARDEN_TELEGRAM_CHAT_ID = $chatId
        $backend = Start-Process -FilePath $python -WorkingDirectory $root -ArgumentList '-m','backend.app.demo_server' -NoNewWindow -PassThru
        $children += $backend
    } finally {
        $env:GARDEN_TELEGRAM_BOT_TOKEN = $savedToken
        $env:GARDEN_TELEGRAM_CHAT_ID = $savedChat
    }
    WaitReady "$backendUrl/api/v1/connections" $backend
    $vite = Start-Process -FilePath $node -WorkingDirectory $front -ArgumentList 'node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5188','--strictPort' -NoNewWindow -PassThru
    $children += $vite
    WaitReady "$frontUrl/api/v1/connections" $vite
    if ($token) {
        $connections = Invoke-RestMethod -TimeoutSec 3 "$frontUrl/api/v1/connections"
        if (!(@($connections | Where-Object { $_.id -eq 'telegram-env' -and $_.configured }).Count)) {
            throw 'Бэкенд не зарегистрировал закрытый чат.'
        }
        Write-Host 'Подключение «Закрытый чат сервера» доступно. Доставку подтверждает запуск сценария.'
    }
    Write-Host "Редактор готов: $frontUrl/"
    if (!$StopAfterCheck) {
        Start-Process "$frontUrl/"
        Write-Host 'Оставь это окно открытым. Для остановки бэкенда и редактора нажми Ctrl+C.'
        while (!$vite.HasExited -and !$backend.HasExited) { Start-Sleep -Seconds 1 }
        throw 'Один из процессов завершился. Посмотри сообщения в этом окне.'
    }
} catch {
    Write-Host ("Ошибка запуска: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    foreach ($process in $children) {
        if (!$process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
    }
}
