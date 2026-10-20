/** 将时间戳格式化为「今天/明天/M月d日 HH:mm」 */
export function formatNextFireAt(ts: number | undefined): string {
  if (!ts || !Number.isFinite(ts)) return '—'
  const d = new Date(ts)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dayDiff = Math.round((startOfDay(d.getTime()) - today.getTime()) / 86_400_000)
  if (dayDiff <= 0) return `今天 ${hhmm}`
  if (dayDiff === 1) return `明天 ${hhmm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 毫秒格式化为 mm:ss */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}
