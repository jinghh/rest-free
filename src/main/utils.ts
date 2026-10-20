import { join } from 'node:path'
import type { BrowserWindow, WebPreferences } from 'electron'

/** 预加载脚本路径（相对 out/main） */
export function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

/** 统一的 webPreferences：contextIsolation + 白名单 preload */
export function sharedWebPreferences(): WebPreferences {
  return {
    preload: preloadPath(),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  }
}

/**
 * 加载渲染页面：dev 模式走 electron-vite dev server，生产模式加载打包后的文件。
 * electron-vite 在 dev 时通过 ELECTRON_RENDERER_URL 注入渲染层地址。
 */
export function loadRenderer(win: BrowserWindow, page: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(`${devUrl.replace(/\/$/, '')}/${page}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer', page))
  }
}

/** 应用资源目录（图标等，相对 out/main 为上两级） */
export function resourcePath(file: string): string {
  return join(__dirname, '../../resources', file)
}
