# Rest-Free 定时休息提醒

一款轻量的 Windows 桌面应用：按计划提醒你起身休息，避免久坐。支持多任务并行、三种提醒位置、立即/稍后休息，配置以 `config.json` 持久化，升级不丢失。

需求文档见 [docs/需求文档.md](docs/需求文档.md)。

## 功能特性

- **多任务定时提醒**：每个任务独立设置「每日开始时间 / 提醒间隔 / 提醒文案 / 提醒位置」，任务数量不限
- **三种提醒位置**：屏幕上方（通知条）/ 屏幕正中间 / 右下角（不遮挡工作区），均带进入动画、始终置顶、不占任务栏
- **立即休息**：全屏柔和遮罩 + 倒计时（默认 5 分钟），支持提前结束（按钮 / Esc）与 +5 分钟延长
- **稍后休息**：推迟 `snoozeMinutes`（默认 5 分钟）后再次提醒，仅覆盖一次
- **忽略**：关闭提醒，等待下一次按间隔触发
- **勿扰模式**：全局抑制提醒，关闭后自动补提醒
- **托盘常驻**：关闭窗口隐藏到托盘，支持开机自启、单实例
- **配置持久化**：`%APPDATA%/rest-free/config.json`，原子写入 + 防抖保存，升级/覆盖安装不丢失
- **多显示器**：提醒弹出在鼠标当前所在屏幕
- **睡眠补偿**：系统睡眠唤醒后，错过的触发自动补提醒
- **可选提示音**：WebAudio 合成轻提示音，无需音频文件

## 技术栈

- Electron 44 + electron-vite 6 + Vite 8
- Vue 3.5 + Pinia 4 + TypeScript 5.9（strict）
- electron-builder 26（NSIS 安装包）

## 快速开始

```bash
pnpm install       # 或 npm install；postinstall 会自动下载 electron 二进制（约 250MB）
pnpm run dev       # 开发模式（热更新）
pnpm run typecheck # 类型检查（node + web 双端）
pnpm run build     # 构建到 out/
pnpm start         # 以生产构建启动
```

> **electron 二进制下载说明**
> - 二进制由包的 postinstall 下载。项目自带 `scripts/ensure-electron.mjs` 兜底：安装后自动检测 `dist/electron.exe`，缺失则自动下载；
> - pnpm 用户：`pnpm-workspace.yaml` 已配置 `allowBuilds`（允许 electron、关闭 electron-winstaller 告警）；
> - 若直连 GitHub 下载失败，设置镜像后重装：
>   ```powershell
>   $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"; pnpm install
>   ```
> - 二进制意外丢失时：`pnpm rebuild` 或 `node scripts/ensure-electron.mjs` 即可补回。

冒烟测试（启动 8 秒验证进程与日志）：

```bash
npm run smoke
# 或: powershell -ExecutionPolicy Bypass -File scripts/smoke-test.ps1
```

回归测试（16 个用例）：

```bash
npm run test            # 全部
npm run test:scheduler  # 调度引擎 8 例：触发、推进、snooze 重排、错过补偿、勿扰、停用、每日对齐
npm run test:config     # 配置存储 8 例：默认任务注入、customized 保护、删除不复活、模板更新
```

## 打包发布

```bash
npm run gen:icon   # 重新生成图标（resources/*.png + icon.ico）
npm run dist:win   # 产出 NSIS 安装包到 dist/
```

安装包默认安装到用户目录，卸载**不会**删除用户配置（`deleteAppDataOnUninstall: false`）。

## Windows 透明窗口渲染注意事项

提醒/休息窗口使用 `transparent: true` 无边框窗口。Chromium 在该模式下有一个坑：
**元素的纯色背景（`background: #fff`）可能被整体丢弃**，表现为卡片白底消失、文字直接浮在桌面上。

已验证的结论与对策：

- **同色 `linear-gradient(#fff, #fff)` 可稳定呈现**（渐变走 picture 绘制路径，纯色走 fast path 会丢）——`reminder.css` / `rest.css` 中的所有背景均已采用此写法，修改时请保持；
- `app.disableHardwareAcceleration()` 无效（非 GPU 问题）；
- 删除 `overflow/radius/shadow/height:100%` 均无效，根因在背景绘制路径本身；
- 动画结束后清理 `animation` 属性（`reminder.ts` 的 `animationend` 处理）作为附加防御；
- 验证手段：`webContents.capturePage()` 后读取 PNG 像素 alpha（注意：直接看图可能被查看器的透明渲染误导，必须量像素）。

