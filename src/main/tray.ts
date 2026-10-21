import { Menu, Tray, nativeImage } from 'electron'
import type { ConfigStore } from './configStore'
import type { RestState } from '../shared/api'
import { resourcePath } from './utils'

/** 托盘句柄：可主动重建菜单与提示文字 */
export interface TrayApi {
  /** 重建菜单与 tooltip（休息状态、勿扰状态变化时调用） */
  rebuild: () => void
}

/**
 * 创建系统托盘：左键单击打开主界面，右键菜单含勿扰开关、休息状态与退出。
 * 休息中（静默休息或全屏倒计时）时菜单显示「结束休息」，tooltip 显示剩余时间。
 */
export function createTray(
  store: ConfigStore,
  onOpenMain: () => void,
  onQuit: () => void,
  getRestState: () => RestState,
  onEndRest: () => void
): TrayApi {
  const icon = nativeImage.createFromPath(resourcePath('tray.png'))
  const tray = new Tray(icon)

  const rebuild = (): void => {
    const dnd = store.getConfig().settings.doNotDisturb
    const rest = getRestState()
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: '打开主界面', click: onOpenMain },
      { type: 'separator' }
    ]

    if (rest.resting) {
      const remain = formatRemain(rest.remainMs)
      template.push(
        { label: `休息中（剩余 ${remain}）`, enabled: false },
        { label: '结束休息', click: onEndRest },
        { type: 'separator' }
      )
    }

    template.push(
      {
        label: dnd ? '关闭勿扰模式' : '开启勿扰模式',
        click: () => {
          store.updateSettings({ doNotDisturb: !dnd })
          rebuild()
        }
      },
      { type: 'separator' },
      { label: '退出', click: onQuit }
    )

    tray.setContextMenu(Menu.buildFromTemplate(template))
    tray.setToolTip(
      rest.resting ? `Rest-Free · 休息中 ${formatRemain(rest.remainMs)}` : 'Rest-Free 定时休息提醒'
    )
  }
  rebuild()

  tray.on('click', onOpenMain)
  return { rebuild }
}

/** 毫秒格式化为 mm:ss */
function formatRemain(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}
