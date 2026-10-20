# 截图裁剪工具：把大截图裁成局部，便于查看细节
# 用法: powershell -ExecutionPolicy Bypass -File scripts/crop-shot.ps1 -In screenshot-reminder.png -X 800 -Y 0 -W 1400 -H 300 -Out crop-top.png
param(
  [string]$In = 'screenshot-reminder.png',
  [int]$X = 0,
  [int]$Y = 0,
  [int]$W = 0,
  [int]$H = 0,
  [string]$Out = 'crop.png'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile((Join-Path $root $In))
if ($W -le 0) { $W = $src.Width - $X }
if ($H -le 0) { $H = $src.Height - $Y }
$rect = New-Object System.Drawing.Rectangle($X, $Y, $W, $H)
$dst = $src.Clone($rect, $src.PixelFormat)
$path = Join-Path $root $Out
$dst.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$dst.Dispose(); $src.Dispose()
Write-Host "cropped: $path ($W x $H) from ($X,$Y)"
