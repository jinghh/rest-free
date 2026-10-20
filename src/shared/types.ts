/** 提醒位置：屏幕上方 / 正中间 / 右下角 */
export type ReminderPosition = 'top' | 'center' | 'bottom-right'

/** 提醒动作 */
export type ReminderAction = 'rest' | 'snooze' | 'dismiss'

/** 休息动作 */
export type RestAction = 'done' | 'extend'

/** 定时任务 */
export interface Task {
  id: string
  /** 任务名称，1~30 字 */
  name: string
  /** 每日首次触发时刻，HH:mm */
  startTime: string
  /** 提醒间隔（分钟），1~1440 */
  intervalMinutes: number
  /** 提醒文案，1~60 字 */
  message: string
  /** 提醒位置 */
  position: ReminderPosition
  /** 是否启用 */
  enabled: boolean
  createdAt: number
  updatedAt: number
  /** 默认任务被用户修改过：true 时版本升级不再覆盖该任务 */
  customized?: boolean
}

/** 全局设置 */
export interface Settings {
  /** 稍后休息的推迟时长（分钟） */
  snoozeMinutes: number
  /** 立即休息的倒计时时长（分钟） */
  restMinutes: number
  /** 开机自启 */
  launchAtStartup: boolean
  /** 提醒提示音 */
  soundEnabled: boolean
  /** 勿扰模式：开启期间不弹出提醒 */
  doNotDisturb: boolean
}

/** 应用配置（config.json 结构） */
export interface AppConfig {
  version: number
  /** 已同步到的默认配置版本：落后于 DEFAULTS_VERSION 时启动会合并默认任务 */
  defaultsVersion: number
  tasks: Task[]
  settings: Settings
  /** 用户显式删除过的默认任务 id：版本升级时不复活 */
  removedDefaults: string[]
}

/** 新建/编辑任务的输入：id 可选（新建时由主进程生成），时间戳由主进程维护 */
export type TaskDraft = Omit<Task, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }

/** 调度状态（state.json 结构） */
export interface SchedulerState {
  [taskId: string]: {
    /** 下次触发时间戳（ms） */
    nextFireAt: number
    /** 状态更新时间，用于判断任务是否被编辑过 */
    updatedAt: number
  }
}

export const CONFIG_VERSION = 1

export const DEFAULT_SETTINGS: Settings = {
  snoozeMinutes: 5,
  restMinutes: 5,
  launchAtStartup: false,
  soundEnabled: false,
  doNotDisturb: false
}

/** 提醒位置元信息（主进程与渲染层共用） */
export const POSITION_LABELS: Record<ReminderPosition, string> = {
  top: '屏幕上方',
  center: '屏幕正中间',
  'bottom-right': '右下角'
}

/**
 * 默认配置版本。
 * 升级此版本号即可让所有「未被用户改动」的默认任务在下次启动时更新为新模板；
 * 用户已改动（customized）或已删除（removedDefaults）的不受影响。
 */
export const DEFAULTS_VERSION = 1

/**
 * 内置默认任务：免配置开箱即用。
 * - id 固定，是「用户配置 vs 默认配置」合并的唯一依据，切勿更改已有 id
 * - createdAt / updatedAt 在写入用户配置时由主进程填充
 */
export const DEFAULT_TASKS: Task[] = [
  {
    id: 'default-stretch',
    name: '拉伸放松',
    startTime: '09:00',
    intervalMinutes: 15,
    message: '坐太久了，起来拉伸一下，放松身体！',
    position: 'top',
    enabled: true,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: 'default-water',
    name: '喝水 · 上厕所',
    startTime: '09:00',
    intervalMinutes: 45,
    message: '该喝水了，顺便去洗手间活动一下吧',
    position: 'center',
    enabled: true,
    createdAt: 0,
    updatedAt: 0
  }
]

/** 默认任务 id 集合 */
export const DEFAULT_TASK_IDS: ReadonlySet<string> = new Set(DEFAULT_TASKS.map((t) => t.id))

/** 是否为内置默认任务 */
export function isDefaultTaskId(id: string): boolean {
  return DEFAULT_TASK_IDS.has(id)
}
