<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { POSITION_LABELS, type ReminderPosition, type Task, type TaskDraft } from '@shared/types'

const props = defineProps<{
  visible: boolean
  task: Task | null
}>()
const emit = defineEmits<{
  'update:visible': [boolean]
  save: [TaskDraft]
}>()

const QUICK_MESSAGES = ['起来伸展一下', '记得喝水', '去洗手间活动一下', '远眺 20 秒放松眼睛']
const QUICK_INTERVALS = [30, 45, 60, 90]
const POSITIONS: ReminderPosition[] = ['top', 'center', 'bottom-right']

interface Draft {
  id: string
  name: string
  startTime: string
  intervalMinutes: number
  message: string
  position: ReminderPosition
  enabled: boolean
}

function emptyDraft(): Draft {
  return {
    id: '',
    name: '',
    startTime: '10:00',
    intervalMinutes: 45,
    message: '',
    position: 'center',
    enabled: true
  }
}

const form = reactive<Draft>(emptyDraft())

// 每次打开时重置表单，保证「新建」干净、「编辑」回显
watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    if (props.task) {
      const { id, name, startTime, intervalMinutes, message, position, enabled } = props.task
      Object.assign(form, { id, name, startTime, intervalMinutes, message, position, enabled })
    } else {
      Object.assign(form, emptyDraft())
    }
  }
)

const nameError = computed(() => (form.name.trim() ? '' : '请输入任务名称'))
const messageError = computed(() => (form.message.trim() ? '' : '请输入提醒文案'))
const intervalError = computed(() => {
  const n = Number(form.intervalMinutes)
  if (!Number.isInteger(n) || n < 1 || n > 1440) return '间隔需为 1 ~ 1440 的整数（分钟）'
  return ''
})
const valid = computed(() => !nameError.value && !messageError.value && !intervalError.value)

function close(): void {
  emit('update:visible', false)
}

function submit(): void {
  if (!valid.value) return
  // 只提交业务字段：id 为空表示新建（主进程生成），时间戳由主进程维护
  emit('save', {
    id: form.id,
    name: form.name.trim(),
    startTime: form.startTime,
    intervalMinutes: Number(form.intervalMinutes),
    message: form.message.trim(),
    position: form.position,
    enabled: form.enabled
  })
  close()
}
</script>

<template>
  <transition name="modal-fade">
    <div v-if="visible" class="modal-mask" @click.self="close">
      <div class="modal" role="dialog" aria-modal="true" :aria-label="task ? '编辑任务' : '新建任务'">
        <header class="modal-head">
          <h2>{{ task ? '编辑任务' : '新建任务' }}</h2>
          <button class="icon-btn" type="button" title="关闭" @click="close">✕</button>
        </header>

        <div class="modal-body">
          <label class="field">
            <span class="field-label">任务名称</span>
            <input v-model="form.name" type="text" maxlength="30" placeholder="例如：伸展放松" />
            <span v-if="nameError" class="field-error">{{ nameError }}</span>
          </label>

          <div class="field-row">
            <label class="field">
              <span class="field-label">每日开始时间</span>
              <input v-model="form.startTime" type="time" />
            </label>
            <label class="field">
              <span class="field-label">提醒间隔（分钟）</span>
              <input v-model.number="form.intervalMinutes" type="number" min="1" max="1440" step="1" />
              <span v-if="intervalError" class="field-error">{{ intervalError }}</span>
            </label>
          </div>
          <div class="quick-row">
            <button
              v-for="q in QUICK_INTERVALS"
              :key="q"
              class="chip"
              :class="{ active: Number(form.intervalMinutes) === q }"
              type="button"
              @click="form.intervalMinutes = q"
            >
              {{ q }} 分钟
            </button>
          </div>

          <label class="field">
            <span class="field-label">提醒文案</span>
            <textarea v-model="form.message" rows="2" maxlength="60" placeholder="例如：坐太久了，起来伸展一下吧！" />
            <span v-if="messageError" class="field-error">{{ messageError }}</span>
          </label>
          <div class="quick-row">
            <button v-for="m in QUICK_MESSAGES" :key="m" class="chip" type="button" @click="form.message = m">
              {{ m }}
            </button>
          </div>

          <div class="field">
            <span class="field-label">提醒位置</span>
            <div class="position-grid">
              <button
                v-for="p in POSITIONS"
                :key="p"
                class="position-card"
                :class="{ active: form.position === p }"
                type="button"
                @click="form.position = p"
              >
                <span class="preview" :class="`preview-${p}`"><span class="preview-dot" /></span>
                <span class="position-name">{{ POSITION_LABELS[p] }}</span>
              </button>
            </div>
          </div>

          <label class="field switch-row">
            <span class="field-label">创建后立即启用</span>
            <span class="switch">
              <input v-model="form.enabled" type="checkbox" />
              <span class="slider" />
            </span>
          </label>
        </div>

        <footer class="modal-foot">
          <button class="btn secondary" type="button" @click="close">取消</button>
          <button class="btn primary" type="button" :disabled="!valid" @click="submit">
            {{ task ? '保存修改' : '创建任务' }}
          </button>
        </footer>
      </div>
    </div>
  </transition>
</template>