## 提醒窗口（Element Message 风格）

- 单行紧凑卡片：高约 40px（`padding 0 10px 16px` + 内容），宽度 top 520 / center 560 / bottom-right 480；
- 结构：`图标 + 任务名：文案（超长省略，hover title 看全文）+ 文字按钮「立即休息 / 晚 N 分钟」+ 关闭钮`；
- 高度自适应：渲染层 `reportHeight()` 量卡片高度 → `reminder:resize` → 主进程钳制到 44~220px 后 `setBounds`，正中间位置按新高度重新居中；窗口等首次上报后才 `show()`（250ms 兜底），避免「先空卡后跳动」；
- **注意**：Windows 透明无边框窗口有约 9px 不可见 inset（实测像素偏移），所以 `body` 顶部不留 padding，改留底部 16px 给阴影，否则卡片底部圆角会被窗口下沿裁掉；
- 复现/验证：`powershell -ExecutionPolicy Bypass -File scripts/repro-reminder.ps1`（**默认只复现弹窗，不截图、不动鼠标、不抢焦点**；需要截图时显式加 `-Capture`，会移动鼠标到主屏中心并在结束后复位）→ 需要像素级校验时用 `scripts/analyze-screenshot.ps1`（量卡片包围盒与圆角）与 `scripts/crop-shot.ps1`（裁剪局部放大查看）。截图脚本必须**先声明 DPI 感知再加载 WinForms**，否则 `Screen.Bounds` 是逻辑像素而 `CopyFromScreen` 抓的是物理像素，高 DPI 屏下只能拍到屏幕左上角 1/4。

## 下次提醒时间自动刷新

- 调度器每次触发提醒都会推进该任务的 `nextFireAt`，`ConfigStore.setNextFireAt()` 在值真正变化时通过 `subscribeState` 通知主进程；
- 主进程随即广播 `schedule:changed`（含全部任务的 `nextFireAt` 快照），渲染层 `applySchedule()` 整体替换——**提醒弹窗出现的同时，主窗口的「下次提醒」即刷新为下一次**，无需用户手动操作；
- 同样覆盖的场景：snooze（改为 N 分钟后）、删除任务（清除其状态）、配置变更重算；
- 窗口长时间隐藏期间调度仍在推进，重新显示主窗口时会补推一次快照（`showMainWindow()` → `broadcastSchedule()`）；
- 验证（纯日志，不动鼠标）：`powershell -ExecutionPolicy Bypass -File scripts/verify-schedule-push.ps1`，输出应为 `position log lines: N, fire+push pairs: N`。

## 默认配置（免配置开箱即用）

首次启动自动注入 2 条默认任务，无需任何设置即可使用：

| 任务 | 开始 | 间隔 | 位置 |
| --- | --- | --- | --- |
| 拉伸放松 | 09:00 | 每 15 分钟 | 屏幕上方 |
| 喝水 · 上厕所 | 09:00 | 每 45 分钟 | 屏幕正中间 |

**用户配置优先级 > 默认配置**，且默认配置随版本更新：

- 修改/停用某条默认任务 → 标记 `customized`，后续版本升级不再覆盖它；
- 删除默认任务 → 记入 `removedDefaults`，版本升级不复活（删除前有确认提示）；
- 升级 `src/shared/types.ts` 中的 `DEFAULTS_VERSION` 与模板后，未定制的默认任务在下次启动自动更新。

验证当前生效的配置：

```bash
node scripts/verify-defaults.mjs
```

## 配置说明

### 存储位置

| 文件 | 路径 | 内容 |
| --- | --- | --- |
| `config.json` | `%APPDATA%/rest-free/config.json` | 任务列表 + 全局设置 |
| `state.json` | `%APPDATA%/rest-free/state.json` | 调度状态（各任务下次触发时间） |
| `app.log` | `%APPDATA%/rest-free/logs/app.log` | 运行日志（超 1MB 自动截断） |

### config.json 结构

