import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { DEFAULT_SETTINGS, DEFAULTS_VERSION, type AppConfig, type Settings, type TaskDraft } from '@shared/types'

/**
 * 全局状态：配置 + 调度快照。
 * 主进程是配置唯一写入口，渲染层通过 IPC 变更后由主进程广播回最新配置，
 * 避免渲染层多来源写入导致的竞态。
 */
export const useAppStore = defineStore('app', () => {
  const config = ref<AppConfig>({
    version: 1,
    defaultsVersion: DEFAULTS_VERSION,
    tasks: [],
    settings: { ...DEFAULT_SETTINGS },
    removedDefaults: []
  })
  const ready = ref(false)
  const schedule = ref<Record<string, number>>({})

  async function load(): Promise<void> {
    const [cfg, snap] = await Promise.all([window.api.getConfig(), window.api.getScheduleSnapshot()])
    config.value = cfg
    schedule.value = snap
    ready.value = true
  }

  async function refreshSchedule(): Promise<void> {
    schedule.value = await window.api.getScheduleSnapshot()
  }

  async function saveTask(draft: TaskDraft): Promise<void> {
    config.value = await window.api.saveTask(draft)
    await refreshSchedule()
  }

  async function deleteTask(id: string): Promise<void> {
    config.value = await window.api.deleteTask(id)
    await refreshSchedule()
  }

  async function updateSettings(patch: Partial<Settings>): Promise<void> {
    const settings = await window.api.updateSettings(patch)
    config.value = { ...config.value, settings }
  }

  const tasks = computed(() => [...config.value.tasks].sort((a, b) => a.createdAt - b.createdAt))
  const enabledCount = computed(() => config.value.tasks.filter((t) => t.enabled).length)
  const dnd = computed(() => config.value.settings.doNotDisturb)

  /** 主进程广播回调：整体替换，保证单一数据源 */
  function applyBroadcast(next: AppConfig): void {
    config.value = next
  }

  return {
    config,
    ready,
    schedule,
    tasks,
    enabledCount,
    dnd,
    load,
    refreshSchedule,
    saveTask,
    deleteTask,
    updateSettings,
    applyBroadcast
  }
})
