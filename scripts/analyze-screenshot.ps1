# 像素级分析截图：定位 Element Message 风格提醒卡片（浅绿底 #f0f9eb）的包围盒与圆角
# 用法: powershell -ExecutionPolicy Bypass -File scripts/analyze-screenshot.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$screenshot = Join-Path $root 'screenshot-reminder.png'
$bmp = [System.Drawing.Bitmap]::FromFile($screenshot)
$W = $bmp.Width; $H = $bmp.Height
Write-Host "screenshot: ${W}x${H}"

# 浅绿底判定：#f0f9eb 附近（容差 6），命中即认为是卡片像素
function Test-MsgBg($c) {
  return ([Math]::Abs($c.R - 240) -le 8) -and ([Math]::Abs($c.G - 249) -le 8) -and ([Math]::Abs($c.B - 235) -le 8)
}

# 按行聚合：连续存在卡片像素的行构成一个簇（= 一张卡片）
$rows = New-Object 'System.Collections.Generic.List[object]'
for ($y = 0; $y -lt $H; $y++) {
  $minX = -1; $maxX = -1
  for ($x = 0; $x -lt $W; $x++) {
    if (Test-MsgBg $bmp.GetPixel($x, $y)) {
      if ($minX -lt 0) { $minX = $x }
      $maxX = $x
    }
  }
  $rows.Add([pscustomobject]@{ y = $y; minX = $minX; maxX = $maxX })
}

$clusters = @()
$cur = $null
foreach ($r in $rows) {
  if ($r.minX -lt 0) {
    if ($cur) { $clusters += $cur; $cur = $null }
    continue
  }
  if (-not $cur) { $cur = [pscustomobject]@{ y0 = $r.y; y1 = $r.y; x0 = $r.minX; x1 = $r.maxX } }
  else {
    $cur.y1 = $r.y
    if ($r.minX -lt $cur.x0) { $cur.x0 = $r.minX }
    if ($r.maxX -gt $cur.x1) { $cur.x1 = $r.maxX }
  }
}
if ($cur) { $clusters += $cur }

$label = 1
foreach ($c in $clusters) {
  if (($c.y1 - $c.y0) -lt 20) { continue } # 跳过细碎噪点
  $w = $c.x1 - $c.x0 + 1
  $h = $c.y1 - $c.y0 + 1
  Write-Host ("card#{0}: bbox=({1},{2})-({3},{4}) size={5}x{6}px  (scaleFactor2 -> {7}x{8} DIP)" -f $label, $c.x0, $c.y0, $c.x1, $c.y1, $w, $h, [int]($w / 2), [int]($h / 2))

  # 四角采样：圆角处应为非卡片色（左上角往内 3px 处才应为卡片色）
  $cornerIn = $bmp.GetPixel($c.x0 + 3, $c.y0 + 3)
  $cornerOut = $bmp.GetPixel($c.x0, $c.y0)
  Write-Host ("        corner: outer(#{0:X2}{1:X2}{2:X2}) inner3px(#{3:X2}{4:X2}{5:X2}) -> rounded={6}" -f `
    $cornerOut.R, $cornerOut.G, $cornerOut.B, $cornerIn.R, $cornerIn.G, $cornerIn.B, (-not (Test-MsgBg $cornerOut)))
  $label++
}

if ($label -eq 1) { Write-Host 'no message card background found' }
$bmp.Dispose()
