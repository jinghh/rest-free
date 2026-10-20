# dev 模式复现：启动 electron-vite dev，等待三个位置的提醒触发，capturePage 像素验证
# 用法: powershell -ExecutionPolicy Bypass -File scripts/dev-repro.ps1
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Stop-Tree([int]$processId) {
  try { taskkill /PID $processId /T /F 2>$null | Out-Null } catch {}
}

# 清理残留进程
Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { Stop-Tree $_.Id }
Start-Sleep -Seconds 2

# 预置配置：state 直接指定 90 秒后触发（不依赖 startTime 计算，规避整分边界）
$now = [DateTimeOffset]::UtcNow
$fireAt = [DateTimeOffset]::UtcNow.AddSeconds(90).ToUnixTimeMilliseconds()
$stateAt = [DateTimeOffset]::UtcNow.AddMinutes(30).ToUnixTimeMilliseconds()
$state = "{`"repro-top`":{`"nextFireAt`":$fireAt,`"updatedAt`":$stateAt},`"repro-center`":{`"nextFireAt`":$fireAt,`"updatedAt`":$stateAt},`"repro-br`":{`"nextFireAt`":$fireAt,`"updatedAt`":$stateAt}}"
$dir = Join-Path $env:APPDATA 'rest-free'
[System.IO.File]::WriteAllText((Join-Path $dir 'state.json'), $state, (New-Object System.Text.UTF8Encoding($false)))
node (Join-Path $root 'scripts\gen-repro-config.mjs') | Out-Null
# gen 脚本会覆盖 state.json，重新写一次预置 state
[System.IO.File]::WriteAllText((Join-Path $dir 'state.json'), $state, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "config armed, fire in 90s (now: $((Get-Date).ToString('HH:mm:ss')))"

# 启动 dev（npm run dev 进程树包含 electron）
$dev = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory $root -PassThru -WindowStyle Hidden

# 等待触发（dev 启动 ~8s + 90s）+ capture（2.5s）
$deadline = (Get-Date).AddSeconds(115)
while ((Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
Write-Host "checking captures (now: $((Get-Date).ToString('HH:mm:ss')))"

Stop-Tree $dev.Id
Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { Stop-Tree $_.Id }
Start-Sleep -Seconds 2

# 像素测量
Add-Type -AssemblyName System.Drawing
foreach ($pos in @('top', 'center', 'bottom-right')) {
  $f = Join-Path $dir "capture-$pos.png"
  if (Test-Path $f) {
    $bmp = [System.Drawing.Bitmap]::FromFile($f)
    $c = $bmp.GetPixel([int]($bmp.Width / 2), [int]($bmp.Height / 2))
    $ok = if ($c.A -eq 255 -and $c.R -gt 240 -and $c.G -gt 240 -and $c.B -gt 240) { 'WHITE-OK' } else { 'BAD' }
    Write-Host ("capture-$pos : A={0} RGB=({1},{2},{3}) -> {4}" -f $c.A, $c.R, $c.G, $c.B, $ok)
    $bmp.Dispose()
  } else {
    Write-Host "capture-$pos : MISSING"
  }
}
