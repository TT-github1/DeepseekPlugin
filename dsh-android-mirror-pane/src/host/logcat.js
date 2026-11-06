/**
 * logcat 采集：起一条 `adb logcat -v threadtime` 常驻进程，按行解析后放进环形缓冲。
 *
 * 全量 logcat 的实测负载：**约 2500 行/秒、23 MB/分钟**（vivo V2055A）。
 * 直接把这些行推给浏览器会立刻堵死渲染。所以这里做三件事：
 *
 *   1. 服务端只保留一个固定行数的环形缓冲，内存占用与运行时长无关；
 *   2. 推送按「批量 + 间隔」节流，绝不逐行发；
 *   3. 解析失败的行不丢弃，标成 raw 原样保留，避免吞掉崩溃栈这类非标准输出。
 *
 * 崩溃/ANR 单独标记出来：原生开发最常看的就是这些，让前端能一键筛。
 *
 * @module dsh-android-mirror-pane/logcat
 */

import { spawn } from 'node:child_process'
import { SERIAL_PATTERN } from './adb.js'

/**
 * 环形缓冲保留的最大行数。
 *
 * 默认只采当前 App：实测（vivo V2055A）按 `--pid` 过滤后约 685 行/秒，
 * 每行约 120 字节。2 万行 ≈ 2.4 MB，能装下约 30 秒的单应用全量日志，
 * 足够看完一次完整操作。只有切到「全部」模式时才会接近负载上限。
 */
const RING_SIZE = 20_000

/** 一次推送给前端的最大行数。实测设备可达 3500 行/秒，
 *  250ms 一轮就是近 900 行；给到 600 才能跟上，同时前端仍能轻松渲染。 */
const FLUSH_BATCH = 600

/** 推送间隔（毫秒）。250ms 对眼睛是连续的，又避免每行一次 IPC。 */
const FLUSH_INTERVAL = 250

/**
 * 解析一行 threadtime 格式日志。
 * 形如：`10-30 14:43:41.677 24979 24979 W Tag: message`
 * @param {string} line - 原始行。
 * @param {number} seq - 自增序号，前端据此去重与定位。
 * @returns {object} 结构化记录；解析不了时 `raw` 为原文。
 */
export function parseLine(line, seq) {
  /* 分节标记原样保留，前端当作分隔线显示。 */
  if (line.startsWith('--------- beginning of')) {
    return { seq, kind: 'section', text: line, raw: line }
  }
  const match = /^(\d\d-\d\d)\s+(\d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.*?)\s*:\s(.*)$/.exec(line)
  if (match === null) {
    return { seq, kind: 'line', raw: line, level: 'V', time: '', pid: 0, tag: '', message: line }
  }
  const [, date, time, pid, tid, level, tag, message] = match
  /* 崩溃与 ANR 是原生调试第一现场，标出来让前端能筛。 */
  const crash = /FATAL EXCEPTION|ANR in|beginning of crash/i.test(line)
  return {
    seq,
    kind: 'line',
    date,
    time,
    pid: Number(pid),
    tid: Number(tid),
    level,
    tag,
    message,
    ...(crash ? { crash: true } : {}),
  }
}

/**
 * 一台设备的 logcat 采集器。
 *
 * 生命周期与订阅者绑定：第一个订阅者出现时启动进程，最后一个离开时杀掉，
 * 不留孤儿进程。
 */
export class LogcatStream {
  #adb
  #serial
  #child
  #buffer = []
  #seq = 0
  #pending = []
  #timer
  #subscribers = new Set()
  #partial = ''
  #lastError
  #dropped = 0
  #startedAt = 0
  #totalLines = 0
  /* 目标包名：undefined 表示采全量；字符串表示只采该应用的 pid。 */
  #packageName
  /* 当前跟踪的 pid；App 重启后会变，靠定期重查来跟上。 */
  #pid
  #pidTimer
  /* 子进程参数指纹，用来判断是否需要重启采集。 */
  #argKey
  /* 已停止标记：挡住 stop() 之后才回来的异步启动。 */
  #stopped = false