```json
{
  "version": 1,
  "defaultsVersion": 1,
  "tasks": [
    {
      "id": "default-stretch",
      "name": "拉伸放松",
      "startTime": "09:00",
      "intervalMinutes": 15,
      "message": "坐太久了，起来拉伸一下，放松身体！",
      "position": "top",
      "enabled": true,
      "createdAt": 1729000000000,
      "updatedAt": 1729000000000,
      "customized": false
    }
  ],
  "settings": {
    "snoozeMinutes": 5,
    "restMinutes": 5,
    "launchAtStartup": false,
    "soundEnabled": false,
    "doNotDisturb": false
  },
  "removedDefaults": []
}
```

- `defaultsVersion`：已同步到的默认配置版本，启动时落后则触发合并；
- `customized`：默认任务被用户改过则为 `true`，版本升级不再覆盖；
- `removedDefaults`：用户删除过的默认任务 id，版本升级不复活。

- 写入策略：先写 `.tmp` 再 `rename`（原子写），连续变更防抖 500ms 合并落盘，退出前强制 flush
- 容错：文件损坏时备份为 `config.corrupt.json` 并以默认配置重建；字段缺失/越界自动修复

### 调度规则

- 每个任务每天从 `startTime` 首次触发，之后每 `intervalMinutes` 一次；越过次日 `startTime` 时重新对齐（保证每天首次触发时刻固定）
- 触发精度：动态 `setTimeout` 链，误差 < 2 秒；睡眠唤醒后延迟触发即「错过补偿」
- `snooze` 仅覆盖一次触发点，之后回到常规节奏；勿扰/休息期间不弹窗也不推进触发点

## 目录结构

```
src/
├── main/                    # 主进程
│   ├── index.ts             # 入口：单实例、主窗口、托盘、生命周期
│   ├── configStore.ts       # config.json / state.json 持久化
│   ├── scheduler.ts         # 调度引擎
│   ├── reminderWindows.ts   # 提醒窗口 + 休息遮罩管理
│   ├── tray.ts              # 系统托盘
│   ├── ipc.ts               # IPC 通道注册
│   ├── autostart.ts         # 开机自启
│   ├── utils.ts             # preload 路径 / 页面加载
│   └── logger.ts            # 文件日志
├── preload/index.ts         # contextBridge 白名单 API
├── shared/                  # 主进程与渲染层共享类型
└── renderer/
    ├── index.html           # 主窗口
    ├── reminder.html        # 提醒窗口
    ├── rest.html            # 休息遮罩窗口
    └── src/                 # Vue 应用 + 轻量窗口脚本
scripts/
├── gen-icon.ps1             # 图标生成（System.Drawing）
├── make-ico.mjs             # PNG → ICO 打包
├── smoke-test.ps1           # 冒烟测试
├── repro-reminder.ps1       # 复现三位置提醒弹窗（默认不截图；加 -Capture 才截图）
├── verify-schedule-push.ps1 # 验证「触发提醒 → 调度快照推送」链路（纯日志，不动鼠标）
├── analyze-screenshot.ps1   # 像素级分析截图（卡片包围盒/圆角）
└── crop-shot.ps1            # 截图裁剪工具
```

## IPC 一览

| 通道 | 方向 | 用途 |
| --- | --- | --- |
| `config:get` / `task:save` / `task:delete` / `settings:update` | R → M | 配置读写（唯一写入口在主进程） |
| `config:changed` | M → R | 配置变更广播 |
| `schedule:snapshot` | R → M | 查询各任务下次触发时间 |
| `schedule:changed` | M → R | 调度状态变化推送（触发提醒/snooze 后刷新「下次提醒」） |
| `app:paths` / `app:openUserData` | R → M | 路径查询 / 打开数据目录 |
| `reminder:action` / `rest:action` | R → M | 提醒/休息按钮动作 |
| `reminder:resize` | R → M | 渲染层上报提醒内容高度，主进程 `setBounds` 自适应窗口 |
| `reminder:data` / `rest:data` / `rest:tick` | M → R | 窗口数据与倒计时驱动 |
| `window:minimize` / `window:close` | R → M | 主窗口控制 |

## 后续计划

- v1.1：配置导入/导出、自定义提示音
- v1.2：健康统计（今日提醒/完成次数）、久坐时长
- v1.3：全屏应用智能延迟、番茄钟模式、多语言
