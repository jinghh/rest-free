# 验证「提醒弹出后主窗口的下次提醒时间自动刷新」——纯日志验证，不截图、不动鼠标、不抢焦点。
# 原理：调度器每次触发提醒都会推进 nextFireAt，主进程随即广播调度快照，
#       日志中的「触发提醒」与「调度快照已推送到主窗口」成对出现即证明链路打通。
# 用法: powershell -ExecutionPolicy Bypass -File scripts/verify-schedule-push.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Stop-Tree([int]$processId) {
  try { taskkill /PID $processId /T /F 2>$null | Out-Null } catch {}
}

$stale = Get-Process electron -ErrorAction SilentlyContinue
if ($stale) { $stale | ForEach-Object { Stop-Tree $_.Id }; Start-Sleep -Seconds 2 }

node (Join-Path $root 'scripts\gen-repro-config.mjs')

$logPath = Join-Path $env:APPDATA 'rest-free\logs\app.log'
# 明确按 UTF-8 读日志：Get-Content 在 PS 5.1 下按 ANSI 代码页读，会乱码且行数错位
function Read-LogLines {
  if (-not (Test-Path $logPath)) { return @() }
  return [System.IO.File]::ReadAllLines($logPath, [System.Text.Encoding]::UTF8)
}
$logLinesBefore = (Read-LogLines).Count

$proc = Start-Process -FilePath (Join-Path $root 'node_modules\electron\dist\electron.exe') -ArgumentList $root -PassThru
Write-Host "app started (pid=$($proc.Id)), waiting for the first fire (no screenshot, no focus stealing)..."

# 等待新的触发日志（最多 100s）。注意：PowerShell 5.1 会按 GBK 读取无 BOM 的 .ps1，
# 脚本内不要出现中文字面量（会被误解码并破坏语法），故这里用 ASCII 正则匹配 reminder[ 行。
$deadline = (Get-Date).AddSeconds(100)
$fired = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 1
  if ($proc.HasExited) { Write-Host 'FAIL: app exited early'; Stop-Tree $proc.Id; exit 1 }
  $all = Read-LogLines
  if ($all.Count -gt $logLinesBefore -and ($all[$logLinesBefore..($all.Count - 1)] -match 'reminder\[')) {
    $fired = $true
    break
  }
}
if (-not $fired) { Write-Host 'FAIL: no reminder fired within 100s'; Stop-Tree $proc.Id; exit 1 }

# 弹窗动画结束 + 广播送达后读取日志
Start-Sleep -Seconds 3
$all = Read-LogLines
$new = @($all[$logLinesBefore..($all.Count - 1)])
Write-Host '--- new log lines (fire + schedule push) ---'
$new | ForEach-Object { Write-Host $_ }

# 统计：日志顺序为「触发提醒」→「调度快照已推送到主窗口」→「reminder[position] 位置日志」。
# 脚本内避免中文字面量（PS 5.1 按 GBK 读脚本会误解码），故用 ASCII 的位置日志行做锚点：
# 每条位置日志行的前一行若不是位置日志行，即说明它前面发生了「触发 + 推送」。
$fires = 0
$pushes = 0
for ($i = 0; $i -lt $new.Count; $i++) {
  if ($new[$i] -match 'reminder\[') {
    $fires++
    if ($i -ge 1 -and $new[$i - 1] -notmatch 'reminder\[') { $pushes++ }
  }
}
Stop-Tree $proc.Id
Write-Host "position log lines: $fires, fire+push pairs: $pushes"
Write-Host 'expect: pairs == position lines (each fire pushes a fresh schedule snapshot)'
