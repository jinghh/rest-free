import { BrowserWindow, screen } from 'electron'
import type { ReminderPosition, RestAction, Task } from '../shared/types'
import type { ConfigStore } from './configStore'
import { logger } from './logger'
import { sharedWebPreferences, loadRenderer } from './utils'

const MINUTE = 60_000
const EXTEND_MS = 5 * MINUTE
const MARGIN = 16

const REMINDER_WIDTH: Record<ReminderPosition, number> = {
  top: 520,
  center: 560,
  'bottom-right': 480
}

/** 提醒窗口高度范围（渲染层按内容测量后上报，这里二次钳制兜底） */
const MIN_REMINDER_HEIGHT = 44
const MAX_REMINDER_HEIGHT = 220
/** 渲染层未上报高度前的初始高度 */
const INITIAL_REMINDER_HEIGHT = 72
/** ready-to-show 后等待首次高度上报的兜底时长 */
const SHOW_FALLBACK_MS = 250

/** 单个提醒窗口的运行时状态 */
interface ReminderEntry {
  win: BrowserWindow
  task: Task
  height: number
  showTimer: NodeJS.Timeout | null
}

/** 提醒窗口载荷 */
export interface ReminderPayload {
  task: Task
  snoozeMinutes: number
  soundEnabled: boolean
}

/** 休息窗口载荷 */
export interface RestPayload {
  task: Task
  endAt: number
}

/**
 * 提醒窗口 + 休息遮罩窗口管理：
 * - 提醒窗口：无边框/透明/置顶/不占任务栏，按任务位置定位到鼠标所在屏幕
 * - 休息遮罩：全屏半透明，倒计时由主进程每秒驱动，渲染层只负责显示
 */
export class ReminderManager {
  private reminders = new Map<string, ReminderEntry>()
  private restWindow: BrowserWindow | null = null
  private restTimer: NodeJS.Timeout | null = null
  private restEndAt = 0
  private restOnDone: (() => void) | null = null

  constructor(private readonly store: ConfigStore) {}

  isResting(): boolean {
    return this.restWindow !== null && !this.restWindow.isDestroyed()
  }

  // ---------- 提醒窗口 ----------

  showReminder(task: Task): void {
    const existing = this.reminders.get(task.id)
    if (existing && !existing.win.isDestroyed()) {
      // 去重：同一任务的提醒已存在时聚焦已有窗口
      const win = existing.win
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      return
    }

    const width = REMINDER_WIDTH[task.position]
    const display = this.activeDisplay()
    const { x, y } = this.reminderBounds(display, task.position, {
      width,
      height: INITIAL_REMINDER_HEIGHT
    })
    logger.info(
      `reminder[${task.position}] cursor=${JSON.stringify(screen.getCursorScreenPoint())} ` +
        `display.bounds=${JSON.stringify(display.bounds)} display.workArea=${JSON.stringify(display.workArea)} ` +
        `scaleFactor=${display.scaleFactor} target={x:${x},y:${y},w:${width},h:${INITIAL_REMINDER_HEIGHT}}`
    )
    const win = new BrowserWindow({
      width,
      height: INITIAL_REMINDER_HEIGHT,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      maximizable: false,
      minimizable: false,
      focusable: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: sharedWebPreferences()
    })
    const entry: ReminderEntry = {
      win,
      task,
      height: INITIAL_REMINDER_HEIGHT,
      showTimer: null
    }
    this.reminders.set(task.id, entry)

    win.once('ready-to-show', () => {
      // 等渲染层上报真实高度再显示，避免「先空卡后跳动」；超时则兜底显示
      entry.showTimer = setTimeout(() => this.showEntry(entry), SHOW_FALLBACK_MS)
    })
    win.webContents.once('did-finish-load', () => {
      const config = this.store.getConfig()
      const payload: ReminderPayload = {
        task,
        snoozeMinutes: config.settings.snoozeMinutes,
        soundEnabled: config.settings.soundEnabled
      }
      win.webContents.send('reminder:data', payload)
    })
    win.on('closed', () => {
      if (entry.showTimer) {
        clearTimeout(entry.showTimer)
        entry.showTimer = null
      }
      this.reminders.delete(task.id)
    })

    loadRenderer(win, 'reminder.html')
  }

  /**
   * 渲染层上报内容高度：钳制后重算位置并 setBounds，随后显示窗口。
   * 幂等：高度未变化时只做「确保已显示」。
   */
  resizeReminder(win: BrowserWindow, height: number): void {
    const entry = this.findEntry(win)
    if (!entry) return

    const next = Math.min(MAX_REMINDER_HEIGHT, Math.max(MIN_REMINDER_HEIGHT, Math.round(height)))
    if (next !== entry.height) {
      entry.height = next
      const width = REMINDER_WIDTH[entry.task.position]
      const { x, y } = this.reminderBounds(this.activeDisplay(), entry.task.position, {
        width,
        height: next
      })
      if (!win.isDestroyed()) win.setBounds({ x, y, width, height: next })
    }
    this.showEntry(entry)
  }

