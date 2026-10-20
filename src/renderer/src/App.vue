<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useAppStore } from './store'
import TitleBar from './components/TitleBar.vue'
import TaskCard from './components/TaskCard.vue'
import TaskFormDialog from './components/TaskFormDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import { formatNextFireAt } from './format'
import { isDefaultTaskId, type Task, type TaskDraft } from '@shared/types'

const store = useAppStore()

const formVisible = ref(false)
const editing = ref<Task | null>(null)
const settingsVisible = ref(false)
let unsubscribe: (() => void) | null = null

onMounted(async () => {
  await store.load()
  // 主进程广播驱动，单一数据源；卸载时退订避免泄漏
  unsubscribe = window.api.onConfigChanged((config) => {
    store.applyBroadcast(config)
    void store.refreshSchedule()
  })
})

onUnmounted(() => {
  unsubscribe?.()
  unsubscribe = null
})

function openCreate(): void {
  editing.value = null
  formVisible.value = true
}

function openEdit(task: Task): void {
  editing.value = task
  formVisible.value = true
}

async function onSave(draft: TaskDraft): Promise<void> {
  await store.saveTask(draft)
}

async function onToggle(task: Task): Promise<void> {
  // 只传业务字段，id/时间戳由主进程维护
  const { id, name, startTime, intervalMinutes, message, position, enabled } = task
  await store.saveTask({ id, name, startTime, intervalMinutes, message, position, enabled: !enabled })
}

async function onDelete(task: Task): Promise<void> {
  // 删除默认任务需明确告知后果：版本更新时不会再自动添加
  const tip = isDefaultTaskId(task.id)
    ? `「${task.name}」是内置默认规则。删除后版本更新不会再自动添加，确定删除吗？`
    : `确定删除任务「${task.name}」吗？`
  if (!window.confirm(tip)) return
  await store.deleteTask(task.id)
}

async function onToggleDnd(): Promise<void> {
  await store.updateSettings({ doNotDisturb: !store.dnd })
}

function nextText(ts: number | undefined): string {
  return formatNextFireAt(ts)
}
</script>

<template>
  <div class="app">
    <TitleBar :dnd="store.dnd" @toggle-dnd="onToggleDnd" @open-settings="settingsVisible = true" />

    <main class="content">
      <header class="content-head">
        <div class="head-text">
          <h1>休息提醒</h1>
          <p class="subtitle">已启用 {{ store.enabledCount }} / {{ store.tasks.length }} 个任务 · 按时放松，别久坐</p>
        </div>
        <button class="btn primary" type="button" @click="openCreate">＋ 新建任务</button>
      </header>

      <div v-if="store.tasks.length" class="task-grid">
        <TaskCard
          v-for="task in store.tasks"
          :key="task.id"
          :task="task"
          :next-text="nextText(store.schedule[task.id])"
          @edit="openEdit"
          @toggle="onToggle"
          @delete="onDelete"
        />
      </div>

      <div v-else class="empty">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <path d="M4 8h11a3 3 0 0 1 0 6h-1" />
            <path d="M4 8v5a5 5 0 0 0 10 0v-1" />
            <path d="M17 10h3v4a3 3 0 0 1-3 3" />
          </svg>
        </div>
        <h2>还没有提醒任务</h2>
        <p>创建第一个任务，Rest-Free 会按时提醒你起身活动</p>
        <button class="btn primary" type="button" @click="openCreate">创建任务</button>
      </div>
    </main>

    <TaskFormDialog v-model:visible="formVisible" :task="editing" @save="onSave" />
    <SettingsDialog v-model:visible="settingsVisible" />
  </div>
</template>
