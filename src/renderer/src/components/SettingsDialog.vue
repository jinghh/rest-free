<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAppStore } from '../store'
import type { AppPaths, UpdateState } from '@shared/api'
import type { Settings } from '@shared/types'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [boolean] }>()

const store = useAppStore()
const paths = ref<AppPaths | null>(null)

// 模板中直接使用 window 会被编译为 _ctx.window 导致类型报错，此处显式解构
const api = window.api

onMounted(async () => {
  paths.value = await window.api.getPaths()
})

const settings = computed(() => store.config.settings)

function close(): void {
  emit('update:visible', false)
}

/** 受控提交：主进程是唯一写入口，输入合法才落盘 */
function commitNumber(value: string, key: 'snoozeMinutes' | 'restMinutes'): void {
  if (value.trim() === '') return // 清空输入时不落盘，保持原值
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return
  const clamped = Math.min(60, Math.max(1, n))
  void store.updateSettings({ [key]: clamped } satisfies Partial<Settings>)
}

function commitBoolean(key: keyof Settings, checked: boolean): void {
  void store.updateSettings({ [key]: checked } satisfies Partial<Settings>)
}

// ---------- 自动更新 ----------

const update = computed<UpdateState>(() => store.updateState)
const checking = computed(() => update.value.status === 'checking')

/** 更新状态提示文案 */
const updateHint = computed(() => {
  const s = update.value
  if (s.unsupported) return '开发模式不支持自动更新（仅安装版可用）'
  switch (s.status) {
    case 'checking':
      return '正在检查更新…'
    case 'available':
      return `发现新版本 v${s.version}，点击「下载更新」后自动安装`
    case 'downloading':
      return `正在下载 v${s.version ?? ''}…${s.percent ?? 0}%`
    case 'ready':
      return `v${s.version} 已下载完成，重启后安装`
    case 'not-available':
      return '已是最新版本'
    case 'error':
      return `检查失败：${s.message ?? '未知错误'}`
    default:
      return '启动后会自动检查更新，也可手动检查'
  }
})

function checkUpdate(): void {
  void window.api.updateCheck()
}

function downloadUpdate(): void {
  window.api.updateDownload()
}

function installUpdate(): void {
  window.api.updateInstall()
}
</script>

<template>
  <transition name="modal-fade">
    <div v-if="visible" class="modal-mask" @click.self="close">
      <div class="modal" role="dialog" aria-modal="true" aria-label="设置">
        <header class="modal-head">
          <h2>设置</h2>
          <button class="icon-btn" type="button" title="关闭" @click="close">✕</button>
        </header>

        <div class="modal-body">
          <div class="field-row">
            <label class="field">
              <span class="field-label">稍后休息时长（分钟）</span>
              <input
                type="number"
                min="1"
                max="60"
                :value="settings.snoozeMinutes"
                @change="commitNumber(($event.target as HTMLInputElement).value, 'snoozeMinutes')"
              />
            </label>
            <label class="field">
              <span class="field-label">休息倒计时（分钟）</span>
              <input
                type="number"
                min="1"
                max="60"
                :value="settings.restMinutes"
                @change="commitNumber(($event.target as HTMLInputElement).value, 'restMinutes')"
              />
            </label>
          </div>

          <label class="field switch-row">
            <span class="field-label">
              开机自动启动
              <small>随系统登录自动运行并驻留托盘</small>
            </span>
            <span class="switch">
              <input
                type="checkbox"
                :checked="settings.launchAtStartup"
                @change="commitBoolean('launchAtStartup', ($event.target as HTMLInputElement).checked)"
              />
              <span class="slider" />
            </span>
          </label>

          <label class="field switch-row">
            <span class="field-label">
              提醒提示音
              <small>弹出提醒时播放轻柔提示音</small>
            </span>
            <span class="switch">
              <input
                type="checkbox"
                :checked="settings.soundEnabled"
                @change="commitBoolean('soundEnabled', ($event.target as HTMLInputElement).checked)"
              />
              <span class="slider" />
            </span>
          </label>

          <label class="field switch-row">
            <span class="field-label">
              勿扰模式
              <small>开启期间不弹出提醒，关闭后自动补提醒</small>
            </span>
            <span class="switch">
              <input
                type="checkbox"
                :checked="settings.doNotDisturb"
                @change="commitBoolean('doNotDisturb', ($event.target as HTMLInputElement).checked)"
              />
              <span class="slider" />
            </span>
          </label>

          <label class="field switch-row">
            <span class="field-label">
              全屏休息倒计时
              <small>点「立即休息」后弹出全屏倒计时；关闭则静默休息，仅托盘显示剩余时间</small>
            </span>
            <span class="switch">
              <input
                type="checkbox"
                :checked="settings.showRestCountdown"
                @change="commitBoolean('showRestCountdown', ($event.target as HTMLInputElement).checked)"
              />
              <span class="slider" />
            </span>
          </label>

          <div class="field">
            <span class="field-label">版本与更新</span>
            <div class="path-row">
              <code>v{{ update.currentVersion || '—' }}</code>
              <button
                v-if="update.status === 'available'"
                class="btn text"
                type="button"
                @click="downloadUpdate"
              >
                下载更新
              </button>
              <button v-else-if="update.status === 'ready'" class="btn text" type="button" @click="installUpdate">
                重启并安装
              </button>
              <button v-else class="btn text" type="button" :disabled="checking" @click="checkUpdate">
                {{ checking ? '检查中…' : '检查更新' }}
              </button>
            </div>
            <small class="field-hint">{{ updateHint }}</small>
          </div>

          <div class="field">
            <span class="field-label">配置文件</span>
            <div class="path-row">
              <code :title="paths?.configFile ?? ''">{{ paths?.configFile ?? '加载中…' }}</code>
              <button class="btn text" type="button" @click="api.openUserData()">打开目录</button>
            </div>
            <small class="field-hint">配置保存在用户数据目录，应用升级不会丢失</small>
          </div>
        </div>

        <footer class="modal-foot">
          <button class="btn primary" type="button" @click="close">完成</button>
        </footer>
      </div>
    </div>
  </transition>
</template>
