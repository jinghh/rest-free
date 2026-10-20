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
}
