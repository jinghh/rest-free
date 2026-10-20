# 冒烟测试：启动应用 8 秒，检查进程存活与运行日志
# 用法: powershell -ExecutionPolicy Bypass -File scripts/smoke-test.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (!(Test-Path $electron)) {
  Write-Host 'FAIL: electron.exe not found, run pnpm install first'
  exit 1
}

$logFile = Join-Path $env:APPDATA 'rest-free\logs\app.log'
if (Test-Path $logFile) { Remove-Item $logFile -Force }

# 清理可能残留的 electron 进程（孤儿进程会持有单实例锁，导致新启动的实例秒退）
$stale = Get-Process electron -ErrorAction SilentlyContinue
if ($stale) {
  Write-Host "cleaning $($stale.Count) stale electron process(es)..."
  $stale | ForEach-Object { taskkill /PID $_.Id /T /F 2>$null | Out-Null }
  Start-Sleep -Seconds 2
}

$proc = Start-Process -FilePath $electron -ArgumentList $root -PassThru
Start-Sleep -Seconds 8

if ($proc.HasExited) {
  Write-Host "FAIL: app exited early, code=$($proc.ExitCode)"
} else {
  Write-Host "OK: app running (pid=$($proc.Id))"
  # taskkill /T 杀整个进程树，避免 GPU/utility 子进程成孤儿残留
  taskkill /PID $proc.Id /T /F 2>$null | Out-Null
  Start-Sleep -Seconds 1
}

if (Test-Path $logFile) {
  Write-Host '--- app.log (tail) ---'
  Get-Content $logFile | Select-Object -Last 20
} else {
  Write-Host 'WARN: app.log not found'
}
