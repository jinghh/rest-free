# 复现脚本：同时触发三个位置的提醒弹窗并全屏截图
# 用法: powershell -ExecutionPolicy Bypass -File scripts/repro-reminder.ps1
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

# 关键：必须先声明 DPI 感知，再加载 WinForms。
# 否则 Screen.Bounds / Cursor.Position 返回逻辑像素(DIP)，而 CopyFromScreen 抓的是物理像素，
# 高 DPI 屏(scaleFactor=2)下截图只覆盖屏幕左上角 1/4，弹窗会被裁掉一半。
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DpiAware {
  [DllImport("shcore.dll")]
  public static extern int SetProcessDpiAwareness(int awareness);
}
"@
[void][DpiAware]::SetProcessDpiAwareness(2) # PROCESS_PER_MONITOR_DPI_AWARE

# 把鼠标移回主屏中心：弹窗按鼠标所在屏幕定位，确保落在截图范围内
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$anchor = New-Object System.Drawing.Point([int]($bounds.X + $bounds.Width / 2), [int]($bounds.Y + $bounds.Height / 2))

function Reset-Cursor {
  # 鼠标可能被其他程序/用户移走，导致弹窗定位到副屏，截图拍不到
  if ([System.Windows.Forms.Cursor]::Position -ne $anchor) {
    [System.Windows.Forms.Cursor]::Position = $anchor
  }
}
Reset-Cursor

$proc = Start-Process -FilePath (Join-Path $root 'node_modules\electron\dist\electron.exe') -ArgumentList $root -PassThru

# 等待触发（最多 65s）+ 动画结束（3s）
$deadline = (Get-Date).AddSeconds(80)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  Reset-Cursor
  if ($proc.HasExited) { Write-Host 'FAIL: app exited early'; Stop-Tree $proc.Id; exit 1 }
}
Write-Host "reminders should be visible now (now: $((Get-Date).ToString('HH:mm:ss')))"

# 全屏截图
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)
$out = Join-Path $root 'screenshot-reminder.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "screenshot saved: $out ($($bounds.Width)x$($bounds.Height))"

Stop-Tree $proc.Id
