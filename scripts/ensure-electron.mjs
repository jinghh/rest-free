/**
 * 确保 electron 二进制已就位。
 *
 * 背景：electron 的二进制（约 250MB）由包的 postinstall（install.js）下载，但：
 * - pnpm 的 side-effects 缓存可能在包已安装时跳过 postinstall；
 * - 国内网络直连 GitHub 下载常失败。
 *
 * 本脚本作为项目级 postinstall 兜底：检查 dist/electron.exe，缺失则触发下载；
 * 失败时提示设置 ELECTRON_MIRROR 镜像。
 *
 * 跨平台说明：项目当前仅支持 Windows，其他平台仅提示，不阻断安装。
 */
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)

let electronDir
try {
  electronDir = dirname(require.resolve('electron'))
} catch {
  console.log('[ensure-electron] electron 未安装，跳过')
  process.exit(0)
}

const isWin = process.platform === 'win32'
const exeName = isWin ? 'electron.exe' : 'electron'
const exePath = join(electronDir, 'dist', exeName)

if (existsSync(exePath)) {
  console.log('[ensure-electron] 二进制已就位')
  process.exit(0)
}

if (!isWin) {
  console.log('[ensure-electron] 非 Windows 平台，请手动执行: node node_modules/electron/install.js')
  process.exit(0)
}

console.log('[ensure-electron] 开始下载 electron 二进制...')
try {
  execFileSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' })
} catch {
  console.error(
    '[ensure-electron] 下载失败。若网络受限，请设置镜像后重试:\n' +
      '  $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"; pnpm install'
  )
  process.exit(1)
}

if (!existsSync(exePath)) {
  console.error('[ensure-electron] 下载后仍未找到二进制，请检查网络或手动执行 node node_modules/electron/install.js')
  process.exit(1)
}

console.log('[ensure-electron] 二进制下载完成')
