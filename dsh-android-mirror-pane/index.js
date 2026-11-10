/**
 * dsh-android-mirror-pane 的宿主侧入口。
 *
 * Android 投屏与操控面板：把真机画面推到 DSH 右侧栏，支持点击、拖拽与截图。
 * 画面来源都经过 DSH webserver 的同源路由，浏览器不接触 adb 端口。
 *
 * 与其它安卓插件的区别：本插件只做「人看人操作」这一件事，不注册任何
 * agent 工具，也不抢占设备归属；同一时间只维护一条抓帧循环，面板关掉就停。
 *
 * @module dsh-android-mirror-pane
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveAdb } from './src/host/adb.js'
import { MirrorService, mountRoutes } from './src/host/routes.js'
import { registerTools } from './src/host/tools.js'
import { PreviewHub, findAndroidProject } from './src/host/preview.js'
import { mountPreviewRoutes } from './src/host/preview-routes.js'

/** 插件名，用于日志与配置读取。 */
export const name = 'dsh-android-mirror-pane'

/**
 * 依赖的 DSH 服务。
 *
 * `webServer` 给面板用（没有它的 headless profile 里面板不出现，但工具照常可用）；
 * `tools` 给 agent 用；`attachments` 是可选依赖，只有它在，截图才能以图片形式交给模型。
 */
export const inject = ['webServer', 'tools']

/**
 * 找一个可用的 ffmpeg 用于把 PNG 压成 JPEG。
 * 找不到就退回直出 PNG，功能不受影响但带宽更高。
 * @returns {string | undefined}
 */
