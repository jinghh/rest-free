import type { ReminderAction, Task } from '../shared/types'
import type { RestState } from '../shared/api'
import type { ConfigStore } from './configStore'
import { logger } from './logger'

const MINUTE = 60_000
const DAY = 86_400_000
/** 无启用任务时的兜底 tick 间隔，保证睡眠唤醒后能被及时发现 */
const IDLE_TICK = 60_000

/** 当天 00:00 的时间戳 */
function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 某天 startTime 时刻的时间戳 */
function startTimeOnDay(dayStart: number, startTime: string): number {
  const [h, m] = startTime.split(':').map(Number)
  return dayStart + h * 3_600_000 + m * MINUTE
}

/**
 * 计算「从 from 之后」的下一个触发点：
 * 今天 startTime 起按 interval 步进到第一个 > from 的时刻。
 */
function computeNextFireAt(task: Task, from: number): number {
  const today = startTimeOnDay(startOfDay(from), task.startTime)
  const interval = task.intervalMinutes * MINUTE
  let candidate = today
  // 防止极端数据导致死循环：最多推进 DAY/interval + 2 次
  const maxSteps = Math.ceil(DAY / Math.max(interval, 1)) + 2
  let steps = 0
  while (candidate <= from && steps < maxSteps) {
    candidate += interval
    steps++
  }
  return candidate
}

/**
 * 从 prev 触发点推进到下一个：
 * prev + interval；若越过「次日 startTime」则对齐回次日 startTime，
 * 保证每天首次触发时刻固定（interval >= 1 天时不做每日对齐）。
 */
function advanceNextFireAt(task: Task, prev: number): number {
  const next = prev + task.intervalMinutes * MINUTE
  if (task.intervalMinutes >= 1440) return next
  const tomorrowStart = startTimeOnDay(startOfDay(prev) + DAY, task.startTime)
  return next >= tomorrowStart ? tomorrowStart : next
}

/** 调度引擎依赖的提醒窗口能力 */
export interface ReminderHost {
  showReminder: (task: Task) => void
  closeReminder: (taskId: string) => void
  startRest: (task: Task, onDone: () => void) => void
  closeRest: () => void
  isResting: () => boolean
  /** 休息遮罩的结束时间戳（0 表示没有遮罩） */
  getRestEndAt: () => number
}

