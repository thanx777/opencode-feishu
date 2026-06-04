# add-autostart-task.ps1
# 开机自动启动 opencode serve
# 用法: 右键 → "以管理员身份运行 PowerShell" → 选这个脚本
# 注意: 不会触碰 OpenCode.exe (桌面端), 只管理 opencode.exe (CLI)

$ErrorActionPreference = 'Stop'
$taskName = 'OpencodeServeAutostart'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$batPath = Join-Path $scriptDir 'start-serve.bat'

if (-not (Test-Path $batPath)) {
  Write-Host "[ERROR] 找不到 $batPath" -ForegroundColor Red
  exit 1
}

# 如果任务已存在, 先删
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "[INFO] 任务已存在, 先卸载" -ForegroundColor Yellow
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute $batPath
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0)

try {
  Register-ScheduledTask -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Auto-start opencode serve in background on user logon (used by Feishu phone bot)" `
    | Out-Null

  Write-Host "[OK] 计划任务已创建" -ForegroundColor Green
  Get-ScheduledTask -TaskName $taskName | Format-List TaskName, State, Description
  Write-Host ""
  Write-Host "任务将在下次登录时自动运行" -ForegroundColor Cyan
  Write-Host "也可手动测试: & '$batPath'" -ForegroundColor Cyan
}
catch {
  Write-Host "[ERROR] 创建失败: $_" -ForegroundColor Red
  exit 1
}
