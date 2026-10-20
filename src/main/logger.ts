import { existsSync, appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * 轻量文件日志：写入 userData/logs/app.log，超过 1MB 截断重写。
 * 日志不可用时静默降级，绝不影响主流程。
 */
class Logger {
  private logFile = ''
  private initialized = false
  private readonly maxSize = 1024 * 1024

  init(): void {
    if (this.initialized) return
    try {
      const dir = join(app.getPath('userData'), 'logs')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      this.logFile = join(dir, 'app.log')
      this.initialized = true
    } catch {
      this.initialized = false
    }
  }

  private write(level: 'INFO' | 'WARN' | 'ERROR', args: unknown[]): void {
    if (!this.initialized) return
    const time = new Date().toISOString()
    const msg = args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : safeStringify(a)))
      .join(' ')
    const line = `[${time}] [${level}] ${msg}\n`
    try {
      if (existsSync(this.logFile) && statSync(this.logFile).size > this.maxSize) {
        writeFileSync(this.logFile, line)
      } else {
        appendFileSync(this.logFile, line)
      }
    } catch {
      // 忽略：磁盘异常时丢弃日志
    }
  }

  info(...args: unknown[]): void {
    this.write('INFO', args)
  }

  warn(...args: unknown[]): void {
    this.write('WARN', args)
  }

  error(...args: unknown[]): void {
    this.write('ERROR', args)
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export const logger = new Logger()
