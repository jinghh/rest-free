import { app, BrowserWindow, shell } from 'electron'
import { ConfigStore } from './configStore'
import { Scheduler } from './scheduler'
import { ReminderManager } from './reminderWindows'
import { registerIpc } from './ipc'
import { createTray, type TrayApi } from './tray'
import { applyAutoStart } from './autostart'
import { logger } from './logger'
import { loadRenderer, resourcePath, sharedWebPreferences } from './utils'

let mainWindow: BrowserWindow | null = null
let forceQuit = false

let store: ConfigStore
let scheduler: Scheduler
let reminders: ReminderManager
/** registerIpc 返回的调度快照广播句柄 */
let broadcastSchedule: (() => void) | null = null
/** 托盘句柄：休息状态变化时重建菜单/提示 */
let trayApi: TrayApi | null = null

// 单实例：重复启动时聚焦已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  void app.whenReady().then(bootstrap)
}

function bootstrap(): void {
  logger.init()
  logger.info(`Rest-Free 启动 v${app.getVersion()}`)

  store = new ConfigStore()
  applyAutoStart(store.getConfig().settings.launchAtStartup)

  reminders = new ReminderManager(store)
  scheduler = new Scheduler(store, reminders, (state) => {
    // 休息状态推送给主窗口（静默休息时展示剩余时间）
    const win = mainWindow
    if (win && !win.isDestroyed()) win.webContents.send('rest:state', state)
    trayApi?.rebuild()
  })

  mainWindow = createMainWindow()

  broadcastSchedule = registerIpc({
    store,
    scheduler,
    reminders,
    getMainWindow: () => mainWindow,
    openUserData: () => {
      void shell.openPath(app.getPath('userData'))
    }
  }).broadcastSchedule

  // 托盘实例随应用生命周期常驻
  trayApi = createTray(
    store,
    () => showMainWindow(),
    () => {
      forceQuit = true
      app.quit()
    },
    () => scheduler.getRestState(),
    () => scheduler.endRest()
  )

  scheduler.start()

  app.on('activate', () => showMainWindow())
  // 托盘常驻：关闭所有窗口不退出
  app.on('window-all-closed', () => undefined)
  app.on('before-quit', () => {
    forceQuit = true
    scheduler.stop()
    store.flushAll()
    reminders.dispose()
  })

  logger.info('初始化完成')
}

function showMainWindow(): void {
  if (!mainWindow) {
    mainWindow = createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  // 窗口长时间隐藏期间调度仍在推进，重新显示时补一次快照，避免「下次提醒」显示旧时间
  broadcastSchedule?.()
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 800,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: '#f4f6fb',
    icon: resourcePath('icon.png'),
    webPreferences: sharedWebPreferences()
  })

  win.once('ready-to-show', () => win.show())
  win.on('close', (e) => {
    // 未确认退出时，关闭按钮 = 隐藏到托盘
    if (!forceQuit) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  loadRenderer(win, 'index.html')
  return win
}
