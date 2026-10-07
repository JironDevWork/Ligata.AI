# Puts Ligata AI under PM2 so it starts with Windows (via the existing "PM2 - Code Projects" boot task).
# Run in your own PowerShell as Server:
#   powershell -ExecutionPolicy Bypass -File C:\Code\Ligata.AI\gateway\install-pm2.ps1
$ErrorActionPreference = 'Stop'
$gateway = $PSScriptRoot
$pm2 = 'C:\Code\pm2.cmd'

# 1. Stop copies started by hand (for example during development). PM2-managed processes run through
#    PM2's ProcessContainer, so their command lines do not contain the script names.
$manual = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'llm-launcher\.mjs|src[\\/]main\.mjs' }
foreach ($p in $manual) { Write-Host "Stopping manually started $($p.CommandLine) (pid $($p.ProcessId))"; Stop-Process -Id $p.ProcessId -Force }
Get-Process llama-server -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "Stopping llama-server (pid $($_.Id))"; Stop-Process -Id $_.Id -Force }
Start-Sleep -Seconds 2

# 2. Dependencies (pdfjs-dist) and the PM2 processes.
Push-Location $gateway
try {
  if (-not (Test-Path (Join-Path $gateway 'node_modules\pdfjs-dist'))) { & 'C:\Program Files\nodejs\npm.cmd' ci --no-audit --no-fund }
  & $pm2 delete ligata-ai ligata-ai-llm 2>$null | Out-Null
  & $pm2 start (Join-Path $gateway 'ecosystem.config.cjs')
  & $pm2 save
} finally { Pop-Location }

# 3. Wait for the model and show the status.
Write-Host 'Waiting for the model to load ...'
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 2
  try { if ((Invoke-RestMethod 'http://127.0.0.1:1210/v1/health' -TimeoutSec 3).model -eq 'ready') { break } } catch {}
}
& 'C:\Program Files\nodejs\node.exe' (Join-Path $gateway 'cli.mjs') status
Write-Host "`nOperator page: http://127.0.0.1:1212" -ForegroundColor Green
