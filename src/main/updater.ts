import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/api'
import { logger } from './logger'

/** 启动后延迟多久做一次静默检查（避免和首屏渲染抢资源） */
const STARTUP_CHECK_DELAY = 10_000
/** 自动检查失败后的重试间隔（仅在应用未退出且仍在本次运行内） */
const RETRY_DELAY = 30 * 60_000

/**
 * 自动更新（electron-updater + GitHub Releases）。
 *
 * 更新源来自 package.json 的 build.publish（provider: github），
 * 版本信息由 electron-builder 在打包时生成的 latest.yml 提供，
 * 发布流水线会把 latest.yml 与安装包一起上传到 Release，因此无需自建服务端。
 *
 * 注意：
 * - 仅「已打包的 NSIS 安装版」可用；dev 模式与免安装绿色版直接标记为 unsupported；
 * - autoDownload = false：先提示，用户确认后才下载，避免偷偷占用带宽；
 * - 静默检查失败只在日志里记录，手动检查失败才把错误暴露给界面。
 */
class Updater {
  private state: UpdateState = { status: 'idle', currentVersion: '0.0.0' }
  private notify: (state: UpdateState) => void = () => {}
  private initialized = false
  private retryTimer: NodeJS.Timeout | null = null

  /** 初始化并注册事件（app ready 之后调用一次） */
  init(notify: (state: UpdateState) => void): void {
    this.notify = notify
    this.state = { status: 'idle', currentVersion: app.getVersion() }

    if (!app.isPackaged) {
      this.setState({ status: 'idle', unsupported: true })
      logger.info('自动更新：开发模式不可用（仅打包后的安装版支持）')
      return
    }

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => this.setState({ status: 'checking' }))
    autoUpdater.on('update-available', (info) => {
      logger.info(`自动更新：发现新版本 ${info.version}`)
      this.setState({ status: 'available', version: info.version })
    })
    autoUpdater.on('update-not-available', () => {
      this.setState({ status: 'not-available', version: app.getVersion() })
    })
    autoUpdater.on('download-progress', (progress) => {
      this.setState({ status: 'downloading', percent: Math.round(progress.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => {
      logger.info(`自动更新：${info.version} 已下载完成，等待重启安装`)
      this.setState({ status: 'ready', version: info.version, percent: 100 })
    })
    autoUpdater.on('error', (err) => {
      logger.warn('自动更新出错', err)
      this.setState({ status: 'error', message: err.message })
    })

    this.initialized = true
    setTimeout(() => void this.check(true), STARTUP_CHECK_DELAY)
  }

  /** 当前状态：版本号实时取，避免 init 之前的查询拿到占位值 */
  getState(): UpdateState {
    return { ...this.state, currentVersion: app.getVersion() }
  }

  /** 检查更新；auto=true 为后台静默检查（失败不打扰用户） */
  async check(auto = false): Promise<UpdateState> {
    if (!this.initialized) {
      if (!auto) {
        this.setState({ status: 'error', message: '当前版本不支持自动更新（仅安装版可用）' })
      }
      return this.state
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn(`检查更新失败（${auto ? '自动' : '手动'}）`, message)
      if (!auto) this.setState({ status: 'error', message })
      this.scheduleRetry()
    }
    return this.state
  }

  /** 下载新版本 */
  download(): void {
    if (!this.initialized) return
    this.setState({ status: 'downloading', percent: 0 })
    autoUpdater.downloadUpdate().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn('下载更新失败', message)
      this.setState({ status: 'error', message })
    })
  }

  /** 退出并安装（安装完成后会自动重启应用） */
  quitAndInstall(): void {
    if (!this.initialized) return
    logger.info('自动更新：退出并安装新版本')
    autoUpdater.quitAndInstall()
  }

  /** 自动检查失败后隔一段时间再试，避免用户长时间开着应用错过更新 */
  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.check(true)
    }, RETRY_DELAY)
  }

  private setState(patch: Partial<UpdateState> & { status: UpdateState['status'] }): void {
    this.state = { ...this.state, ...patch, currentVersion: app.getVersion() }
    this.notify(this.state)
  }
}

export const updater = new Updater()
