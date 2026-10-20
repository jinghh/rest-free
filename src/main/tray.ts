import { Menu, Tray, nativeImage } from 'electron'
import type { ConfigStore } from './configStore'
import { resourcePath } from './utils'

/** 创建系统托盘：左键单击打开主界面，右键菜单含勿扰开关与退出 */
export function createTray(store: ConfigStore, onOpenMain: () => void, onQuit: () => void): Tray {
  const icon = nativeImage.createFromPath(resourcePath('tray.png'))
  const tray = new Tray(icon)
  tray.setToolTip('Rest-Free 定时休息提醒')

  const rebuild = (): void => {
    const dnd = store.getConfig().settings.doNotDisturb
    const menu = Menu.buildFromTemplate([
      { label: '打开主界面', click: onOpenMain },
      { type: 'separator' },
      {
        label: dnd ? '关闭勿扰模式' : '开启勿扰模式',
        click: () => {
          store.updateSettings({ doNotDisturb: !dnd })
          rebuild()
        }
      },
      { type: 'separator' },
      { label: '退出', click: onQuit }
    ])
    tray.setContextMenu(menu)
  }
  rebuild()

  tray.on('click', onOpenMain)
  return tray
}
