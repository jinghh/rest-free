import { app, ipcMain, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { ReminderAction, RestAction, Settings, TaskDraft } from '../shared/types'
import type { ConfigStore } from './configStore'
import type { Scheduler } from './scheduler'
import type { ReminderManager } from './reminderWindows'
import { applyAutoStart } from './autostart'
import { logger } from './logger'

/**
 * 渲染层 ↔ 主进程通道。
 * 所有配置变更的唯一写入口都在这里：先落盘 → 广播 → 调度器重算。
 * 返回广播句柄，供主窗口重新显示时补一次调度快照刷新。
 */
export function registerIpc(deps: {
  store: ConfigStore
  scheduler: Scheduler
  reminders: ReminderManager
  getMainWindow: () => BrowserWindow | null
  openUserData: () => void
}): { broadcastSchedule: () => void } {
  const { store, scheduler, reminders, getMainWindow, openUserData } = deps

  /** 把最新调度快照（下次提醒时间）推给主窗口 */
  const broadcastSchedule = (): void => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    const snapshot = scheduler.getSnapshot()
    win.webContents.send('schedule:changed', snapshot)
    logger.info(`调度快照已推送到主窗口（${Object.keys(snapshot).length} 个任务）`)
  }

  ipcMain.handle('config:get', () => store.getConfig())

  ipcMain.handle('task:save', (_e, draft: TaskDraft) => {
    const config = store.upsertTask(draft)
    // 停用任务时关闭其可能已弹出的提醒窗口，避免窗口与配置不一致
    if (draft.id && draft.enabled === false) {
      reminders.closeReminder(draft.id)
    }
    scheduler.recomputeAll()
    return config
  })

  ipcMain.handle('task:delete', (_e, id: string) => {
    const config = store.deleteTask(id)
    scheduler.recomputeAll()
    return config
  })

  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>) => {
    const settings = store.updateSettings(patch)
    if (patch.launchAtStartup !== undefined) {
      applyAutoStart(settings.launchAtStartup)
    }
    // 勿扰开关等变化会影响排眠策略，重排定时器保证关闭勿扰后及时补触发
    if (patch.doNotDisturb !== undefined) {
      scheduler.recomputeAll()
    }
    return settings
  })

  ipcMain.handle('app:openUserData', () => openUserData())

  ipcMain.handle('app:paths', () => ({
    userData: app.getPath('userData'),
    configFile: join(app.getPath('userData'), 'config.json')
  }))

  ipcMain.handle('schedule:snapshot', () => scheduler.getSnapshot())

  ipcMain.on('reminder:action', (_e, payload: { taskId: string; action: ReminderAction }) => {
    scheduler.handleReminderAction(payload.taskId, payload.action)
  })

  // 渲染层上报提醒内容高度：调整窗口尺寸（center 位置需重新居中）后立即显示
  ipcMain.on('reminder:resize', (e, height: unknown) => {
    if (typeof height !== 'number' || !Number.isFinite(height)) return
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) reminders.resizeReminder(win, height)
  })

  ipcMain.on('rest:action', (_e, payload: { action: RestAction }) => {
    reminders.handleRestAction(payload.action)
  })

  ipcMain.on('window:minimize', () => {
    getMainWindow()?.minimize()
  })

  ipcMain.on('window:close', () => {
    // 关闭 = 隐藏到托盘，不退出应用
    getMainWindow()?.hide()
  })

  // 配置变更广播给主窗口
  store.subscribe((config) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('config:changed', config)
    }
  })

  // 调度状态变化广播：触发提醒 / snooze / 删除任务后立即刷新「下次提醒」
  store.subscribeState(broadcastSchedule)

  return { broadcastSchedule }
}
