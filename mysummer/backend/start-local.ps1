$ErrorActionPreference = 'Stop'
$backendPath = $PSScriptRoot
$healthUrl = 'http://127.0.0.1:8787/health'
function Test-Backend {
  try { $result = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2; return ($result.service -eq 'mysummer-backend') } catch { return $false }
}
if (Test-Backend) { Write-Host 'Backend already running: http://127.0.0.1:8787'; exit 0 }
if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8787 is occupied by another service. No process was stopped.' }
$nodePath = (Get-Command node -ErrorAction Stop).Source
$logPath = Join-Path $backendPath '.runtime'
New-Item -ItemType Directory -Force -Path $logPath | Out-Null
# Explicit local-only binding; does not expose the development server to the LAN.
$env:HOST = '127.0.0.1'
$env:PORT = '8787'
$process = Start-Process -FilePath $nodePath -ArgumentList 'src/server.js' -WorkingDirectory $backendPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logPath 'stdout.log') -RedirectStandardError (Join-Path $logPath 'stderr.log')
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  if (Test-Backend) { Write-Host "Backend ready: http://127.0.0.1:8787 (PID $($process.Id))"; exit 0 }
  if ($process.HasExited) { throw 'Backend exited. Check backend/.runtime/stderr.log.' }
  Start-Sleep -Milliseconds 250
}
throw 'Backend did not become ready. Check backend/.runtime/stderr.log.'
