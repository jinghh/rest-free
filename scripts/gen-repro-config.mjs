/**
 * 生成复现用配置：三个不同位置的提醒任务，startTime 为 65 秒后。
 * 用 Node 写入避免 PowerShell 代码页导致的编码问题。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const userData = process.env.APPDATA
  ? join(process.env.APPDATA, 'rest-free')
  : join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.config', 'rest-free')
mkdirSync(userData, { recursive: true })

const t = new Date(Date.now() + 65_000)
const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`

const cfg = {
  version: 1,
  defaultsVersion: 1,
  tasks: [
    {
      id: 'repro-top',
      name: '拉伸放松',
      startTime: hhmm,
      intervalMinutes: 2,
      message: '坐太久了，起来拉伸一下，放松身体！',
      position: 'top',
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
      customized: true
    },
    {
      id: 'repro-center',
      name: '喝水 · 上厕所',
      startTime: hhmm,
      intervalMinutes: 2,
      message: '该喝水了，顺便去洗手间活动一下吧',
      position: 'center',
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
      customized: true
    },
    {
      id: 'repro-br',
      name: '远眺放松',
      startTime: hhmm,
      intervalMinutes: 2,
      message: '远眺 20 秒，放松眼睛',
      position: 'bottom-right',
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
      customized: true
    }
  ],
  settings: { snoozeMinutes: 5, restMinutes: 5, launchAtStartup: false, soundEnabled: false, doNotDisturb: false },
  removedDefaults: []
}

writeFileSync(join(userData, 'config.json'), JSON.stringify(cfg, null, 2), 'utf-8')
writeFileSync(join(userData, 'state.json'), '{}', 'utf-8')
console.log(`repro config written, fire at ${hhmm}`)
