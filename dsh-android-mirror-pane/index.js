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

import { existsSync } from 'node:fs'
import { resolveAdb } from './src/host/adb.js'
import { MirrorService, mountRoutes } from './src/host/routes.js'
import { registerTools } from './src/host/tools.js'

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
 * @param {any} [config] - 插件配置：`{ serial?, adb?, fps? }`。
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
  })
}
