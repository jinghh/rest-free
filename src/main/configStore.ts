import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import {
  CONFIG_VERSION,
  DEFAULTS_VERSION,
  DEFAULT_SETTINGS,
  DEFAULT_TASKS,
  isDefaultTaskId,
  type AppConfig,
  type Settings,
  type SchedulerState,
  type Task,
  type TaskDraft
} from '../shared/types'
import { logger } from './logger'

/** 数字区间钳制，非法值回落默认值 */
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 校验并规范化 HH:mm，非法返回 null */
function parseHHmm(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  return m ? `${m[1]}:${m[2]}` : null
}

function normalizeTask(raw: unknown): Task | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Partial<Task>
  if (typeof t.name !== 'string' || t.name.trim().length === 0) return null
  if (typeof t.message !== 'string' || t.message.trim().length === 0) return null
  const startTime = parseHHmm(t.startTime) ?? '10:00'
  const intervalMinutes = clamp(t.intervalMinutes, 1, 1440, 45)
  const now = Date.now()
  return {
    id: typeof t.id === 'string' && t.id.length > 0 ? t.id : cryptoRandomId(),
    name: t.name.trim().slice(0, 30),
    startTime,
    intervalMinutes,
    message: t.message.trim().slice(0, 60),
    position:
      t.position === 'top' || t.position === 'center' || t.position === 'bottom-right' ? t.position : 'center',
    enabled: t.enabled !== false,
    createdAt: typeof t.createdAt === 'number' ? t.createdAt : now,
    updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : now,
    customized: t.customized === true
  }
}

function cryptoRandomId(): string {
  return crypto.randomUUID()
}

function defaultConfig(): AppConfig {
  return {
    version: CONFIG_VERSION,
    // 0 表示尚未同步默认任务，加载后 syncDefaults 会立即合并
    defaultsVersion: 0,
    tasks: [],
    settings: { ...DEFAULT_SETTINGS },
    removedDefaults: []
  }
}

/** 规范化全局设置：缺字段补默认、越界钳制 */
export function normalizeSettings(raw: unknown): Settings {
  const base = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object') return base
  const s = raw as Partial<Settings>
  return {
    snoozeMinutes: clamp(s.snoozeMinutes, 1, 60, DEFAULT_SETTINGS.snoozeMinutes),
    restMinutes: clamp(s.restMinutes, 1, 60, DEFAULT_SETTINGS.restMinutes),
    launchAtStartup: s.launchAtStartup === true,
    soundEnabled: s.soundEnabled === true,
    doNotDisturb: s.doNotDisturb === true,
    // 缺省为 true：老配置没有该字段时保持原有「弹全屏倒计时」行为
    showRestCountdown: s.showRestCountdown !== false
  }
}

/** 将任意来源的数据规范化为合法配置：缺字段补默认、越界钳制、脏数据剔除 */
export function normalizeConfig(raw: unknown): AppConfig {
  const base = defaultConfig()
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Partial<AppConfig>
  const tasks = Array.isArray(obj.tasks)
    ? obj.tasks.map(normalizeTask).filter((t): t is Task => t !== null)
    : []
  const defaultsVersion =
    typeof obj.defaultsVersion === 'number' && Number.isFinite(obj.defaultsVersion) ? obj.defaultsVersion : 0
  const removedDefaults = Array.isArray(obj.removedDefaults)
    ? obj.removedDefaults.filter((x): x is string => typeof x === 'string')
    : []
  return { version: CONFIG_VERSION, defaultsVersion, tasks, settings: normalizeSettings(obj.settings), removedDefaults }
}

/** 任务业务字段是否一致（用于判断默认模板是否变化，避免无谓写盘） */
function isSameTaskBusiness(a: Task, b: Task): boolean {
  return (
    a.name === b.name &&
    a.startTime === b.startTime &&
    a.intervalMinutes === b.intervalMinutes &&
    a.message === b.message &&
    a.position === b.position &&
    a.enabled === b.enabled
  )
}

/**
 * 配置存储：config.json（任务 + 设置）与 state.json（调度状态）。
 * - 原子写入：先写 .tmp 再 rename，防止崩溃写一半
 * - 防抖保存：连续变更合并落盘，退出时 flush
 * - 损坏容错：解析失败时备份为 .corrupt.json 并用默认配置重建
 */
