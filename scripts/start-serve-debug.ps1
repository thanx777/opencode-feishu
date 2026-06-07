# start-serve-debug.ps1
# 调试模式启动 opencode serve，飞书插件日志输出到 debug.log
#
# 用法: powershell -ExecutionPolicy Bypass -File .\start-serve-debug.ps1
# 日志文件: scripts/logs/debug.log

$ErrorActionPreference = "Stop"

# 设置终端编码为 UTF-8，避免中文乱码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 > $null 2>&1

# 从 start-autostart.bat 读取环境变量（如果未设置）
$scriptDir = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $PSScriptRoot }
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.InvocationName }
$autostartBat = Join-Path $scriptDir "start-autostart.bat"

if (-not $env:OPENCODE_WORKSPACE -and (Test-Path $autostartBat)) {
    Write-Host "[INFO] Loading env vars from start-autostart.bat" -ForegroundColor DarkGray
    $lines = Get-Content $autostartBat
    foreach ($line in $lines) {
        if ($line -match '^\s*set\s+OPENCODE_WORKSPACE=(.*)') { $env:OPENCODE_WORKSPACE = $Matches[1] }
        if ($line -match '^\s*set\s+OPENCODE_SERVER_USERNAME=(.*)') { $env:OPENCODE_SERVER_USERNAME = $Matches[1] }
        if ($line -match '^\s*set\s+OPENCODE_SERVER_PASSWORD=(.*)') { $env:OPENCODE_SERVER_PASSWORD = $Matches[1] }
        if ($line -match '^\s*set\s+OPENCODE_PORT=(.*)') { $env:OPENCODE_PORT = $Matches[1] }
    }
}

$workspace = $env:OPENCODE_WORKSPACE
$password = $env:OPENCODE_SERVER_PASSWORD
$username = if ($env:OPENCODE_SERVER_USERNAME) { $env:OPENCODE_SERVER_USERNAME } else { "opencode" }
$port = if ($env:OPENCODE_PORT) { [int]$env:OPENCODE_PORT } else { 4096 }

if (-not $workspace) {
    Write-Host "[ERROR] OPENCODE_WORKSPACE is not set and start-autostart.bat not found" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}
if (-not $password) {
    Write-Host "[ERROR] OPENCODE_SERVER_PASSWORD is not set and start-autostart.bat not found" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

$logDir = Join-Path $scriptDir "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

$debugLog = Join-Path $logDir "debug.log"
$pidFile = Join-Path $logDir "serve.pid"

# 清空旧日志
"--- debug session at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ---" | Set-Content $debugLog

# 停掉已有的 serve
if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile
    Write-Host "[INFO] Stopping existing opencode PID=$oldPid"
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# 检查端口
$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    Write-Host "[WARN] Port $port already in use by PID=$($conn.OwningProcess)" -ForegroundColor Yellow
    Read-Host "Press Enter to close"
    exit 1
}

# 找 opencode
$exe = $null
try { $exe = (Get-Command opencode.cmd -ErrorAction Stop).Path } catch {
    try { $exe = (Get-Command opencode -ErrorAction Stop).Path } catch {}
}
if (-not $exe) {
    Write-Host "[ERROR] opencode not found in PATH" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host "[INFO] Starting opencode serve with FEISHU_DEBUG=1" -ForegroundColor Cyan
Write-Host "[INFO] Debug log: $debugLog"
Write-Host "[INFO] Port: $port"
Write-Host ""

# 设置环境变量
$env:OPENCODE_SERVER_PASSWORD = $password
$env:OPENCODE_SERVER_USERNAME = $username
$env:FEISHU_DEBUG = "1"

# 启动 opencode，stderr 重定向到 debug.log
$p = Start-Process -FilePath $exe `
    -ArgumentList @("serve", "--port", $port, "--hostname", "0.0.0.0", "--print-logs") `
    -WorkingDirectory $workspace `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardError $debugLog

Write-Host "[INFO] Started opencode.exe PID=$($p.Id), waiting for port $port..."

# 等待端口就绪
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($c) {
        Set-Content -Path $pidFile -Value $p.Id -NoNewline
        Write-Host "[OK] opencode serve started PID=$($p.Id) port=$port" -ForegroundColor Green
        $ok = $true
        break
    }
}
if (-not $ok) {
    Write-Host "[ERROR] Port $port not listening after 20s" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

# 创建 session 触发插件加载
$projDirEncoded = [Uri]::EscapeDataString($workspace)
$uri = "http://localhost:${port}/session?directory=$projDirEncoded"
$auth = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${username}:${password}"))

Write-Host "[INFO] Creating session to load plugins..."
for ($i = 0; $i -lt 5; $i++) {
    try {
        $result = Invoke-RestMethod -Uri $uri -Method Post -Headers @{Authorization=$auth} -ContentType "application/json" -Body '{}' -TimeoutSec 10
        Write-Host "[OK] Session created: $($result.id)" -ForegroundColor Green
        break
    } catch {
        if ($i -lt 4) { Start-Sleep -Seconds 2 } else { Write-Host "[WARN] Session creation failed: $($_.Exception.Message)" -ForegroundColor Yellow }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OpenCode serve running in DEBUG mode" -ForegroundColor Cyan
Write-Host "  Debug log: $debugLog" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Waiting for debug output... (log file will grow)"
Write-Host "Now go to Feishu and send /model to test"
Write-Host ""

# 实时显示日志
Get-Content -Path $debugLog -Wait -Tail 20