  closeReminder(taskId: string): void {
    const entry = this.reminders.get(taskId)
    if (!entry) return
    this.reminders.delete(taskId)
    if (entry.showTimer) {
      clearTimeout(entry.showTimer)
      entry.showTimer = null
    }
    if (!entry.win.isDestroyed()) entry.win.close()
  }

  // ---------- 休息遮罩 ----------

  startRest(task: Task, onDone: () => void): void {
    // 异常兜底：已在休息中则先结束上一次（其 onDone 会被跳过，由本次 onDone 负责恢复调度）
    if (this.isResting()) this.finishRest('replaced')

    this.restOnDone = onDone
    this.restEndAt = Date.now() + this.store.getConfig().settings.restMinutes * MINUTE

    const b = this.activeDisplay().bounds
    const win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: sharedWebPreferences()
    })
    this.restWindow = win

    win.once('ready-to-show', () => win.show())
    win.webContents.once('did-finish-load', () => {
      const payload: RestPayload = { task, endAt: this.restEndAt }
      win.webContents.send('rest:data', payload)
      this.restTimer = setInterval(() => this.restTick(win), 1000)
    })
    win.on('closed', () => {
      if (this.restTimer) {
        clearInterval(this.restTimer)
        this.restTimer = null
      }
      // 只处理「当前」休息窗口的回调，避免 replaced 场景旧回调把新休息的暂停态错误解除
      if (this.restWindow === win) {
        this.restWindow = null
        const cb = this.restOnDone
        this.restOnDone = null
        cb?.()
      }
    })

    loadRenderer(win, 'rest.html')
  }

  /** 渲染层休息动作：done = 结束，extend = 延长 5 分钟 */
  handleRestAction(action: RestAction): void {
    if (action === 'extend') {
      this.restEndAt += EXTEND_MS
      const remain = this.restEndAt - Date.now()
      const win = this.restWindow
      if (win && !win.isDestroyed()) win.webContents.send('rest:tick', remain)
      return
    }
    this.finishRest('user')
  }

  /** 释放全部窗口与定时器（应用退出前调用） */
  dispose(): void {
    if (this.restTimer) {
      clearInterval(this.restTimer)
      this.restTimer = null
    }
    for (const taskId of [...this.reminders.keys()]) {
      this.closeReminder(taskId)
    }
    const rest = this.restWindow
    this.restWindow = null
    this.restOnDone = null
    if (rest && !rest.isDestroyed()) rest.close()
  }

  // ---------- 内部 ----------

  /** 按窗口实例反查提醒条目（提醒窗口数量很少，线性查找足够） */
  private findEntry(win: BrowserWindow): ReminderEntry | undefined {
    for (const entry of this.reminders.values()) {
      if (entry.win === win) return entry
    }
    return undefined
  }

  /** 幂等显示：清掉兜底定时器，窗口未显示时 show */
  private showEntry(entry: ReminderEntry): void {
    if (entry.showTimer) {
      clearTimeout(entry.showTimer)
      entry.showTimer = null
    }
    if (entry.win.isDestroyed()) return
    if (!entry.win.isVisible()) entry.win.show()
  }

  private restTick(win: BrowserWindow): void {
    if (win.isDestroyed()) return
    const remain = this.restEndAt - Date.now()
    if (remain <= 0) {
      this.finishRest('timeout')
      return
    }
    win.webContents.send('rest:tick', remain)
  }

  private finishRest(reason: string): void {
    const win = this.restWindow
    if (!win || win.isDestroyed()) return
    logger.info(`休息结束（${reason}）`)
    win.close()
  }

  /** 鼠标当前所在显示器，取不到时回退主屏 */
  private activeDisplay(): Electron.Display {
    try {
      return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    } catch {
      return screen.getPrimaryDisplay()
    }
  }

  /** 基于工作区（避开任务栏）计算提醒窗口位置 */
  private reminderBounds(
    display: Electron.Display,
    position: ReminderPosition,
    size: { width: number; height: number }
  ): { x: number; y: number } {
    const wa = display.workArea
    switch (position) {
      case 'top':
        return { x: wa.x + Math.round((wa.width - size.width) / 2), y: wa.y + 8 }
      case 'center':
        return {
          x: wa.x + Math.round((wa.width - size.width) / 2),
          y: wa.y + Math.round((wa.height - size.height) / 2)
        }
      case 'bottom-right':
        return {
          x: wa.x + wa.width - size.width - MARGIN,
          y: wa.y + wa.height - size.height - MARGIN
        }
    }
  }
}