export class ConfigStore {
  private config: AppConfig
  private state: SchedulerState = {}
  private readonly configPath: string
  private readonly statePath: string
  private saveTimer: NodeJS.Timeout | null = null
  private stateSaveTimer: NodeJS.Timeout | null = null
  private readonly listeners = new Set<(config: AppConfig) => void>()
  private readonly stateListeners = new Set<() => void>()

  constructor() {
    const dir = app.getPath('userData')
    this.configPath = join(dir, 'config.json')
    this.statePath = join(dir, 'state.json')
    this.config = this.load()
    this.state = this.loadState()
    // 合并默认任务：首次启动开箱即用；版本升级时更新「用户未改动」的默认任务
    this.syncDefaults()
    // 兜底落盘，保证配置文件始终存在（设置展示、升级迁移基线）
    if (!existsSync(this.configPath)) this.saveNow()
    if (!existsSync(this.statePath)) this.saveStateNow()
  }

  /**
   * 默认配置合并（用户配置优先级 > 默认配置）：
   * - defaultsVersion 已是最新 → 直接返回
   * - 默认任务不存在于用户配置 → 插入（新默认规则）
   * - 存在且用户未改动（!customized）→ 用新模板覆盖（默认配置随版本更新）
   * - 存在且用户已改动（customized）→ 保留用户值
   * - 用户删除过（removedDefaults）→ 不加回
   */
  private syncDefaults(): void {
    if (this.config.defaultsVersion >= DEFAULTS_VERSION) return
    const now = Date.now()
    let changed = false
    for (const tpl of DEFAULT_TASKS) {
      if (this.config.removedDefaults.includes(tpl.id)) continue
      const existing = this.config.tasks.find((t) => t.id === tpl.id)
      if (!existing) {
        this.config.tasks.push({ ...tpl, createdAt: now, updatedAt: now, customized: false })
        changed = true
      } else if (existing.customized !== true && !isSameTaskBusiness(existing, tpl)) {
        // 模板有变化且用户未定制：覆盖业务字段，保留 createdAt
        const idx = this.config.tasks.findIndex((t) => t.id === tpl.id)
        this.config.tasks[idx] = { ...tpl, createdAt: existing.createdAt, updatedAt: now, customized: false }
        changed = true
      }
    }
    this.config.defaultsVersion = DEFAULTS_VERSION
    if (changed) {
      this.saveNow()
      this.notify()
      logger.info(`默认配置已合并（version ${DEFAULTS_VERSION}），任务数 ${this.config.tasks.length}`)
    }
  }

  // ---------- 读取 ----------

