<script setup lang="ts">
defineProps<{ dnd: boolean }>()
const emit = defineEmits<{
  'toggle-dnd': []
  'open-settings': []
}>()

// 模板中直接使用 window 会被编译为 _ctx.window 导致类型报错，此处显式解构
const api = window.api
</script>

<template>
  <header class="titlebar">
    <div class="brand">
      <svg class="logo" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="6" fill="#10b981" />
        <circle cx="12" cy="12" r="6.5" fill="none" stroke="#fff" stroke-width="1.8" />
        <path d="M12 8.5V12l2.6 1.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" />
      </svg>
      <span class="brand-name">Rest-Free</span>
      <span class="brand-sub">定时休息提醒</span>
    </div>
    <div class="titlebar-actions">
      <button class="chip" :class="{ active: dnd }" type="button" :title="dnd ? '关闭勿扰模式' : '开启勿扰模式，期间不弹提醒'" @click="emit('toggle-dnd')">
        <span class="dot" />
        {{ dnd ? '勿扰中' : '勿扰模式' }}
      </button>
      <button class="icon-btn" type="button" title="设置" @click="emit('open-settings')">⚙</button>
      <button class="icon-btn" type="button" title="最小化" @click="api.minimizeWindow()">－</button>
      <button class="icon-btn danger" type="button" title="关闭到托盘" @click="api.closeWindow()">✕</button>
    </div>
  </header>
</template>
