@echo off
REM ============================================================
REM start-serve.bat
REM Start opencode serve in background. Will NOT touch OpenCode.exe (desktop).
REM Auto-creates a session to trigger plugin loading (feishu WebSocket).
REM
REM Usage: set env vars then run, or edit this file for defaults.
REM Required env vars:
REM   OPENCODE_WORKSPACE     - project directory (e.g. D:\my-project)
REM   OPENCODE_SERVER_PASSWORD - HTTP Basic Auth password
REM Optional:
REM   OPENCODE_SERVER_USERNAME - default: opencode
REM   OPENCODE_PORT            - default: 4096
REM ============================================================

if "%OPENCODE_WORKSPACE%"=="" (
  echo [ERROR] OPENCODE_WORKSPACE is not set
  echo Run start-autostart.bat instead, or set the env var manually.
  pause
  exit /b 1
)
if "%OPENCODE_SERVER_PASSWORD%"=="" (
  echo [ERROR] OPENCODE_SERVER_PASSWORD is not set
  echo Run start-autostart.bat instead, or set the env var manually.
  pause
  exit /b 1
)

set PROJECT_DIR=%OPENCODE_WORKSPACE%
set PORT=%OPENCODE_PORT%
if "%PORT%"=="" set PORT=4096
set SCRIPT_DIR=%~dp0
set LOG_DIR=%SCRIPT_DIR%logs
set LOG_FILE=%LOG_DIR%\serve.log
set PID_FILE=%LOG_DIR%\serve.pid
set SERVER_USERNAME=%OPENCODE_SERVER_USERNAME%
if "%SERVER_USERNAME%"=="" set SERVER_USERNAME=opencode
set SERVER_PASSWORD=%OPENCODE_SERVER_PASSWORD%

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM Find opencode in PATH (prefer npm global install for version >=1.15.13)
set OPENCODE_EXE=
for /f "delims=" %%i in ('where opencode.cmd 2^>nul') do (
  set OPENCODE_EXE=%%i
  goto :found
)
:found
if "%OPENCODE_EXE%"=="" (
  for /f "delims=" %%i in ('where opencode 2^>nul') do (
    set OPENCODE_EXE=%%i
    goto :found2
  )
)
:found2
if "%OPENCODE_EXE%"=="" (
  echo [ERROR] opencode not found in PATH
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$port = %PORT%;" ^
  "$exe = '%OPENCODE_EXE%';" ^
  "$logFile = '%LOG_FILE%';" ^
  "$pidFile = '%PID_FILE%';" ^
  "$projDir = '%PROJECT_DIR%';" ^
  "$username = '%SERVER_USERNAME%';" ^
  "$password = '%SERVER_PASSWORD%';" ^
  "$env:OPENCODE_SERVER_PASSWORD = $password;" ^
  "$env:OPENCODE_SERVER_USERNAME = $username;" ^
  "$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue;" ^
  "if ($conn) { Write-Host ('[WARN] Port ' + $port + ' already in use by PID=' + $conn.OwningProcess); exit 1 };" ^
  "if (Test-Path $pidFile) { Remove-Item $pidFile -Force };" ^
  "Add-Content -Path $logFile -Value ('--- start at ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ---');" ^
  "$p = Start-Process -FilePath $exe -ArgumentList @('serve','--port',$port,'--hostname','0.0.0.0','--print-logs') -WorkingDirectory $projDir -WindowStyle Hidden -PassThru;" ^
  "Write-Host ('[INFO] Started opencode.exe PID=' + $p.Id + ', waiting for port ' + $port + '...');" ^
  "$ok = $false;" ^
  "for ($i=0; $i -lt 20; $i++) {" ^
  "  Start-Sleep -Seconds 1;" ^
  "  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue;" ^
  "  if ($c) { Set-Content -Path $pidFile -Value $p.Id -NoNewline; Write-Host ('[OK] opencode serve started PID=' + $p.Id + ' port=' + $port); Write-Host ('[OK] Log: ' + $logFile); $ok = $true; break }" ^
  "};" ^
  "if (-not $ok) { Write-Host '[ERROR] Port ' $port ' not listening after 20s'; Write-Host '--- last 20 log lines ---'; Get-Content $logFile -Tail 20; Read-Host 'Press Enter to close'; exit 1 };" ^
  "$projDirEncoded = [Uri]::EscapeDataString($projDir);" ^
  "$uri = 'http://localhost:' + $port + '/session?directory=' + $projDirEncoded;" ^
  "$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($username + ':' + $password));" ^
  "Write-Host '[INFO] Creating session to load plugins...';" ^
  "for ($i=0; $i -lt 5; $i++) {" ^
  "  try {" ^
  "    $body = '{}';" ^
  "    $result = Invoke-RestMethod -Uri $uri -Method Post -Headers @{Authorization=$auth} -ContentType 'application/json' -Body $body -TimeoutSec 10;" ^
  "    Write-Host ('[OK] Session created: ' + $result.id);" ^
  "    break;" ^
  "  } catch {" ^
  "    if ($i -lt 4) { Start-Sleep -Seconds 2 } else { Write-Host ('[WARN] Session creation failed: ' + $_.Exception.Message) }" ^
  "  }" ^
  "};" ^
  "Start-Sleep -Seconds 2;" ^
  "Write-Host '[OK] Plugins should be loaded (feishu WebSocket connected)';" ^
  "Write-Host '[OK] Auth: Basic opencode/<password>';" ^
  "Read-Host 'Press Enter to close'"
