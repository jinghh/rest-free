<script setup lang="ts">
import { computed } from 'vue'
import { POSITION_LABELS, isDefaultTaskId, type Task } from '@shared/types'

const props = defineProps<{
  task: Task
  nextText: string
}>()
const emit = defineEmits<{
  edit: [Task]
  toggle: [Task]
  delete: [Task]
}>()

const positionLabel = computed(() => POSITION_LABELS[props.task.position])
const positionClass = computed(() => `pos-${props.task.position}`)
const isDefault = computed(() => isDefaultTaskId(props.task.id))
</script>

<template>
  <article class="task-card" :class="{ disabled: !task.enabled }">
    <div class="task-card-head">
      <div class="task-title-row">
        <h3 :title="task.name">{{ task.name }}</h3>
        <span v-if="isDefault" class="badge badge-default" title="内置默认规则，版本更新时自动跟随">默认</span>
        <span class="badge" :class="task.enabled ? 'badge-on' : 'badge-off'">
          {{ task.enabled ? '运行中' : '已停用' }}
        </span>
      </div>
      <label class="switch" :title="task.enabled ? '点击停用' : '点击启用'">
        <input type="checkbox" :checked="task.enabled" @change="emit('toggle', task)" />
        <span class="slider" />
      </label>
    </div>

    <p class="task-message" :title="task.message">{{ task.message }}</p>

    <dl class="task-meta">
      <div class="meta-item">
        <dt>开始</dt>
        <dd>{{ task.startTime }}</dd>
      </div>
      <div class="meta-item">
        <dt>间隔</dt>
        <dd>每 {{ task.intervalMinutes }} 分钟</dd>
      </div>
      <div class="meta-item">
        <dt>位置</dt>
        <dd class="pos" :class="positionClass">
          <span class="pos-dot" />{{ positionLabel }}
        </dd>
      </div>
      <div class="meta-item">
        <dt>下次提醒</dt>
        <dd class="next">{{ nextText }}</dd>
      </div>
    </dl>

    <footer class="task-card-foot">
      <button class="btn text" type="button" @click="emit('edit', task)">编辑</button>
      <button class="btn text danger" type="button" @click="emit('delete', task)">删除</button>
    </footer>
  </article>
</template>
