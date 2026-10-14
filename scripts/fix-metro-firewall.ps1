# Opens the Metro bundler ports so Expo Go / the dev client on your phone can
# reach this computer over Wi-Fi.
#
# Why this is needed: Windows often marks Wi-Fi as "Public", and the default
# Node.js inbound rules / Private-only rules then drop the phone's request to
# port 8081 ("Failed to connect to /x.x.x.x:8081").
#
# Run once, as Administrator:
#   Right-click this file > "Run with PowerShell"  (approve the UAC prompt)
# or from an elevated terminal:
#   powershell -ExecutionPolicy Bypass -File scripts\fix-metro-firewall.ps1

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host 'Re-launching as Administrator...' -ForegroundColor Yellow
  Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"" -Verb RunAs
  return
}

foreach ($port in 8081, 8082) {
  $name = "Expo Metro $port"
  Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  # Include Public: many home/campus networks stay Public and Private-only rules fail.
  New-NetFirewallRule -DisplayName $name `
    -Direction Inbound -Protocol TCP -LocalPort $port `
    -Action Allow -Profile Any | Out-Null
  Write-Host "Allowed inbound TCP $port on all network profiles." -ForegroundColor Green
}

try {
  Get-NetConnectionProfile | Where-Object { $_.InterfaceAlias -like 'Wi-Fi*' } |
    Set-NetConnectionProfile -NetworkCategory Private -ErrorAction Stop
  Write-Host 'Set Wi-Fi network category to Private.' -ForegroundColor Green
} catch {
  Write-Host "Could not set Wi-Fi to Private: $($_.Exception.Message)" -ForegroundColor Yellow
}

$wifi = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.InterfaceAlias -like 'Wi-Fi*' -and $_.IPAddress -ne '127.0.0.1' } |
  Select-Object -First 1

if ($wifi) {
  Write-Host ''
  Write-Host "Your LAN address is $($wifi.IPAddress)." -ForegroundColor Cyan
  Write-Host "Check it from your phone's browser: http://$($wifi.IPAddress):8081" -ForegroundColor Cyan
  Write-Host 'If that page loads, run "npm start" and scan the QR code.' -ForegroundColor Cyan
}

Write-Host ''
Write-Host 'Done. Press Enter to close.'
Read-Host | Out-Null