/**
 * 调度引擎：
 * - 每个启用任务维护 nextFireAt，动态 setTimeout 精确触发（误差 < 2s）
 * - 系统睡眠唤醒后 setTimeout 延迟触发，天然实现「错过补偿」
 * - 勿扰模式 / 休息期间抑制触发（不推进 nextFireAt，恢复后自然补触发）
 * - snooze 仅覆盖一次，之后回到常规节奏
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private resting = false
  /** 本次休息的结束时间戳（静默休息与遮罩休息共用） */
  private restEndAt = 0
  /** 静默休息的到期定时器（不弹全屏遮罩时使用） */
  private silentRestTimer: NodeJS.Timeout | null = null
  /** 休息状态广播定时器（每秒推送剩余时间） */
  private restStateTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly store: ConfigStore,
    private readonly reminders: ReminderHost,
    /** 休息状态变化回调（用于推送给主窗口 / 托盘） */
    private readonly onRestState: (state: RestState) => void = () => {}
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    // recomputeAll 内部会 reschedule，无需在此重复 scheduleTick（否则双 timer 泄漏）
    this.recomputeAll()
    logger.info('调度引擎启动')
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.stopRestStateBroadcast()
    if (this.silentRestTimer) {
      clearTimeout(this.silentRestTimer)
      this.silentRestTimer = null
    }
  }

  /** 全量重算：缺失状态或被编辑过的任务按当前参数重算 nextFireAt */
  recomputeAll(): void {
    const now = Date.now()
    let changed = false
    for (const task of this.store.getConfig().tasks) {
      if (!task.enabled) continue
      const stateAt = this.store.getStateUpdatedAt(task.id)
      const next = this.store.getNextFireAt(task.id)
      if (next === undefined || stateAt === undefined || stateAt < task.updatedAt) {
        this.store.setNextFireAt(task.id, computeNextFireAt(task, now))
        changed = true
      }
    }
    this.store.pruneState()
    if (changed) this.store.saveStateNow()
    // nextFireAt 可能被提前/推后，必须按最新状态重新排眠，否则旧 timer 会睡在错误的点
    this.scheduleTick()
  }

  /** 调度快照：taskId -> nextFireAt（供主窗口展示下次提醒时间） */
  getSnapshot(): Record<string, number> {
    const snapshot: Record<string, number> = {}
    const state = this.store.getStateSnapshot()
    for (const [taskId, entry] of Object.entries(state)) {
      snapshot[taskId] = entry.nextFireAt
    }
    return snapshot
  }

  /** 用户操作提醒窗口后的统一入口（IPC 驱动） */
  handleReminderAction(taskId: string, action: ReminderAction): void {
    // 先关窗，防止任务已被删除时窗口残留
    this.reminders.closeReminder(taskId)
    const task = this.store.getTask(taskId)
    if (!task) return

    if (action === 'snooze') {
      const { snoozeMinutes } = this.store.getConfig().settings
      this.store.setNextFireAt(taskId, Date.now() + snoozeMinutes * MINUTE)
      this.store.saveStateNow()
      // snooze 把触发点改近了，必须重排定时器，否则会睡过 snooze 点
      this.scheduleTick()
      logger.info(`任务「${task.name}」稍后休息，${snoozeMinutes} 分钟后再次提醒`)
      return
    }

    if (action === 'rest') {
      const { restMinutes, showRestCountdown } = this.store.getConfig().settings
      this.restEndAt = Date.now() + restMinutes * MINUTE
      this.setResting(true)
      if (showRestCountdown) {
        // 弹出全屏倒计时遮罩，遮罩关闭时回调恢复调度
        this.reminders.startRest(task, () => this.setResting(false))
      } else {
        // 静默休息：不弹遮罩，后台计时，到点自动恢复调度
        this.startSilentRest(restMinutes)
        logger.info(`任务「${task.name}」进入静默休息（${restMinutes} 分钟，不弹倒计时层）`)
      }
    }
    // dismiss：无需处理，nextFireAt 已在触发时推进
  }

  /** 静默休息：后台计时，到点自动结束休息 */
  private startSilentRest(minutes: number): void {
    if (this.silentRestTimer) clearTimeout(this.silentRestTimer)
    this.silentRestTimer = setTimeout(() => {
      this.silentRestTimer = null
      this.setResting(false)
    }, minutes * MINUTE)
  }

  /** 提前结束休息（托盘 / 主窗口的「结束休息」） */
  endRest(): void {
    if (!this.resting) return
    // 若遮罩开着，一并关掉；遮罩关闭回调会再次调用 setResting(false)，幂等
    this.reminders.closeRest()
    this.setResting(false)
    logger.info('休息已手动结束')
  }

  /** 当前是否处于休息状态 */
  isResting(): boolean {
    return this.resting
  }

  /** 当前休息状态（供渲染层/托盘展示剩余时间） */
  getRestState(): RestState {
    // 遮罩模式下以遮罩的结束时间为准（含「+5 分钟」延长），静默模式用调度器自己的时间
    const endAt = this.reminders.getRestEndAt() || this.restEndAt
    return {
      resting: this.resting,
      remainMs: this.resting ? Math.max(0, endAt - Date.now()) : 0
    }
  }

  /** 休息遮罩生命周期：休息期间暂停其他任务触发，结束后立即检查暂缓的触发 */
  setResting(resting: boolean): void {
    this.resting = resting
    if (resting) {
      this.startRestStateBroadcast()
    } else {
      this.stopRestStateBroadcast()
      if (this.silentRestTimer) {
        clearTimeout(this.silentRestTimer)
        this.silentRestTimer = null
      }
      this.restEndAt = 0
      this.onRestState({ resting: false, remainMs: 0 })
    }
    if (!resting) {
      this.tick()
    }
  }

  /** 休息期间每秒广播剩余时间 */
  private startRestStateBroadcast(): void {
    this.stopRestStateBroadcast()
    this.onRestState(this.getRestState())
    this.restStateTimer = setInterval(() => {
      this.onRestState(this.getRestState())
    }, 1000)
  }

  private stopRestStateBroadcast(): void {
    if (this.restStateTimer) {
      clearInterval(this.restStateTimer)
      this.restStateTimer = null
    }
  }

  private get dnd(): boolean {
    return this.store.getConfig().settings.doNotDisturb
  }

  /**
   * 排下一次 tick：先清理已存在的定时器再设置，保证任意路径重复调用都安全
   * （幂等重排，不会出现双 timer 泄漏）。
   */
  private scheduleTick(): void {
    if (!this.running) return
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const delay = this.delayUntilNext()
    this.timer = setTimeout(() => {
      this.timer = null
      this.tick()
    }, delay)
  }

  /** 睡到最近的触发点；存在已过期触发点时立即补 tick；无任务时兜底 IDLE_TICK */
  private delayUntilNext(): number {
    // 抑制期间无需精确排眠，60s 兜底即可；恢复时由 recomputeAll 重排实现及时补触发
    if (this.dnd || this.resting || this.reminders.isResting()) return IDLE_TICK
    const now = Date.now()
    let min = IDLE_TICK
    let hasDue = false
    for (const task of this.store.getConfig().tasks) {
      if (!task.enabled) continue
      const next = this.store.getNextFireAt(task.id)
      if (next === undefined) continue
      if (next <= now) {
        hasDue = true
        break
      }
      min = Math.min(min, next - now)
    }
    return hasDue ? 200 : Math.max(min, 200)
  }

  private tick(): void {
    try {
      const now = Date.now()
      const suppressed = this.dnd || this.resting || this.reminders.isResting()
      if (!suppressed) {
        let fired = false
        for (const task of this.store.getConfig().tasks) {
          if (!task.enabled) continue
          const next = this.store.getNextFireAt(task.id)
          if (next === undefined || next > now) continue
          this.fire(task)
          fired = true
        }
        if (fired) this.store.saveStateNow()
      }
    } catch (err) {
      logger.error('调度 tick 异常', err)
    } finally {
      this.scheduleTick()
    }
  }

  private fire(task: Task): void {
    logger.info(`触发提醒：${task.name}（${task.message}）`)
    const next = advanceNextFireAt(task, Date.now())
    this.store.setNextFireAt(task.id, next)
    this.reminders.showReminder(task)
  }
}
