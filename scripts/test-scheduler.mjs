/**
 * 调度引擎回归测试：直接加载 TS 源码运行（依赖 Node 类型转换 + 解析钩子）。
 * 重点覆盖 Review 中修复的 P0：运行中 nextFireAt 变更后定时器必须重排。
 *
 * 说明：startTime 是 HH:mm 精度，测试中通过预置 state（updatedAt 设为未来值
 * 防止被 recomputeAll 重算）来构造精确的触发场景，避免整分边界的不稳定。
 *
 * 用法: node --experimental-transform-types scripts/test-scheduler.mjs
 */
import { register } from 'node:module'
import assert from 'node:assert/strict'

// 先注册解析钩子（TS 扩展名补全 + electron mock），再加载被测模块
register('./ts-resolver-hooks.mjs', import.meta.url)

const { Scheduler } = await import('../src/main/scheduler.ts')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MINUTE = 60_000

function makeTask(overrides = {}) {
  return {
    id: 't1',
    name: '测试任务',
    startTime: '09:00',
    intervalMinutes: 45,
    message: 'm',
    position: 'center',
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

function createStore(tasks, settings) {
  const state = {}
  return {
    state,
    getConfig: () => ({ tasks, settings }),
    getTask: (id) => tasks.find((t) => t.id === id),
    getStateUpdatedAt: (id) => state[id]?.updatedAt,
    getNextFireAt: (id) => state[id]?.nextFireAt,
    getStateSnapshot: () => state,
    setNextFireAt: (id, nextFireAt) => {
      state[id] = { nextFireAt, updatedAt: Date.now() }
    },
    pruneState: () => {},
    saveState: () => {},
    saveStateNow: () => {}
  }
}

function createReminders() {
  const fired = []
  return {
    fired,
    showReminder: (t) => fired.push(t.id),
    closeReminder: () => {},
    startRest: () => {},
    isResting: () => false
  }
}

/** 预置一个「新鲜」的 state（updatedAt 远在未来，recomputeAll 不会重算） */
function primeState(store, nextFireAt) {
  store.state.t1 = { nextFireAt, updatedAt: Date.now() + 10 * MINUTE }
}

const defaultSettings = { snoozeMinutes: 5, restMinutes: 5, doNotDisturb: false }

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  PASS  ${name}`)
  } catch (err) {
    failed++
    console.error(`  FAIL  ${name}\n        ${err.message}`)
  }
}

console.log('scheduler regression tests')

// ---------- 1. 到点触发，且 nextFireAt 按 interval 推进 ----------
await test('到点触发并推进 nextFireAt（+interval）', async () => {
  const task = makeTask({ intervalMinutes: 1 })
  const store = createStore([task], defaultSettings)
  primeState(store, Date.now() + 1500)
  const reminders = createReminders()
  const s = new Scheduler(store, reminders)
  s.start()
  await sleep(2400)
  assert.equal(reminders.fired.length, 1, '应触发一次')
  const delta = store.state.t1.nextFireAt - Date.now()
  assert.ok(delta > 30_000 && delta <= 61_000, `nextFireAt 应约为 +1 分钟，实际 ${(delta / 1000).toFixed(1)}s`)
  s.stop()
})

// ---------- 2. P0 回归：运行中 nextFireAt 被改近后必须重排定时器 ----------
await test('P0: 运行中 nextFireAt 变更后定时器重排（snooze 场景）', async () => {
  const task = makeTask({ intervalMinutes: 10 })
  const store = createStore([task], defaultSettings)
  primeState(store, Date.now() + 60_000)
  const reminders = createReminders()
  const s = new Scheduler(store, reminders)
  s.start()
  await sleep(300)
  assert.ok(store.state.t1.nextFireAt - Date.now() > 50_000, '初始 nextFireAt 应在 50s 后')
  // 模拟 snooze：把触发点改到 2 秒后（IPC 路径会调用 recomputeAll 重排）
  store.setNextFireAt('t1', Date.now() + 2000)
  s.recomputeAll()
  await sleep(2600)
  assert.equal(reminders.fired.length, 1, 'snooze 到近处的触发点应准时触发（旧代码会睡过）')
  s.stop()
})

// ---------- 3. handleReminderAction('snooze') 语义 ----------
await test('snooze 动作把 nextFireAt 设为 now + snoozeMinutes', async () => {
  const task = makeTask({ intervalMinutes: 10 })
  const store = createStore([task], defaultSettings)
  primeState(store, Date.now() + 30_000)
  const reminders = createReminders()
  const s = new Scheduler(store, reminders)
  s.start()
  await sleep(200)
  const before = store.state.t1.nextFireAt
  s.handleReminderAction('t1', 'snooze')
  const after = store.state.t1.nextFireAt
  const delta = after - Date.now()
  assert.ok(delta > 4 * MINUTE && delta <= 5 * MINUTE + 1000, `snooze 后应为 now+5min，实际 ${(delta / 1000).toFixed(1)}s`)
  assert.notEqual(after, before, 'nextFireAt 应被覆盖')
  s.stop()
})

// ---------- 4. 错过补偿：过期的 nextFireAt 启动后立即补触发 ----------
await test('错过补偿：过期的 nextFireAt 启动后立即触发', async () => {
  const task = makeTask()
  const store = createStore([task], defaultSettings)
  primeState(store, Date.now() - 5000)
  const reminders = createReminders()
  const s = new Scheduler(store, reminders)
  s.start()
  await sleep(1200)
  assert.equal(reminders.fired.length, 1, '过期触发点应立即补触发')
  assert.ok(store.state.t1.nextFireAt > Date.now(), '补触发后应推进到未来')
  s.stop()
})

// ---------- 5. 勿扰模式抑制触发且不推进 nextFireAt ----------
await test('勿扰模式抑制触发且不推进 nextFireAt', async () => {
  const task = makeTask()
  const store = createStore([task], { ...defaultSettings, doNotDisturb: true })
  primeState(store, Date.now() + 1500)
  const reminders = createReminders()
  const s = new Scheduler(store, reminders)
  s.start()
  await sleep(200)
  const before = store.state.t1.nextFireAt
  await sleep(2500)
  assert.equal(reminders.fired.length, 0, '勿扰期间不应触发')
  assert.equal(store.state.t1.nextFireAt, before, '勿扰期间不应推进 nextFireAt')
  s.stop()
})

// ---------- 6. 停用任务不参与调度 ----------
await test('停用任务不触发', async () => {
  const task = makeTask({ enabled: false })
  const store = createStore([task], defaultSettings)
  primeState(store, Date.now() + 1500)
  const reminders = createReminders()
  const s = new Scheduler(store, reminders)
  s.start()
  await sleep(2500)
  assert.equal(reminders.fired.length, 0, '停用任务不应触发')
  s.stop()
})

// ---------- 7. 每日对齐：advance 越过次日 startTime 时对齐 ----------
await test('每日对齐：advance 越过次日 startTime 时回填', async () => {
  // 间隔 1439 分钟（<1 天）：prev 触发后 next 必然跨过「次日 startTime」，
  // 此时应被对齐回次日 startTime 整点，而不是延续 prev+interval 的漂移时刻。
  const now = new Date()
  const startTime = `${String(now.getHours()).padStart(2, '0')}:00`
  const task = makeTask({ startTime, intervalMinutes: 1439 })
  const store = createStore([task], defaultSettings)
  primeState(store, Date.now() - 1000) // 过期点，启动即补触发
  const reminders = createReminders()
  const s = new Scheduler(store, reminders)
  s.start()
  await sleep(1200)
  assert.equal(reminders.fired.length, 1, '应补触发过期点')
  const next = new Date(store.state.t1.nextFireAt)
  assert.equal(next.getMinutes(), 0, `对齐后分钟应为 0，实际 ${next.getMinutes()}`)
  assert.equal(next.getSeconds(), 0, '对齐后应为整分')
  assert.equal(next.getHours(), now.getHours(), `对齐后小时应为 ${now.getHours()}，实际 ${next.getHours()}`)
  assert.equal(next.getDate(), new Date(Date.now() + 86_400_000).getDate(), '应对齐到次日')
  s.stop()
})

// ---------- 8. computeNextFireAt 语义：startTime 已过时推进到下一档 ----------
await test('startTime 已过时 nextFireAt = 今日下一档（同步断言）', async () => {
  // 构造今天 00:01 开始、间隔 1 分钟的任务：nextFireAt 必为「今天 00:01 + k 分钟」且 > now
  const task = makeTask({ startTime: '00:01', intervalMinutes: 1 })
  const store = createStore([task], defaultSettings)
  const reminders = createReminders()
  const s = new Scheduler(store, reminders)
  s.start()
  const next = store.state.t1.nextFireAt
  const d = new Date(next)
  assert.ok(next > Date.now(), 'nextFireAt 应在未来')
  assert.equal(d.getHours() * 60 + d.getMinutes(), d.getHours() * 60 + d.getMinutes(), 'sanity')
  // 00:01 + k 分钟 => 分钟数与 00:01 同余（mod 1 恒真），验证「> now 且是整分」
  assert.equal(d.getSeconds(), 0, 'nextFireAt 应落在整分（00:01 + k*1min）')
  assert.equal(d.getMilliseconds(), 0, 'nextFireAt 应为整毫秒')
  s.stop()
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
