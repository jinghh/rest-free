/**
 * 配置存储回归测试：默认配置合并策略（用户配置优先级 > 默认配置，默认随版本更新）。
 * 直接加载 TS 源码运行（依赖 Node 类型转换 + 解析钩子）。
 *
 * 用法: node --experimental-transform-types scripts/test-config.mjs
 */
import { register } from 'node:module'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

register('./ts-resolver-hooks.mjs', import.meta.url)

const { ConfigStore, normalizeConfig } = await import('../src/main/configStore.ts')
const { DEFAULT_TASKS, DEFAULTS_VERSION, DEFAULT_TASK_IDS } = await import('../src/shared/types.ts')

// mock electron 的 app.getPath('userData') 指向一个固定临时目录（每次模块加载相同）
const mock = await import('./test-mocks/electron.mjs')
const userData = mock.app.getPath('userData')
const configPath = join(userData, 'config.json')
const statePath = join(userData, 'state.json')

function resetFiles(config) {
  if (existsSync(configPath)) rmSync(configPath)
  if (existsSync(statePath)) rmSync(statePath)
  if (config !== undefined) {
    mkdirSync(userData, { recursive: true })
    writeFileSync(configPath, JSON.stringify(config), 'utf-8')
  }
}

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  PASS  ${name}`)
  } catch (err) {
    failed++
    console.error(`  FAIL  ${name}\n        ${err.message}`)
  }
}

console.log('config store regression tests')

// ---------- 1. 首次启动：自动插入 2 个默认任务并落盘 ----------
test('首次启动自动插入默认任务', () => {
  resetFiles()
  const store = new ConfigStore()
  const cfg = store.getConfig()
  assert.equal(cfg.defaultsVersion, DEFAULTS_VERSION, 'defaultsVersion 应已同步')
  assert.equal(cfg.tasks.length, 2, '应插入 2 个默认任务')
  for (const tpl of DEFAULT_TASKS) {
    const t = cfg.tasks.find((x) => x.id === tpl.id)
    assert.ok(t, `默认任务 ${tpl.id} 应存在`)
    assert.equal(t.name, tpl.name)
    assert.equal(t.intervalMinutes, tpl.intervalMinutes)
    assert.equal(t.message, tpl.message)
    assert.equal(t.position, tpl.position)
    assert.equal(t.enabled, true)
    assert.ok(t.createdAt > 0, 'createdAt 应被填充')
  }
  assert.ok(existsSync(configPath), 'config.json 应已落盘')
  assert.ok(existsSync(statePath), 'state.json 应已落盘')
})

// ---------- 2. 二次启动：defaultsVersion 已最新，不重复插入 ----------
test('defaultsVersion 已最新时不重复合并', () => {
  resetFiles()
  const first = new ConfigStore().getConfig()
  resetFiles(JSON.parse(JSON.stringify(first)))
  const second = new ConfigStore().getConfig()
  assert.equal(second.tasks.length, 2, '任务数不应变化')
  const createdAt = second.tasks.map((t) => t.createdAt).sort()
  const firstCreated = first.tasks.map((t) => t.createdAt).sort()
  assert.deepEqual(createdAt, firstCreated, 'createdAt 不应被重置')
})

// ---------- 3. 用户改动过的默认任务：版本升级不覆盖 ----------
test('用户改过的默认任务不被版本更新覆盖', () => {
  resetFiles()
  const store = new ConfigStore()
  // 用户编辑默认任务：间隔改为 30
  store.upsertTask({
    id: 'default-stretch',
    name: '我的拉伸',
    startTime: '08:30',
    intervalMinutes: 30,
    message: '自定义文案',
    position: 'bottom-right',
    enabled: true
  })
  const customized = store.getTask('default-stretch')
  assert.equal(customized.customized, true, 'upsert 默认任务应标记 customized')
  assert.equal(customized.intervalMinutes, 30)
  // 另一个默认任务保持未定制
  assert.equal(store.getTask('default-water').customized, false)

  // 模拟版本升级：defaultsVersion 回退，触发重新合并
  resetFiles({ ...store.getConfig(), defaultsVersion: 0 })
  const reloaded = new ConfigStore().getConfig()
  const stretch = reloaded.tasks.find((t) => t.id === 'default-stretch')
  assert.equal(stretch.intervalMinutes, 30, '用户定制值应保留')
  assert.equal(stretch.name, '我的拉伸', '用户定制名称应保留')
  assert.equal(stretch.customized, true)
})

// ---------- 4. 用户删除的默认任务：版本升级不复活 ----------
test('删除的默认任务不复活', () => {
  resetFiles()
  const store = new ConfigStore()
  store.deleteTask('default-stretch')
  assert.equal(store.getConfig().tasks.length, 1, '删除后剩 1 个任务')
  assert.ok(store.getConfig().removedDefaults.includes('default-stretch'), '应记录 removedDefaults')

  // 模拟版本升级重新合并
  resetFiles({ ...store.getConfig(), defaultsVersion: 0 })
  const reloaded = new ConfigStore().getConfig()
  assert.equal(reloaded.tasks.length, 1, '已删除的默认任务不应复活')
  assert.equal(reloaded.tasks[0].id, 'default-water')
})

// ---------- 5. 模板变更时，未定制任务自动更新 ----------
test('默认模板变化时未定制任务自动更新', () => {
  resetFiles()
  // 构造 defaultsVersion=0 且包含旧模板任务（与当前 DEFAULT_TASKS 业务字段不同、未定制）
  const staleStretch = {
    ...DEFAULT_TASKS[0],
    intervalMinutes: 10, // 旧模板假设是 10 分钟
    message: '旧的文案',
    createdAt: 111,
    updatedAt: 222,
    customized: false
  }
  resetFiles({
    version: 1,
    defaultsVersion: 0,
    tasks: [staleStretch],
    settings: {},
    removedDefaults: []
  })
  const store = new ConfigStore().getConfig()
  const stretch = store.tasks.find((t) => t.id === 'default-stretch')
  assert.equal(stretch.intervalMinutes, DEFAULT_TASKS[0].intervalMinutes, '应更新为新模板间隔')
  assert.equal(stretch.message, DEFAULT_TASKS[0].message, '应更新为新模板文案')
  assert.equal(stretch.createdAt, 111, 'createdAt 应保留')
  // 另一个默认任务应被补入
  assert.equal(store.tasks.length, 2)
})

// ---------- 6. 无变化时不写盘（mtime 不变） ----------
test('无模板变化时不重复写盘', () => {
  resetFiles()
  const cfg = new ConfigStore().getConfig()
  resetFiles(JSON.parse(JSON.stringify(cfg)))
  const before = readFileSync(configPath, 'utf-8')
  new ConfigStore()
  const after = readFileSync(configPath, 'utf-8')
  assert.equal(before, after, '无变化时 config.json 不应被重写')
})

// ---------- 7. normalizeConfig 边界 ----------
test('normalizeConfig 边界：脏数据剔除与字段兜底', () => {
  const cfg = normalizeConfig({
    tasks: [
      null,
      { name: '', message: 'x' }, // 缺名称
      { name: 'ok', message: 'msg', intervalMinutes: 99999, position: 'bogus', startTime: '99:99' },
      { name: 'ok2', message: 'm', id: 'default-stretch', customized: true }
    ],
    settings: { snoozeMinutes: 999 },
    defaultsVersion: 'not-a-number',
    removedDefaults: ['x', 123, 'default-water']
  })
  assert.equal(cfg.tasks.length, 2, '脏任务应被剔除')
  assert.equal(cfg.tasks[0].intervalMinutes, 1440, '越界间隔应钳制')
  assert.equal(cfg.tasks[0].position, 'center', '非法位置应回落')
  assert.equal(cfg.tasks[0].startTime, '10:00', '非法时间应回落')
  assert.equal(cfg.tasks[1].customized, true, 'customized 应保留')
  assert.equal(cfg.settings.snoozeMinutes, 60, '设置应钳制')
  assert.equal(cfg.settings.showRestCountdown, true, '缺失 showRestCountdown 应回落为 true（保持弹全屏倒计时）')
  assert.equal(cfg.defaultsVersion, 0, '非法 defaultsVersion 应回落 0')
  assert.deepEqual(cfg.removedDefaults, ['x', 'default-water'], 'removedDefaults 应过滤非字符串')
})

// ---------- 8. upsert 非默认任务不标记 customized ----------
test('自定义任务不标记 customized', () => {
  resetFiles()
  const store = new ConfigStore()
  store.upsertTask({
    id: 'my-task',
    name: '自定义',
    startTime: '10:00',
    intervalMinutes: 60,
    message: 'test',
    position: 'center',
    enabled: true
  })
  assert.equal(store.getTask('my-task').customized, false, '自定义任务 customized 应为 false')
  assert.ok(!DEFAULT_TASK_IDS.has('my-task'))
})

// ---------- 9. 调度状态变更通知（下次提醒时间刷新） ----------
test('setNextFireAt 变化时通知调度状态订阅者', () => {
  resetFiles()
  const store = new ConfigStore()
  let notified = 0
  const off = store.subscribeState(() => notified++)

  store.setNextFireAt('default-stretch', 1000)
  assert.equal(notified, 1, '触发点首次设置应通知')
  store.setNextFireAt('default-stretch', 2000)
  assert.equal(notified, 2, '触发点推进应通知（提醒弹出后的下一次）')
  store.setNextFireAt('default-stretch', 2000)
  assert.equal(notified, 2, '值未变化不应重复通知')
  assert.equal(store.getNextFireAt('default-stretch'), 2000)

  off()
  store.setNextFireAt('default-stretch', 3000)
  assert.equal(notified, 2, '退订后不应再收到通知')
})

test('删除任务时同步清除其调度状态并通知', () => {
  resetFiles()
  const store = new ConfigStore()
  store.setNextFireAt('default-water', 5000)
  let notified = 0
  store.subscribeState(() => notified++)

  store.deleteTask('default-water')
  assert.equal(store.getNextFireAt('default-water'), undefined, '状态应被清除')
  assert.equal(notified, 1, '删除任务应通知刷新快照')
})

// ---------- 10. 模板变更后未定制任务自动跟随（DEFAULTS_VERSION 升级） ----------
test('默认模板变更时未定制任务自动跟随开始时间', () => {
  resetFiles({
    version: 1,
    defaultsVersion: DEFAULTS_VERSION - 1, // 模拟旧版本用户配置
    tasks: [
      {
        id: 'default-stretch',
        name: '拉伸放松',
        startTime: '09:00',
        intervalMinutes: 15,
        message: '旧文案',
        position: 'top',
        enabled: true,
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'default-water',
        name: '喝水 · 上厕所',
        startTime: '09:00',
        intervalMinutes: 45,
        message: '用户自定义文案',
        position: 'center',
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
        customized: true
      }
    ],
    settings: {},
    removedDefaults: []
  })
  const cfg = new ConfigStore().getConfig()
  assert.equal(cfg.defaultsVersion, DEFAULTS_VERSION, 'defaultsVersion 应升级到最新')
  const stretch = cfg.tasks.find((t) => t.id === 'default-stretch')
  assert.equal(stretch.startTime, '10:00', '未定制的默认任务应跟随新模板的开始时间')
  const water = cfg.tasks.find((t) => t.id === 'default-water')
  assert.equal(water.startTime, '09:00', '用户定制过的任务不应被覆盖')
  assert.equal(water.message, '用户自定义文案', '用户定制过的文案不应被覆盖')
})

// ---------- 11. 全屏倒计时开关：显式 false 需被保留 ----------
test('showRestCountdown 显式关闭时保留为 false', () => {
  resetFiles()
  const store = new ConfigStore()
  store.updateSettings({ showRestCountdown: false })
  const cfg = store.getConfig()
  assert.equal(cfg.settings.showRestCountdown, false, '显式关闭应被保留')
  const reread = new ConfigStore().getConfig()
  assert.equal(reread.settings.showRestCountdown, false, '重新加载后仍为 false')
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
