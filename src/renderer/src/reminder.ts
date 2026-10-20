import './reminder.css'

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector(selector) as T

/** 窗口高度上下限（与主进程保持一致，主进程还会二次钳制） */
const MIN_HEIGHT = 44
const MAX_HEIGHT = 220
/** body 底部内边距：把阴影留白算进窗口高度（顶部由系统 inset 占位） */
const BOTTOM_PADDING = 16

let taskId = ''

// Windows 透明窗口 + transform 动画存在合成层提交 bug：动画结束后卡片背景可能整体丢失
// （文字还在、白底消失）。动画结束后显式清理动画属性，让图层回到 normal flow 重绘。
const card = $('#card')
card.addEventListener(
  'animationend',
  () => {
    card.style.animation = 'none'
    reportHeight()
  },
  { once: true }
)

window.api.onReminderData(({ task, snoozeMinutes, soundEnabled }) => {
  taskId = task.id
  const fullText = task.message ? `${task.name}：${task.message}` : task.name
  const text = $('#task-text')
  $('#task-name').textContent = task.name
  $('#task-message').textContent = task.message ? `：${task.message}` : ''
  // 单行省略后可能截断，完整文案通过 title 提示
  text.title = fullText
  const snooze = $('#btn-snooze')
  snooze.textContent = `晚 ${snoozeMinutes} 分钟`
  snooze.title = `稍后休息 ${snoozeMinutes} 分钟`
  document.body.dataset.position = task.position
  // 等一帧再量高：此时文本已完成布局，量到的才是最终高度
  requestAnimationFrame(reportHeight)
  // 字体加载完成后行高可能变化，再量一次
  void document.fonts?.ready.then(reportHeight)
  if (soundEnabled) playBeep()
})

$('#btn-rest').addEventListener('click', () => window.api.reminderAction(taskId, 'rest'))
$('#btn-snooze').addEventListener('click', () => window.api.reminderAction(taskId, 'snooze'))
$('#btn-dismiss').addEventListener('click', () => window.api.reminderAction(taskId, 'dismiss'))

/** 上报内容高度，由主进程调整窗口 bounds（center 位置会重新居中） */
function reportHeight(): void {
  const height = Math.ceil(card.getBoundingClientRect().height) + BOTTOM_PADDING
  window.api.reminderResize(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)))
}

/** 轻柔提示音：WebAudio 合成，无需音频文件；失败时静默 */
function playBeep(): void {
  try {
    const ctx = new AudioContext()
    void ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.5)
    osc.onended = () => void ctx.close()
  } catch {
    // 忽略音频播放失败
  }
}
