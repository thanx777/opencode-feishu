# add-firewall-rule.ps1
# 允许 opencode serve 监听 4096 端口被局域网访问
# 用法: 右键 → "以管理员身份运行 PowerShell" → 选这个脚本

$ErrorActionPreference = 'Stop'
$ruleName = 'opencode serve 4096'

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "[INFO] 规则 '$ruleName' 已存在, 跳过" -ForegroundColor Yellow
  Get-NetFirewallRule -DisplayName $ruleName | Format-List DisplayName, Direction, Action, Enabled, Profile
  exit 0
}

try {
  New-NetFirewallRule -DisplayName $ruleName `
    -Direction Inbound `
    -LocalPort 4096 `
    -Protocol TCP `
    -Action Allow `
    -Profile Private,Domain `
    -Description "Allow LAN access to opencode serve for Feishu bot (phone remote control)" `
    | Out-Null

  Write-Host "[OK] 防火墙规则已添加" -ForegroundColor Green
  Get-NetFirewallRule -DisplayName $ruleName | Format-List DisplayName, Direction, Action, Enabled, Profile
}
catch {
  Write-Host "[ERROR] 添加失败: $_" -ForegroundColor Red
  Write-Host "请确认 PowerShell 是以管理员身份运行"
  exit 1
}
