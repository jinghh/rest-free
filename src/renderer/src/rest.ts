import './rest.css'
import { formatCountdown } from './format'

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector(selector) as T

window.api.onRestData(({ task, endAt }) => {
  $('#rest-message').textContent = task.message
  updateCountdown(endAt - Date.now())
})

// 倒计时由主进程每秒驱动，睡眠唤醒后自动校正
window.api.onRestTick((remainMs) => {
  updateCountdown(remainMs)
})

$('#btn-done').addEventListener('click', () => window.api.restAction('done'))
$('#btn-extend').addEventListener('click', () => window.api.restAction('extend'))

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.restAction('done')
})

function updateCountdown(remainMs: number): void {
  $('#countdown').textContent = formatCountdown(remainMs)
}
