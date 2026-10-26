import type { AppConfig, ReminderAction, RestAction, Settings, Task, TaskDraft } from './types'

/** 提醒窗口数据 */
export interface ReminderData {
  task: Task
  snoozeMinutes: number
  soundEnabled: boolean
}

/** 休息窗口数据 */
export interface RestData {
  task: Task
  endAt: number
}

/** 休息状态（静默休息时供主窗口/托盘展示） */
export interface RestState {
  /** 是否处于休息中 */
  resting: boolean
  /** 剩余毫秒（resting 为 false 时为 0） */
  remainMs: number
}

/** 自动更新状态 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'ready'
  | 'error'

/** 自动更新状态快照 */
export interface UpdateState {
  status: UpdateStatus
  /** 当前应用版本 */
  currentVersion: string
  /** 可更新到的版本（available / downloading / ready 时有值） */
  version?: string
  /** 下载进度 0~100 */
  percent?: number
  /** 错误信息 */
  message?: string
  /** 未打包（开发模式）时更新不可用 */
  unsupported?: boolean
}

/** 应用路径信息 */
export interface AppPaths {
  userData: string
  configFile: string
}

/** 渲染层可用 API（preload 通过 contextBridge 暴露） */
export interface Api {
  // 配置
  getConfig(): Promise<AppConfig>
  saveTask(draft: TaskDraft): Promise<AppConfig>
  deleteTask(id: string): Promise<AppConfig>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  getPaths(): Promise<AppPaths>
  onConfigChanged(cb: (config: AppConfig) => void): () => void
  /** 用系统文件管理器打开用户数据目录 */
  openUserData(): Promise<void>

  // 调度快照：taskId -> 下次触发时间戳
  getScheduleSnapshot(): Promise<Record<string, number>>
  /** 订阅调度快照更新（触发提醒/snooze 后主进程主动推送） */
  onScheduleChanged(cb: (snapshot: Record<string, number>) => void): () => void

  // 主窗口控制
  minimizeWindow(): void
  closeWindow(): void

  // 提醒窗口
  onReminderData(cb: (data: ReminderData) => void): () => void
  reminderAction(taskId: string, action: ReminderAction): void
  /** 上报提醒内容高度，主进程据此调整窗口尺寸/位置 */
  reminderResize(height: number): void

  // 休息窗口
  onRestData(cb: (data: RestData) => void): () => void
  onRestTick(cb: (remainMs: number) => void): () => void
  restAction(action: RestAction): void
  /** 休息状态推送（静默休息 / 全屏倒计时期间每秒更新） */
  onRestState(cb: (state: RestState) => void): () => void
  /** 提前结束休息 */
  restEnd(): void

  // 自动更新
  /** 获取当前更新状态（含应用版本） */
  getUpdateState(): Promise<UpdateState>
  /** 订阅更新状态变化 */
  onUpdateState(cb: (state: UpdateState) => void): () => void
  /** 手动检查更新（auto=false 时静默失败） */
  updateCheck(auto?: boolean): Promise<UpdateState>
  /** 开始下载新版本 */
  updateDownload(): void
  /** 退出并安装已下载的新版本 */
  updateInstall(): void
}
