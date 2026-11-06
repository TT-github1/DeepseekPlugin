/**
 * 插件路由：把设备画面与控制能力暴露给 DSH 网页端。
 *
 * 全部走 DSH webserver 的同源路由，浏览器永远看不见 adb 端口：
 *
 * - `GET  /_dsh/dsh-android-mirror-pane/stream`   multipart/x-mixed-replace 实时帧流
 * - `GET  /_dsh/dsh-android-mirror-pane/snapshot`  单帧 JPEG/PNG（首帧快速出图）
 * - `POST /_dsh/dsh-android-mirror-pane/status`   只读状态：在线设备、当前设备、尺寸
 * - `POST /_dsh/dsh-android-mirror-pane/devices`  设备列表
 * - `POST /_dsh/dsh-android-mirror-pane/select`   切换设备
 * - `POST /_dsh/dsh-android-mirror-pane/control`  注入一个动作
 * - `POST /_dsh/dsh-android-mirror-pane/fps`      调整抓帧节奏
 *
 * 安全姿态参考 @zseven-w/dsh-android 的 stream-access：只允许 loopback 对端 +
 * loopback Host，阻断 DNS rebinding 与局域网访问。
 *
 * @module dsh-android-mirror-pane/routes
 */

import { pickDevice, injectAction, screenSize, adbText, SERIAL_PATTERN } from './adb.js'
import { LogcatStream } from './logcat.js'
import { FrameLoop } from './frame-loop.js'

/** 所有路由共用前缀。 */
export const ROUTE_PREFIX = '/_dsh/dsh-android-mirror-pane'

/** 面板默认抓帧节奏。 */
const DEFAULT_FPS = 4

/**
 * 读当前前台应用的包名。
 *
 * 不同 ROM 的 `dumpsys` 输出差异很大，这里按可靠性从高到低试三种，
 * 任一命中就返回。拿不到不抛错——面板会退回「全量」并提示。
 *
 * @param {string} adb - adb 路径。
 * @param {string} serial - 设备序列号。
 * @returns {Promise<string | null>}
 */
export async function readForegroundPackage(adb, serial) {
  if (!SERIAL_PATTERN.test(serial)) return null
  const probes = [
    /* 首选：mResumedActivity / topResumedActivity 行里的 u0 <pkg>/<activity>。 */
    ['shell', 'dumpsys activity activities'],
    /* 兜底一：窗口焦点。 */
    ['shell', 'dumpsys window'],
  ]
  for (const args of probes) {
    try {
      const text = await adbText(adb, ['-s', serial, ...args], { timeoutMs: 8000 })
      const match = /(?:mResumedActivity|topResumedActivity|mCurrentFocus|mFocusedApp)[^\n]*?u0\s+([A-Za-z0-9._]+)\//.exec(text)
      if (match !== null) return match[1]
    } catch {
      /* 这条探测不可用就试下一条。 */
    }
  }
  return null
}

/**
 * 判断请求是否来自本机。
 * Host 是调用方可控数据，所以必须同时校验对端地址与 Host 头，
 * 否则一个解析到 127.0.0.1 的域名就能绕过。
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function isTrustedRequest(req) {
  const peer = req.socket.remoteAddress ?? ''
  const loopbackPeer = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1'
  if (!loopbackPeer) return false
  const host = String(req.headers.host ?? '')
  const hostname = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.split(':')[0]
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}

/**
 * 读取并解析 JSON 请求体。
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [maxBytes]
 * @returns {Promise<any>}
 */
