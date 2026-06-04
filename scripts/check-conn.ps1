$p = Get-Process opencode -ErrorAction SilentlyContinue | Select-Object -First 1
if ($p) {
    Write-Host "PID: $($p.Id)"
    Get-NetTCPConnection -OwningProcess $p.Id -State Established -ErrorAction SilentlyContinue | Format-Table RemoteAddress, RemotePort -AutoSize
} else {
    Write-Host "No opencode process"
}
