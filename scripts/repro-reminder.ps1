# 复现脚本：同时触发三个位置的提醒弹窗。
# 默认「只复现弹窗」：不截图、不移动鼠标、不抢焦点，不会打断正在进行的其它工作。
# 需要截图时显式加 -Capture（会移动鼠标到主屏中心并在结束后复位，执行前请先确认不会影响手头工作）。
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts/repro-reminder.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/repro-reminder.ps1 -Capture
param(
  [switch]$Capture
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Stop-Tree([int]$processId) {
  try { taskkill /PID $processId /T /F 2>$null | Out-Null } catch {}
}

# 清理残留 electron（持单实例锁会导致新实例秒退）
$stale = Get-Process electron -ErrorAction SilentlyContinue
if ($stale) { $stale | ForEach-Object { Stop-Tree $_.Id }; Start-Sleep -Seconds 2 }

# 生成复现配置（Node 写入，避免 PS 代码页编码问题）
node (Join-Path $root 'scripts\gen-repro-config.mjs')

$logPath = Join-Path $env:APPDATA 'rest-free\logs\app.log'
$logLinesBefore = if (Test-Path $logPath) { (Get-Content $logPath).Count } else { 0 }

$proc = Start-Process -FilePath (Join-Path $root 'node_modules\electron\dist\electron.exe') -ArgumentList $root -PassThru
Write-Host "app started (pid=$($proc.Id))"

# 等待触发（最多 100s）
$deadline = (Get-Date).AddSeconds(100)
$fired = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 1
  if ($proc.HasExited) { Write-Host 'FAIL: app exited early'; Stop-Tree $proc.Id; exit 1 }
  if (-not (Test-Path $logPath)) { continue }
  $new = @(Get-Content $logPath | Select-Object -Skip $logLinesBefore)
  if ($new | Where-Object { $_ -match 'reminder\[' }) { $fired = $true; break }
}
if (-not $fired) { Write-Host 'FAIL: no reminder fired within 100s'; Stop-Tree $proc.Id; exit 1 }
Write-Host 'reminders fired'

if (-not $Capture) {
  Write-Host 'done (no screenshot, mouse untouched). Use -Capture to take a screenshot.'
  Stop-Tree $proc.Id
  exit 0
}

# ---------- 以下为截图流程（需显式 -Capture） ----------
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DpiAware {
  [DllImport("shcore.dll")]
  public static extern int SetProcessDpiAwareness(int awareness);
}
"@
[void][DpiAware]::SetProcessDpiAwareness(2) # PROCESS_PER_MONITOR_DPI_AWARE
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$anchor = New-Object System.Drawing.Point([int]($bounds.X + $bounds.Width / 2), [int]($bounds.Y + $bounds.Height / 2))
$cursorBackup = [System.Windows.Forms.Cursor]::Position
[System.Windows.Forms.Cursor]::Position = $anchor
Start-Sleep -Seconds 2

$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)
$out = Join-Path $root 'screenshot-reminder.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
[System.Windows.Forms.Cursor]::Position = $cursorBackup
Write-Host "screenshot saved: $out ($($bounds.Width)x$($bounds.Height))"

Stop-Tree $proc.Id