function resolveFfmpeg() {
  for (const candidate of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * 安装插件。
 * @param {any} ctx - cordis 上下文。
 * @param {any} [config] - 插件配置：`{ serial?, adb?, fps?, preview? }`。
 * @returns {void}
 */
export function apply(ctx, config) {
  const options = config ?? {}
  const adb = resolveAdb(options.adb)
  const ffmpeg = resolveFfmpeg()
  const logger = ctx.logger ?? console

  /* service 只建一份：面板路由与 agent 工具共用它，
     这样设备选择、屏幕尺寸缓存、日志采集器都只有一个，
     不会出现「面板看 A 设备、工具操作 B 设备」这类分裂。 */
  const service = new MirrorService({
    adb,
    serial: typeof options.serial === 'string' ? options.serial : undefined,
    ffmpeg,
    fps: options.fps,
  })

  /* preview 服务与投屏服务完全独立：它不需要设备，只认项目目录与 CLI。
     项目根按会话解析——面板是挂在会话上的，用户可能在同一个 DSH 里
     开着两个安卓仓库。实测宿主进程的 cwd 是 profile 目录而不是项目，
     所以「会话目录」比 cwd 可靠得多：优先 workingDirectory 服务，
     其次进程 cwd，最后靠向上找 gradlew 兜底。 */
  const previewConfig = options.preview ?? {}
  const agents = ctx.get?.('agents')
  const workingDirectory = ctx.get?.('workingDirectory')
  const candidates = [workingDirectory?.defaultDirectory, process.cwd()]
    .filter((entry) => typeof entry === 'string' && entry.length > 0)
  const configuredRoot = typeof previewConfig.projectRoot === 'string' && previewConfig.projectRoot.length > 0
    ? previewConfig.projectRoot
    : undefined
  const defaultRoot = configuredRoot ?? candidates.map((entry) => findAndroidProject(entry)).find((entry) => entry !== undefined) ?? process.cwd()

  /**
   * 从一个已关闭/未激活的会话 id 反推它当初的目录。
   *
   * 为什么需要：会话关闭后 `agents.get(id)` 拿不到 Agent，于是面板会退回
   * 「默认根」——实测那个值可能是 profile 目录（宿主进程的启动目录），
   * 那里一个 preview 都没有，用户会以为「这个仓库没有 @Preview」。
   *
   * DSH 把会话日志按 `--<目录转义>--` 命名，实测格式是
   * `/Users/x/Repo/New` → `--Users-x-Repo-New--`。靠它可以把路径还原回来，
   * 虽不如 workingDirectory 权威，但远比错误地退回 profile 目录好。
   *
   * @param {string} sessionId
   * @returns {string | undefined}
   */
  const directoryFromSessionId = (sessionId) => {
    try {
      const sessionsRoot = join(homedir(), '.dsh', 'sessions')
      if (!existsSync(sessionsRoot)) return undefined
      for (const group of readdirSync(sessionsRoot, { withFileTypes: true })) {
        if (!group.isDirectory() || !group.name.startsWith('--')) continue
        if (!existsSync(join(sessionsRoot, group.name, sessionId))) continue
        /* `--Users-hetianfu-Repository-Joyroom-New--` → 逐段还原。
           注意目录名里的连字符与路径分隔符无法区分，只做尽力而为：
           从最长前缀开始拼，取第一个真实存在的目录。 */
        const inner = group.name.replace(/^--/, '').replace(/--$/, '')
        const parts = inner.split('-').filter((part) => part.length > 0)
        const candidates = []
        const expand = (index, built) => {
          if (index >= parts.length) {
            candidates.push(built)
            return
          }
          /* 逐段尝试：当前段单独成分隔，或与下一段用连字符拼接。 */
          expand(index + 1, [...built, parts[index]])
          if (index + 1 < parts.length) {
            expand(index + 2, [...built, `${parts[index]}-${parts[index + 1]}`])
          }
        }
        expand(0, [])
        for (const segments of candidates.sort((a, b) => b.length - a.length)) {
          const guess = `/${segments.join('/')}`
          if (existsSync(guess)) return guess
        }
      }
    } catch {
      /* 还原失败就返回 undefined，交给上层兜底。 */
    }
    return undefined
  }

  const hub = new PreviewHub({
    defaultRoot,
    resolveProjectRoot: (sessionId) => {
      /* 会话 → Agent → workingDirectory.get(session) 是最准的一条路。
         拿不到 Agent（会话已关闭）时才退到会话目录名反推。 */
      try {
        const agent = agents?.get?.(sessionId)
        if (agent !== undefined) {
          const directory = workingDirectory?.get?.(agent.session)
          if (typeof directory === 'string' && directory.length > 0) return directory
          const fromHeader = agent.session?.header?.cwd
          if (typeof fromHeader === 'string' && fromHeader.length > 0) return fromHeader
        }
      } catch {
        /* 落到下面的目录名反推。 */
      }
      return directoryFromSessionId(sessionId)
    },
    options: {
      modules: Array.isArray(previewConfig.modules) ? previewConfig.modules : undefined,
      androidCli: previewConfig.androidCli,
      renderer: previewConfig.renderer,
      studioProject: previewConfig.studioProject,
    },
    logger,
  })

  /* agent 工具：注册在插件顶层，headless 环境里也能用。 */
  ctx.effect(() => {
    const dispose = () => service.dispose()
    registerTools(ctx, { adb, serial: options.serial, service })
    logger.info?.('[android-mirror-pane] 已注册 agent 工具：android_screenshot / android_logcat / android_tap / android_swipe / android_devices')
    return dispose
  }, 'android-mirror-pane: agent 工具')

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const webServer = webCtx.webServer
      const dispose = mountRoutes(webServer, service)
      logger.info?.(`[android-mirror-pane] 已挂载画面路由，adb=${adb}${ffmpeg === undefined ? '（无 ffmpeg，直出 PNG）' : ''}`)
      return () => {
        logger.info?.('[android-mirror-pane] 正在卸载，停止抓帧并移除路由')
        dispose()
      }
    })

    /* preview 单独挂：它不依赖设备，投屏路由出问题时预览面板应照常可用。 */
    webCtx.effect(() => {
      const dispose = mountPreviewRoutes(webCtx.webServer, hub)
      logger.info?.(`[android-mirror-pane] 已挂载 preview 路由，默认项目 ${defaultRoot}`)
      return () => {
        logger.info?.('[android-mirror-pane] 正在卸载 preview 路由')
        dispose()
      }
    })
  })
}