  /**
   * @param {{ adb: string, serial: string, packageName?: string }} options
   */
  constructor(options) {
    this.#adb = options.adb
    this.#serial = options.serial
    this.#packageName = options.packageName
  }

  /** 当前过滤的包名；全量模式为 undefined。 */
  get packageName() {
    return this.#packageName
  }

  /** 当前跟踪的 pid。 */
  get pid() {
    return this.#pid
  }

  /** 当前缓冲里的行数。 */
  get size() {
    return this.#buffer.length
  }

  /** 累计收到的行数（含已被环形缓冲挤掉的）。 */
  get total() {
    return this.#totalLines
  }

  /** 因缓冲溢出丢掉的累计行数。 */
  get dropped() {
    return this.#dropped
  }

  /** 最近一次失败原因。 */
  get lastError() {
    return this.#lastError
  }

  /** 是否正在采集。 */
  get running() {
    return this.#child !== undefined
  }

  /**
   * 取当前缓冲快照（最新在后）。
   * @param {{ limit?: number, minLevel?: string, keyword?: string, onlyCrash?: boolean }} [filter]
   * @returns {object[]}
   */
  snapshot(filter = {}) {
    return this.#filtered(this.#buffer, filter).slice(-(filter.limit ?? 800))
  }

  /**
   * 按条件过滤，供快照与推送共用。
   * @param {object[]} lines - 待过滤记录。
   * @param {{ minLevel?: string, keyword?: string, onlyCrash?: boolean, sinceSeq?: number }} filter
   * @returns {object[]}
   */
  #filtered(lines, filter) {
    const ranks = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5 }
    const min = ranks[filter.minLevel ?? 'V'] ?? 0
    const keyword = (filter.keyword ?? '').trim().toLowerCase()
    const sinceSeq = filter.sinceSeq
    const out = []
    for (const line of lines) {
      if (sinceSeq !== undefined && line.seq <= sinceSeq) continue
      if (filter.onlyCrash === true && line.crash !== true) continue
      if (line.kind === 'line' && (ranks[line.level] ?? 0) < min) continue
      if (keyword.length > 0) {
        /* 关键词匹配 tag 与正文，任何一段命中即算。 */
        const hay = `${line.tag ?? ''} ${line.message ?? line.raw ?? ''}`.toLowerCase()
        if (!hay.includes(keyword)) continue
      }
      out.push(line)
    }
    return out
  }

  /**
   * 订阅新行。首个订阅者会启动 adb 进程。
   * @param {(batch: { lines: object[], dropped: number }) => void} onBatch - 批量回调，最多每 250ms 一次。
   * @param {(error: Error) => void} [onError] - 进程异常回调。
   * @returns {() => void} 取消订阅；最后一个退订时停止进程。
   */
  subscribe(onBatch, onError) {
    const entry = { onBatch, onError }
    this.#subscribers.add(entry)
    this.#start()
    return () => {
      this.#subscribers.delete(entry)
      if (this.#subscribers.size === 0) this.stop()
    }
  }

  /** 清空缓冲。 */
  clear() {
    this.#buffer = []
    this.#pending = []
    this.#dropped = 0
  }

  /** 停止采集并清掉计时器。 */
  stop() {
    this.#stopped = true
    if (this.#timer !== undefined) {
      clearInterval(this.#timer)
      this.#timer = undefined
    }
    if (this.#pidTimer !== undefined) {
      clearInterval(this.#pidTimer)
      this.#pidTimer = undefined
    }
    const child = this.#child
    this.#child = undefined
    this.#argKey = undefined
    if (child !== undefined && child.exitCode === null) {
      try { child.kill('SIGKILL') } catch { /* 已退出 */ }
    }
  }

  /** 启动 adb logcat 进程与推送定时器（幂等）。 */
  #start() {
    if (this.#child !== undefined) return
    /* 重新订阅时解除停止标记，允许再次启动。 */
    this.#stopped = false
    if (!SERIAL_PATTERN.test(this.#serial)) {
      this.#lastError = 'invalid serial'
      return
    }
    this.#startedAt = Date.now()
    /* 按 App 过滤时要先解析 pid，这一步是异步的，所以启动链路单独走。 */
    this.#launch().catch((error) => {
      this.#lastError = error instanceof Error ? error.message : String(error)
    })

    this.#timer = setInterval(() => this.#flush(), FLUSH_INTERVAL)
    this.#timer.unref?.()
    /* 每 3 秒核对一次 pid：App 重启（pid 变了）或刚启动（原本没有 pid）时重新接上。
       没有这个，看过一次崩溃重启后日志就永远停了。 */
    this.#pidTimer = setInterval(() => {
      this.#retarget().catch(() => {})
    }, 3000)
    this.#pidTimer.unref?.()
  }

  /**
   * 解析 pid（按包名模式）并拉起 adb logcat。
   * @returns {Promise<void>}
   */
  async #launch() {
    const args = ['-s', this.#serial, 'logcat', '-v', 'threadtime']
    if (this.#packageName !== undefined) {
      const pid = await this.#resolvePid()
      /* 解析 pid 是异步的，期间可能已经被 stop()：
         此时绝不能再起进程，否则会留下无人管理的孤儿。 */
      if (this.#stopped) return
      this.#pid = pid
      if (pid === undefined) {
        /* App 没在跑：先不启动进程，等 #retarget 发现它起来再连。 */
        this.#lastError = `等待 ${this.#packageName} 启动`
        return
      }
      args.push('--pid', String(pid))
    }
    if (this.#stopped) return
    this.#spawnLogcat(args)
  }

  /**
   * 起一条 logcat 子进程并把 stdout 接进入库逻辑。
   * @param {string[]} args - 完整 adb 参数。
   */
  #spawnLogcat(args) {
    const key = args.join(' ')
    if (this.#argKey === key && this.#child !== undefined) return
    this.#argKey = key
    this.#partial = ''
    const child = spawn(this.#adb, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.#child = child

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.#ingest(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      /* stderr 只在进程异常时才有内容，限长避免刷屏。 */
      const text = chunk.toString().slice(0, 500)
      if (text.trim().length > 0) this.#lastError = text.trim()
    })
    child.on('error', (error) => {
      this.#lastError = error.message
      for (const entry of this.#subscribers) {
        try { entry.onError?.(error) } catch { /* 订阅者自身出错忽略 */ }
      }
    })
    child.on('close', () => {
      /* 进程自己退出（设备拔出等）：只清引用，等订阅者退订时收尾。 */
      if (this.#child === child) {
        this.#child = undefined
        this.#argKey = undefined
      }
    })
  }

  /**
   * 查目标包名的 pid。
   * @returns {Promise<number | undefined>}
   */
  async #resolvePid() {
    const pkg = this.#packageName
    if (pkg === undefined) return undefined
    const text = await new Promise((resolve) => {
      const child = spawn(this.#adb, ['-s', this.#serial, 'shell', 'pidof', pkg], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      let out = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        if (out.length < 200) out += chunk
      })
      const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* 已退出 */ } resolve('') }, 5000)
      timer.unref?.()
      child.on('error', () => { clearTimeout(timer); resolve('') })
      child.on('close', () => { clearTimeout(timer); resolve(out) })
    })
    const first = text.trim().split(/\s+/)[0]
    const pid = Number(first)
    return Number.isFinite(pid) && pid > 0 ? pid : undefined
  }

  /**
   * 核对 pid 是否仍然有效，变了就换一条 pid 重新连。
   * @returns {Promise<void>}
   */
  async #retarget() {
    if (this.#packageName === undefined) {
      /* 全量模式：进程没了就重开。 */
      if (this.#child === undefined) await this.#launch()
      return
    }
    const pid = await this.#resolvePid()
    if (pid === this.#pid && this.#child !== undefined) return
    /* pid 变化或进程不存在：先停旧的，再按新 pid 重连。 */
    this.#pid = pid
    const old = this.#child
    this.#child = undefined
    this.#argKey = undefined
    if (old !== undefined && old.exitCode === null) {
      try { old.kill('SIGKILL') } catch { /* 已退出 */ }
    }
    if (pid === undefined) {
      this.#lastError = `等待 ${this.#packageName} 启动`
      return
    }
    await this.#launch()
  }

  /**
   * 切换过滤目标。
   * @param {string | undefined} packageName - undefined 表示全量。
   * @returns {Promise<void>}
   */
  async setPackage(packageName) {
    const next = typeof packageName === 'string' && packageName.length > 0 ? packageName : undefined
    /* 目标没变且已经在采集：直接返回。
       注意这里必须同时判断「是否在跑」——构造时包名可能就已设好，
       但进程还没起来，此时不能因为同名就跳过启动。 */
    if (next === this.#packageName && this.#child !== undefined) return
    if (next !== this.#packageName) {
      this.#packageName = next
      this.#pid = undefined
      const old = this.#child
      this.#child = undefined
      this.#argKey = undefined
      if (old !== undefined && old.exitCode === null) {
        try { old.kill('SIGKILL') } catch { /* 已退出 */ }
      }
      /* 换目标等于换了日志来源，旧缓冲继续留着会混淆两边的行。 */
      this.clear()
      this.#lastError = undefined
    }
    /* 切换目标本身就该把采集跑起来：面板在切包名时通常已经连着流，
       但状态查询、补拉这些路径也可能先进来，必须保证定时器在位。 */
    if (this.#timer === undefined) {
      this.#timer = setInterval(() => this.#flush(), FLUSH_INTERVAL)
      this.#timer.unref?.()
    }
    if (this.#pidTimer === undefined) {
      this.#pidTimer = setInterval(() => { this.#retarget().catch(() => {}) }, 3000)
      this.#pidTimer.unref?.()
    }
    await this.#launch()
  }

  /**
   * 把新到的文本切成完整行并入库。
   * @param {string} chunk - stdout 片段。
   */
  #ingest(chunk) {
    const text = this.#partial + chunk
    const parts = text.split('\n')
    /* 最后一段可能是不完整的行，留到下次拼接。 */
    this.#partial = parts.pop() ?? ''
    /* 极端情况下单行超长（无换行的 crash dump），截断避免无限增长。 */
    if (this.#partial.length > 64 * 1024) this.#partial = this.#partial.slice(-64 * 1024)

    for (const line of parts) {
      if (line.length === 0) continue
      this.#seq += 1
      this.#totalLines += 1
      const record = parseLine(line, this.#seq)
      this.#buffer.push(record)
      this.#pending.push(record)
    }
    /* 环形缓冲按行数封顶。 */
    if (this.#buffer.length > RING_SIZE) {
      const overflow = this.#buffer.length - RING_SIZE
      this.#buffer.splice(0, overflow)
      this.#dropped += overflow
    }
  }

  /** 定时把待推送行批量发给订阅者。 */
  #flush() {
    if (this.#pending.length === 0) return
    /* 一次积压太多时只送最新的，避免把浏览器压垮。 */
    let batch = this.#pending
    if (batch.length > FLUSH_BATCH) batch = batch.slice(-FLUSH_BATCH)
    this.#pending = []
    for (const entry of this.#subscribers) {
      try {
        entry.onBatch({ lines: batch, dropped: this.#dropped })
      } catch (error) {
        try { entry.onError?.(error) } catch { /* 忽略 */ }
      }
    }
  }
}
