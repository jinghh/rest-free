import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ReminderData, RestData, RestState, UpdateState } from '../shared/api'
import type { AppConfig, ReminderAction, RestAction, Settings, TaskDraft } from '../shared/types'

/** 订阅主进程频道，返回取消订阅函数 */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: Api = {
  // 配置
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveTask: (draft: TaskDraft) => ipcRenderer.invoke('task:save', draft),
  deleteTask: (id: string) => ipcRenderer.invoke('task:delete', id),
  updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:update', patch),
  getPaths: () => ipcRenderer.invoke('app:paths'),
  openUserData: () => ipcRenderer.invoke('app:openUserData'),
  onConfigChanged: (cb) => subscribe<AppConfig>('config:changed', cb),

  // 调度快照
  getScheduleSnapshot: () => ipcRenderer.invoke('schedule:snapshot'),
  onScheduleChanged: (cb) => subscribe<Record<string, number>>('schedule:changed', cb),

  // 主窗口控制
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  // 提醒窗口
  onReminderData: (cb) => subscribe<ReminderData>('reminder:data', cb),
  reminderAction: (taskId: string, action: ReminderAction) => ipcRenderer.send('reminder:action', { taskId, action }),
  reminderResize: (height: number) => ipcRenderer.send('reminder:resize', height),

  // 休息窗口
  onRestData: (cb) => subscribe<RestData>('rest:data', cb),
  onRestTick: (cb) => subscribe<number>('rest:tick', cb),
  restAction: (action: RestAction) => ipcRenderer.send('rest:action', { action }),
  onRestState: (cb) => subscribe<RestState>('rest:state', cb),
  restEnd: () => ipcRenderer.send('rest:end'),

  // 自动更新
  getUpdateState: () => ipcRenderer.invoke('update:get'),
  onUpdateState: (cb) => subscribe<UpdateState>('update:state', cb),
  updateCheck: (auto = false) => ipcRenderer.invoke('update:check', auto),
  updateDownload: () => ipcRenderer.send('update:download'),
  updateInstall: () => ipcRenderer.send('update:install')
}

contextBridge.exposeInMainWorld('api', api)