  /** 读取并解析 JSON 文件：剥离 BOM（记事本/PowerShell 另存的 UTF-8 常带 BOM，JSON.parse 不接受） */
  private readJson(path: string): unknown {
    let raw = readFileSync(path, 'utf-8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    return JSON.parse(raw)
  }

  private load(): AppConfig {
    try {
      if (!existsSync(this.configPath)) return defaultConfig()
      return normalizeConfig(this.readJson(this.configPath))
    } catch (err) {
      logger.error('config.json 解析失败，备份并重建', err)
      this.backupCorrupt(this.configPath)
      return defaultConfig()
    }
  }

  private loadState(): SchedulerState {
    try {
      if (!existsSync(this.statePath)) return {}
      const parsed = this.readJson(this.statePath)
      if (!parsed || typeof parsed !== 'object') return {}
      return parsed as SchedulerState
    } catch (err) {
      logger.warn('state.json 解析失败，忽略调度状态', err)
      return {}
    }
  }

  private backupCorrupt(path: string): void {
    try {
      copyFileSync(path, `${path}.corrupt.json`)
    } catch (err) {
      logger.warn('损坏配置备份失败', err)
    }
  }

  // ---------- 写入 ----------

  /** 防抖保存配置 */
  save(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveNow()
    }, 500)
  }

  /** 立即保存配置（原子写） */
  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    writeFileAtomic(this.configPath, JSON.stringify(this.config, null, 2))
  }

  /** 防抖保存调度状态 */
  saveState(): void {
    if (this.stateSaveTimer) return
    this.stateSaveTimer = setTimeout(() => {
      this.stateSaveTimer = null
      this.saveStateNow()
    }, 1000)
  }

  saveStateNow(): void {
    if (this.stateSaveTimer) {
      clearTimeout(this.stateSaveTimer)
      this.stateSaveTimer = null
    }
    writeFileAtomic(this.statePath, JSON.stringify(this.state, null, 2))
  }

  /** 退出前强制落盘 */
  flushAll(): void {
    this.saveNow()
    this.saveStateNow()
  }

  // ---------- 配置访问 ----------

  getConfig(): AppConfig {
    return this.config
  }

  getTask(id: string): Task | undefined {
    return this.config.tasks.find((t) => t.id === id)
  }

  /**
   * 新增或更新任务。输入来自 IPC（不可信），先过 normalizeTask 加固：
   * 修剪超长文本、钳制数值、剔除脏字段，非法输入直接拒绝。
   * 编辑时保留原 id 与 createdAt。
   * 命中默认任务 id 时标记 customized：此后版本升级不再覆盖该任务。
   */
  upsertTask(draft: TaskDraft): AppConfig {
    const normalized = normalizeTask(draft)
    if (!normalized) {
      logger.warn('拒绝写入非法任务数据')
      return this.config
    }
    if (isDefaultTaskId(normalized.id)) {
      normalized.customized = true
    }
    const now = Date.now()
    const idx = this.config.tasks.findIndex((t) => t.id === normalized.id)
    if (idx >= 0) {
      const existing = this.config.tasks[idx]
      this.config.tasks[idx] = { ...normalized, createdAt: existing.createdAt, updatedAt: now }
    } else {
      // 新建的任务若与某个已删除的默认任务同 id（用户手动构造），移除删除记录
      this.config.removedDefaults = this.config.removedDefaults.filter((x) => x !== normalized.id)
      this.config.tasks.push({ ...normalized, createdAt: now, updatedAt: now })
    }
    this.saveNow()
    this.notify()
    return this.config
  }

  deleteTask(id: string): AppConfig {
    this.config.tasks = this.config.tasks.filter((t) => t.id !== id)
    // 删除默认任务：记录到 removedDefaults，版本升级时不复活
    if (isDefaultTaskId(id) && !this.config.removedDefaults.includes(id)) {
      this.config.removedDefaults.push(id)
    }
    delete this.state[id]
    this.saveNow()
    this.saveStateNow()
    this.notify()
    this.notifyState()
    return this.config
  }

  updateSettings(patch: Partial<Settings>): Settings {
    // 只规范化 settings，避免每次更新都把全部任务重新过一遍
    this.config.settings = normalizeSettings({ ...this.config.settings, ...patch })
    this.saveNow()
    this.notify()
    return this.config.settings
  }

  // ---------- 调度状态访问 ----------

  getNextFireAt(taskId: string): number | undefined {
    return this.state[taskId]?.nextFireAt
  }

  getStateUpdatedAt(taskId: string): number | undefined {
    return this.state[taskId]?.updatedAt
  }

  /** 调度状态快照（内部引用，调用方只读） */
  getStateSnapshot(): SchedulerState {
    return this.state
  }

  setNextFireAt(taskId: string, nextFireAt: number): void {
    const prev = this.state[taskId]?.nextFireAt
    this.state[taskId] = { nextFireAt, updatedAt: Date.now() }
    this.saveState()
    // 仅在触发点真正变化时广播，避免配置重算等路径产生无效刷新
    if (prev !== nextFireAt) this.notifyState()
  }

  /** 剔除已删除任务的状态 */
  pruneState(): void {
    const ids = new Set(this.config.tasks.map((t) => t.id))
    let changed = false
    for (const key of Object.keys(this.state)) {
      if (!ids.has(key)) {
        delete this.state[key]
        changed = true
      }
    }
    if (changed) {
      this.saveStateNow()
      this.notifyState()
    }
  }

  // ---------- 订阅 ----------

  subscribe(listener: (config: AppConfig) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 订阅调度状态变化（nextFireAt 推进/删除）。
   * 调度器每次触发提醒、snooze、休息结束补触发都会改动触发点，
   * 主进程据此把最新快照推给渲染层，避免「下次提醒」显示旧时间。
   */
  subscribeState(listener: () => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.config)
      } catch (err) {
        logger.error('配置变更监听器执行失败', err)
      }
    }
  }

  private notifyState(): void {
    for (const listener of this.stateListeners) {
      try {
        listener()
      } catch (err) {
        logger.error('调度状态监听器执行失败', err)
      }
    }
  }
}

/** 原子写入：临时文件 + rename */
function writeFileAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`
  try {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(tmp, content, 'utf-8')
    renameSync(tmp, path)
  } catch (err) {
    logger.error('写入文件失败', path, err)
    // 清理可能残留的临时文件
    try {
      if (existsSync(tmp)) renameSync(tmp, `${tmp}.broken`)
    } catch {
      // 忽略
    }
  }
}
