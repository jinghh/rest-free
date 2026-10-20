import { app } from 'electron'
import { logger } from './logger'

/**
 * 开机自启。安装版可不传 path；便携/绿色版传入 process.execPath 更保险。
 * dev 模式下 process.execPath 指向 electron.exe，仅在用户手动开启开关时才会注册。
 */
export function applyAutoStart(enable: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: enable,
      path: process.execPath,
      args: []
    })
    logger.info(`开机自启：${enable ? '已开启' : '已关闭'}`)
  } catch (err) {
    logger.error('设置开机自启失败', err)
  }
}
