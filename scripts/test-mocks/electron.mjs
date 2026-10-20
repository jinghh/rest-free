/** 测试用 electron mock：仅覆盖被加载模块使用到的 API */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 隔离的用户数据目录，避免测试写真实 %APPDATA%
const userData = mkdtempSync(join(tmpdir(), 'rest-free-test-'))

export const app = {
  getPath: (key) => (key === 'userData' ? userData : tmpdir()),
  getVersion: () => '0.0.0-test',
  setLoginItemSettings: () => {},
  requestSingleInstanceLock: () => true,
  on: () => {},
  whenReady: () => Promise.resolve(),
  quit: () => {}
}

export const BrowserWindow = class {}
export const screen = { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getPrimaryDisplay: () => ({ workArea: {}, bounds: {} }) }
export const ipcMain = { handle: () => {}, on: () => {} }
export const ipcRenderer = { invoke: () => {}, send: () => {}, on: () => {}, removeListener: () => {} }
export const contextBridge = { exposeInMainWorld: () => {} }
export const Menu = { buildFromTemplate: () => ({}) }
export const Tray = class {}
export const nativeImage = { createFromPath: () => ({}) }
export const shell = { openPath: () => {} }
