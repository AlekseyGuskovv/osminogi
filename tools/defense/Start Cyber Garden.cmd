@echo off
setlocal
set "CYBER_GARDEN_LAUNCH_DIR=%~dp0"
powershell.exe -NoProfile -Command "& ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $env:CYBER_GARDEN_LAUNCH_DIR 'Start Cyber Garden.ps1')))) -LaunchFolder $env:CYBER_GARDEN_LAUNCH_DIR"
if errorlevel 1 pause