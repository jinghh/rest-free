# 生成 Rest-Free 应用图标（PNG）：绿色渐变圆角方块 + 白色时钟
# 用法: powershell -ExecutionPolicy Bypass -File scripts/gen-icon.ps1
Add-Type -AssemblyName System.Drawing

function New-RestIcon([int]$size, [string]$out) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  # 圆角矩形路径
  $rect = New-Object System.Drawing.Rectangle(0, 0, ($size - 1), ($size - 1))
  $radius = [int]($size * 0.22)
  $d = $radius * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
  $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()

  # 绿色渐变填充
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(52, 211, 153), [System.Drawing.Color]::FromArgb(5, 150, 105), [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
  $g.FillPath($brush, $path)

  # 白色时钟图案
  $cx = $size / 2.0
  $cy = $size / 2.0
  $r = $size * 0.28
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [single]($size * 0.055))
  $g.DrawEllipse($pen, [single]($cx - $r), [single]($cy - $r), [single](2 * $r), [single](2 * $r))
  $g.DrawLine($pen, [single]$cx, [single]$cy, [single]$cx, [single]($cy - $r * 0.62))
  $g.DrawLine($pen, [single]$cx, [single]$cy, [single]($cx + $r * 0.5), [single]($cy + $r * 0.32))

  $dir = Split-Path -Parent $out
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose()
  $brush.Dispose()
  $path.Dispose()
  $g.Dispose()
  $bmp.Dispose()
  Write-Host "generated: $out ($size x $size)"
}

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
New-RestIcon 256 (Join-Path $root 'resources\icon.png')
New-RestIcon 64 (Join-Path $root 'resources\tray.png')