function readJson(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 发一个 JSON 响应。
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/**
 * 插件持有的设备会话与路由处理器。
 */
export class MirrorService {
  #adb
  #configSerial
  #ffmpeg
  #loop
  #serial
  #size
  #fps
  #disposed = false
  /* 日志采集器与它当前指向的设备/包名。 */
  #logcat
  #logcatSerial
  /* 默认只采当前 App；留空表示全量。 */
  #logcatPackage

  /**
   * @param {{ adb: string, serial?: string, ffmpeg?: string, fps?: number }} options
   */
  constructor(options) {
    this.#adb = options.adb
    this.#configSerial = options.serial
    this.#ffmpeg = options.ffmpeg
    this.#fps = Number.isFinite(Number(options.fps)) ? Number(options.fps) : DEFAULT_FPS
  }

  /** 当前设备序列号；未连接时 undefined。 */
  get serial() {
    return this.#serial
  }

  /* ───────────── 以下是给 agent 工具用的公开接口 ─────────────
     tools.js 与路由共用同一个 service，好处是设备选择、屏幕尺寸缓存、
     日志采集器都只有一份，不会出现「面板看 A 设备、工具操作 B 设备」。 */

  /**
   * 确保有设备并返回它的序列号。
   * @returns {Promise<string | undefined>}
   */
  async ensureDeviceForTool() {
    return this.#ensureDevice()
  }

  /**
   * 取屏幕尺寸（带缓存），供工具换算归一化坐标。
   * @returns {Promise<{ width: number, height: number } | undefined>}
   */
  async screenSizeForTool() {
    await this.#ensureDevice()
    return this.#screenSize()
  }

  /**
   * 截图存放目录，按需创建。
   * @returns {Promise<string | undefined>}
   */
  async shotDirectory() {
    try {
      const { homedir } = await import('node:os')
      const { mkdir } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const dir = join(homedir(), '.dsh', 'android-mirror-pane', 'shots')
      await mkdir(dir, { recursive: true })
      return dir
    } catch {
      return undefined
    }
  }

  /**
   * 切换日志采集目标（工具用）。
   * @param {string} serial - 设备序列号。
   * @param {string | undefined} packageName - 包名；undefined 表示全量。
   * @returns {Promise<void>}
   */
  async setLogcatPackage(serial, packageName) {
    this.#logcatPackage = packageName
    const logcat = this.#ensureLogcat(serial)
    await logcat.setPackage(packageName)
  }

  /**
   * 读一段日志快照（工具用）。
   * @param {{ limit?: number, minLevel?: string, keyword?: string, onlyCrash?: boolean }} filter
   * @returns {{ lines: object[], total: number, dropped: number, packageName?: string }}
   */
  readLogcat(filter = {}) {
    const logcat = this.#logcat
    if (logcat === undefined) return { lines: [], total: 0, dropped: 0 }
    const lines = logcat.snapshot({
      limit: filter.limit ?? 200,
      minLevel: filter.minLevel,
      keyword: filter.keyword,
      onlyCrash: filter.onlyCrash === true,
    })
    return {
      lines,
      total: logcat.total,
      dropped: logcat.dropped,
      ...(logcat.packageName === undefined ? {} : { packageName: logcat.packageName }),
    }
  }

  /**
   * 确保有一台可用设备与对应的抓帧循环。
   * @returns {Promise<string | undefined>}
   */
  async #ensureDevice() {
    if (this.#disposed) return undefined
    const { serial } = await pickDevice(this.#adb, this.#configSerial)
    if (serial === undefined) {
      this.#loop?.stop()
      this.#loop = undefined
      this.#serial = undefined
      this.#size = undefined
      return undefined
    }
    if (serial !== this.#serial || this.#loop === undefined) {
      this.#loop?.stop()
      this.#serial = serial
      this.#size = undefined
      this.#loop = new FrameLoop({ adb: this.#adb, serial, fps: this.#fps, ffmpeg: this.#ffmpeg })
    }
    return serial
  }

  /**
   * 取当前屏幕尺寸（带缓存）。
   * @returns {Promise<{ width: number, height: number } | undefined>}
   */
  async #screenSize() {
    if (this.#size !== undefined) return this.#size
    const serial = this.#serial
    if (serial === undefined) return undefined
    try {
      this.#size = await screenSize(this.#adb, serial)
      return this.#size
    } catch {
      return undefined
    }
  }

  /** `GET /stream` — multipart 帧流，客户端断开即退订。 */
  async handleStream(req, res) {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    const serial = await this.#ensureDevice()
    if (serial === undefined) {
      sendJson(res, 409, { error: 'no-device', message: '没有可用的安卓设备，请检查 USB 连接与调试授权' })
      return
    }
    res.writeHead(200, {
      'content-type': 'multipart/x-mixed-replace; boundary=frame',
      'cache-control': 'no-store',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const unsubscribe = this.#loop.subscribe(
      (frame) => {
        if (res.writableEnded) return
        res.write(`--frame\r\ncontent-type: ${frame.mime}\r\ncontent-length: ${frame.body.length}\r\n\r\n`)
        res.write(frame.body)
        res.write('\r\n')
      },
      () => {
        /* 错误不写进流里，避免破坏 multipart 结构；状态接口会暴露 lastError。 */
      },
    )
    const cleanup = () => {
      unsubscribe()
      if (!res.writableEnded) res.end()
    }
    req.on('close', cleanup)
    req.on('error', cleanup)
  }

  /** `GET /snapshot` — 单帧，用于首屏快速出图。 */
  async handleSnapshot(req, res) {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    const serial = await this.#ensureDevice()
    if (serial === undefined) {
      sendJson(res, 409, { error: 'no-device' })
      return
    }
    try {
      const frame = await this.#loop.grabOnce()
      res.writeHead(200, {
        'content-type': frame.mime,
        'content-length': String(frame.body.length),
        'cache-control': 'no-store',
      })
      res.end(frame.body)
    } catch (error) {
      sendJson(res, 500, { error: 'capture-failed', message: String(error?.message ?? error) })
    }
  }

  /** `POST /status` — 只读状态。 */
  async handleStatus(req, res) {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    const serial = await this.#ensureDevice()
    const size = await this.#screenSize()
    sendJson(res, 200, {
      connected: serial !== undefined,
      serial,
      size,
      fps: this.#fps,
      subscribers: this.#loop?.subscriberCount ?? 0,
      lastError: this.#loop?.lastError,
    })
  }

  /** `POST /devices` — 设备列表。 */
  async handleDevices(req, res) {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    try {
      const { serial, devices } = await pickDevice(this.#adb, this.#configSerial)
      sendJson(res, 200, { current: serial, devices: devices.map(({ serial: s, state, model }) => ({ serial: s, state, model })) })
    } catch (error) {
      sendJson(res, 500, { error: 'adb-failed', message: String(error?.message ?? error) })
    }
  }

  /** `POST /select` — 切换设备。 */
  async handleSelect(req, res) {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    let body
    try {
      body = await readJson(req)
    } catch (error) {
      sendJson(res, 400, { error: 'bad-request', message: String(error?.message ?? error) })
      return
    }
    const serial = String(body?.serial ?? '')
    if (!SERIAL_PATTERN.test(serial)) {
      sendJson(res, 400, { error: 'invalid-serial' })
      return
    }
    const { devices } = await pickDevice(this.#adb, this.#configSerial)
    if (!devices.some((device) => device.serial === serial && device.state === 'device')) {
      sendJson(res, 409, { error: 'not-online', message: '该设备当前不在线' })
      return
    }
    this.#configSerial = serial
    this.#loop?.stop()
    this.#loop = undefined
    this.#serial = undefined
    this.#size = undefined
    const next = await this.#ensureDevice()
    sendJson(res, 200, { serial: next })
  }

  /** `POST /control` — 注入一个动作。 */
  async handleControl(req, res) {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    let body
    try {
      body = await readJson(req)
    } catch (error) {
      sendJson(res, 400, { error: 'bad-request', message: String(error?.message ?? error) })
      return
    }
    const serial = await this.#ensureDevice()
    if (serial === undefined) {
      sendJson(res, 409, { error: 'no-device' })
      return
    }
    const size = await this.#screenSize()
    if (size === undefined) {
      sendJson(res, 503, { error: 'no-size', message: '拿不到屏幕尺寸，请稍后重试' })
      return
    }
    try {
      await injectAction(this.#adb, serial, size, body ?? {})
      sendJson(res, 200, { ok: true })
    } catch (error) {
      sendJson(res, 500, { error: 'inject-failed', message: String(error?.message ?? error) })
    }
  }

  /** `POST /fps` — 调整抓帧节奏。 */
  async handleFps(req, res) {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    let body
    try {
      body = await readJson(req)
    } catch (error) {
      sendJson(res, 400, { error: 'bad-request', message: String(error?.message ?? error) })
      return
    }
    const fps = Number(body?.fps)
    if (!Number.isFinite(fps)) {
      sendJson(res, 400, { error: 'invalid-fps' })
      return
    }
    this.#fps = Math.max(1, Math.min(15, Math.round(fps)))
    /* 重建循环让新节奏生效。 */
    if (this.#serial !== undefined) {
      this.#loop?.stop()
      this.#loop = new FrameLoop({ adb: this.#adb, serial: this.#serial, fps: this.#fps, ffmpeg: this.#ffmpeg })
    }
    sendJson(res, 200, { fps: this.#fps })
  }

  /**
   * `GET /logcat/stream` — 实时日志流（NDJSON，每行一条批量记录）。
   *
   * 为什么会漏行：全量 logcat 实测 3500 行/秒，按 250ms 批量最多送 600 行/批，
   * 高速时前端看到的只是「尾随采样」。完整性由 `/logcat/snapshot` 保证：
   * 宿主侧环形缓冲留 5 万行，前端按 seq 缺口回拉补齐。
   */
  async handleLogcatStream(req, res) {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    const serial = await this.#ensureDevice()
    if (serial === undefined) {
      sendJson(res, 409, { error: 'no-device' })
      return
    }
    const logcat = this.#ensureLogcat(serial)
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    })
    /* 先把缓冲末尾的一段发过去，打开面板立刻有内容可看。 */
    const backlog = logcat.snapshot({ limit: 300 })
    if (backlog.length > 0) res.write(`${JSON.stringify({ lines: backlog, initial: true })}\n`)

    const unsubscribe = logcat.subscribe(
      (batch) => {
        if (res.writableEnded) return
        res.write(`${JSON.stringify(batch)}\n`)
      },
      (error) => {
        if (res.writableEnded) return
        res.write(`${JSON.stringify({ error: String(error?.message ?? error) })}\n`)
      },
    )
    const cleanup = () => {
      unsubscribe()
      if (!res.writableEnded) res.end()
    }
    req.on('close', cleanup)
    req.on('error', cleanup)
  }

  /**
   * `POST /logcat/snapshot` — 按条件取历史行，用于补齐实时流的缺口。
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async handleLogcatSnapshot(req, res) {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    let body
    try {
      body = await readJson(req)
    } catch (error) {
      sendJson(res, 400, { error: 'bad-request', message: String(error?.message ?? error) })
      return
    }
    const serial = this.#serial
    if (serial === undefined || this.#logcat === undefined) {
      sendJson(res, 200, { lines: [], total: 0, dropped: 0 })
      return
    }
    const lines = this.#logcat.snapshot({
      limit: Number.isFinite(Number(body?.limit)) ? Math.max(1, Math.min(20_000, Number(body.limit))) : 2000,
      minLevel: typeof body?.minLevel === 'string' ? body.minLevel : undefined,
      keyword: typeof body?.keyword === 'string' ? body.keyword : undefined,
      onlyCrash: body?.onlyCrash === true,
      sinceSeq: Number.isFinite(Number(body?.sinceSeq)) ? Number(body.sinceSeq) : undefined,
    })
    sendJson(res, 200, { lines, total: this.#logcat.total, dropped: this.#logcat.dropped, running: this.#logcat.running })
  }

  /** `POST /logcat/clear` — 清空缓冲。 */
  async handleLogcatClear(req, res) {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    this.#logcat?.clear()
    sendJson(res, 200, { ok: true })
  }

  /** `POST /logcat/status` — 采集状态。 */
  async handleLogcatStatus(req, res) {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    sendJson(res, 200, {
      running: this.#logcat?.running ?? false,
      buffered: this.#logcat?.size ?? 0,
      total: this.#logcat?.total ?? 0,
      dropped: this.#logcat?.dropped ?? 0,
      lastError: this.#logcat?.lastError,
    })
  }

  /**
   * 拿到（必要时创建）当前设备的日志采集器。
   *
   * 默认跟随「当前前台 App」：你看日志时绝大多数时候只关心自己正在调的那个应用，
   * 全量日志实测 3500 行/秒，是单应用的 5 倍，既吵又费带宽。
   * 需要看全部时由前端显式调用 `/logcat/package` 传空包名切过去。
   *
   * @param {string} serial
   * @returns {LogcatStream}
   */
  #ensureLogcat(serial) {
    if (this.#logcat !== undefined && this.#logcatSerial === serial) return this.#logcat
    /* 换设备时旧采集器必须停掉，否则会同时抓两台设备的日志。 */
    this.#logcat?.stop()
    this.#logcat = new LogcatStream({ adb: this.#adb, serial, packageName: this.#logcatPackage })
    this.#logcatSerial = serial
    return this.#logcat
  }

  /**
   * `POST /logcat/package` — 切换日志过滤目标。
   * 传空字符串或 `all: true` 表示全量；传包名表示只看该应用。
   */
  async handleLogcatPackage(req, res) {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    let body
    try {
      body = await readJson(req)
    } catch (error) {
      sendJson(res, 400, { error: 'bad-request', message: String(error?.message ?? error) })
      return
    }
    const serial = await this.#ensureDevice()
    if (serial === undefined) {
      sendJson(res, 409, { error: 'no-device' })
      return
    }
    const raw = typeof body?.packageName === 'string' ? body.packageName.trim() : ''
    /* 包名只允许字母数字点下划线，防止被拼进 adb 参数做别的事。 */
    if (raw.length > 0 && !/^[A-Za-z0-9._]{1,200}$/.test(raw)) {
      sendJson(res, 400, { error: 'invalid-package' })
      return
    }
    this.#logcatPackage = raw.length > 0 ? raw : undefined
    const logcat = this.#ensureLogcat(serial)
    await logcat.setPackage(this.#logcatPackage)
    sendJson(res, 200, { packageName: logcat.packageName ?? null, pid: logcat.pid ?? null, lastError: logcat.lastError })
  }

  /**
   * `POST /logcat/foreground` — 探测当前前台应用包名，供面板「跟随当前 App」用。
   */
  async handleLogcatForeground(req, res) {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    const serial = await this.#ensureDevice()
    if (serial === undefined) {
      sendJson(res, 409, { error: 'no-device' })
      return
    }
    sendJson(res, 200, { packageName: await readForegroundPackage(this.#adb, serial) })
  }

  /** 停止一切并释放资源。 */
  dispose() {
    this.#disposed = true
    this.#loop?.stop()
    this.#loop = undefined
    this.#logcat?.stop()
    this.#logcat = undefined
    this.#logcatSerial = undefined
    this.#serial = undefined
    this.#size = undefined
  }
}

/**
 * 把路由挂到 DSH webserver 上。
 * @param {{ register: (route: { kind: 'exact' | 'prefix', path: string, handler: (req: any, res: any) => void | Promise<void> }) => () => void }} webServer
 * @param {MirrorService} service
 * @returns {() => void} 卸载函数
 */
export function mountRoutes(webServer, service) {
  const handlers = [
    ['/stream', (req, res) => service.handleStream(req, res)],
    ['/snapshot', (req, res) => service.handleSnapshot(req, res)],
    ['/status', (req, res) => service.handleStatus(req, res)],
    ['/devices', (req, res) => service.handleDevices(req, res)],
    ['/select', (req, res) => service.handleSelect(req, res)],
    ['/control', (req, res) => service.handleControl(req, res)],
    ['/fps', (req, res) => service.handleFps(req, res)],
    ['/logcat/stream', (req, res) => service.handleLogcatStream(req, res)],
    ['/logcat/snapshot', (req, res) => service.handleLogcatSnapshot(req, res)],
    ['/logcat/clear', (req, res) => service.handleLogcatClear(req, res)],
    ['/logcat/status', (req, res) => service.handleLogcatStatus(req, res)],
    ['/logcat/package', (req, res) => service.handleLogcatPackage(req, res)],
    ['/logcat/foreground', (req, res) => service.handleLogcatForeground(req, res)],
  ]
  const disposers = handlers.map(([suffix, handler]) =>
    webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}${suffix}`,
      handler: (req, res) => {
        Promise.resolve(handler(req, res)).catch((error) => {
          if (res.writableEnded) return
          sendJson(res, 500, { error: 'internal', message: String(error?.message ?? error) })
        })
      },
    }),
  )
  return () => {
    for (const dispose of disposers.reverse()) dispose()
    service.dispose()
  }
}
