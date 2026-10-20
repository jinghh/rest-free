/**
 * 验证用户数据目录中的默认配置注入结果。
 * 用法: node scripts/verify-defaults.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const userData =
  process.platform === 'win32'
    ? join(process.env.APPDATA ?? join(homedir(), 'AppData/Roaming'), 'rest-free')
    : join(homedir(), '.config', 'rest-free')

const configPath = join(userData, 'config.json')
const statePath = join(userData, 'state.json')

if (!existsSync(configPath)) {
  console.error(`config.json not found: ${configPath}\n请先启动一次应用。`)
  process.exit(1)
}

const cfg = JSON.parse(readFileSync(configPath, 'utf-8'))
console.log(`config: ${configPath}`)
console.log(`defaultsVersion: ${cfg.defaultsVersion}`)
console.log(`removedDefaults: ${JSON.stringify(cfg.removedDefaults)}`)
console.log('tasks:')
for (const t of cfg.tasks) {
  const tag = t.customized ? 'customized' : 'default'
  console.log(
    `  [${t.id}] ${t.name} | ${t.startTime} 起 / 每 ${t.intervalMinutes} 分钟 | ${t.position} | enabled=${t.enabled} | ${tag}`
  )
}

if (existsSync(statePath)) {
  const state = JSON.parse(readFileSync(statePath, 'utf-8'))
  console.log('next fire times:')
  for (const [id, v] of Object.entries(state)) {
    console.log(`  ${id} -> ${new Date(v.nextFireAt).toLocaleString('zh-CN')}`)
  }
} else {
  console.log('state.json not found')
}
