/**
 * 抓帧主循环：把设备画面以固定节奏抓成 JPEG，供 multipart 推送。
 *
 * 这是 scrcpy H.264 通道尚未接通前的第一版画面来源，也是 scrcpy 起不来时
 * 的降级路径。设计上刻意保守：
 *   - 没人看（没有订阅者）时一张都不抓，面板关掉就完全静止；
 *   - 单帧失败不终止循环，只记录错误并由状态接口暴露；
 *   - 默认 4 fps，因为每帧都是一次完整 screencap，太快会拖慢设备。
 *
 * @module dsh-android-mirror-pane/frame-loop
 */

import { spawn } from 'node:child_process'
import { capturePng, screenSize } from './adb.js'

/** 默认抓帧节奏（帧/秒）。 */
const DEFAULT_FPS = 4

/**
 * 把 PNG 转成较小的 JPEG，减少面板带宽与解码压力。
 * ffmpeg 不可用时原样返回 PNG，由客户端按 content-type 自行处理。
 * @param {Buffer} png - 原始 PNG。
 * @param {string | undefined} ffmpeg - ffmpeg 路径；undefined 表示跳过转码。
 * @param {number} maxWidth - 目标最大宽度。
 * @returns {Promise<{ body: Buffer, mime: string }>}
 */
export function transcodeFrame(png, ffmpeg, maxWidth = 720) {
  if (ffmpeg === undefined) return Promise.resolve({ body: png, mime: 'image/png' })
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, [
      '-v', 'error',
      '-f', 'png_pipe', '-i', 'pipe:0',
      '-vf', `scale=${maxWidth}:-2:flags=fast_bilinear`,
      '-q:v', '6',
      '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    let failed = false
    let timer
    const finish = (result) => {
      clearTimeout(timer)
      resolve(result)
    }
    timer = setTimeout(() => {
      failed = true
      child.kill('SIGKILL')
      finish({ body: png, mime: 'image/png' })
    }, 5000)
    timer.unref?.()
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.stderr.on('data', () => {})
    child.on('error', () => {
      failed = true
      finish({ body: png, mime: 'image/png' })
    })
    child.on('close', (code) => {
      if (failed) return
      const body = Buffer.concat(chunks)
      if (code !== 0 || body.length === 0) {
        finish({ body: png, mime: 'image/png' })
        return
      }
      finish({ body, mime: 'image/jpeg' })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(png)
  })
}

/**
 * 抓帧循环。每个订阅者拿到同一个最新帧，不会重复抓屏。
 */
export class FrameLoop {
  #fps
  #ffmpeg
  #adb
  #serial
  #subscribers = new Set()
  #timer
  #running = false
  #latest
  #lastError
  #size
  #busy = false

  /**
   * @param {{ adb: string, serial: string, fps?: number, ffmpeg?: string }} options
   */
  constructor(options) {
    this.#adb = options.adb
    this.#serial = options.serial
    this.#fps = clampFps(options.fps)
    this.#ffmpeg = options.ffmpeg
  }

  /** 当前已知屏幕尺寸；未取到时为 undefined。 */
  get size() {
    return this.#size
  }

  /** 最近一次失败原因；成功后清空。 */
  get lastError() {
    return this.#lastError
  }

  /** 是否正在抓帧。 */
  get running() {
    return this.#running
  }

  /** 当前订阅者数量。 */
  get subscriberCount() {
    return this.#subscribers.size
  }

  /**
   * 注册一个订阅者并启动循环。
   * @param {(frame: { body: Buffer, mime: string, at: number }) => void} onFrame - 新帧回调。
   * @param {() => void} [onError] - 循环内错误回调。
   * @returns {() => void} 取消订阅；最后一个订阅者退订时循环停止。
   */
  subscribe(onFrame, onError) {
    const entry = { onFrame, onError }
    this.#subscribers.add(entry)
    this.#start()
    return () => {
      this.#subscribers.delete(entry)
      if (this.#subscribers.size === 0) this.stop()
    }
  }

  /**
   * 立即抓一帧（不经过循环），用于首帧快速出图与手动截图。
   * @returns {Promise<{ body: Buffer, mime: string, at: number }>}
   */
  async grabOnce() {
    const png = await capturePng(this.#adb, this.#serial)
    if (this.#size === undefined) {
      try {
        this.#size = await screenSize(this.#adb, this.#serial)
      } catch {
        /* 尺寸拿不到不影响出图，注入时再降级处理。 */
      }
    }
    const frame = await transcodeFrame(png, this.#ffmpeg)
    const snapshot = { ...frame, at: Date.now() }
    this.#latest = snapshot
    return snapshot
  }

  /** 停止循环并清空状态。 */
  stop() {
    this.#running = false
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer)
      this.#timer = undefined
    }
  }

  /** 启动循环；已有循环时不重复启动。 */
  #start() {
    if (this.#running) return
    this.#running = true
    this.#tick()
  }

  /** 一次抓帧，然后用 setTimeout 排下一次，避免抓帧慢时堆叠。 */
  async #tick() {
    if (!this.#running) return
    const interval = Math.max(50, Math.round(1000 / this.#fps))
    let delay = interval
    if (!this.#busy) {
      this.#busy = true
      const startedAt = Date.now()
      try {
        const snapshot = await this.grabOnce()
        this.#lastError = undefined
        for (const entry of this.#subscribers) {
          try {
            entry.onFrame(snapshot)
          } catch (error) {
            /* 单个订阅者出错不能影响其他订阅者。 */
            entry.onError?.(error)
          }
        }
        /* 按目标节奏补齐：抓帧本身已经花掉一部分时间，
           再固定等一个完整间隔就会把实际帧率压到 1/(抓帧+间隔)。
           这里只补差值，抓帧比间隔还慢时立即抓下一帧。 */
        delay = Math.max(0, interval - (Date.now() - startedAt))
      } catch (error) {
        this.#lastError = error instanceof Error ? error.message : String(error)
        for (const entry of this.#subscribers) {
          try {
            entry.onError?.(error)
          } catch {
            /* 忽略订阅者的二次错误。 */
          }
        }
        /* 失败后退避，避免设备离线时疯狂重试。 */
        delay = Math.max(interval, 1000)
      } finally {
        this.#busy = false
      }
    }
    if (!this.#running) return
    this.#timer = setTimeout(() => {
      this.#tick().catch(() => {})
    }, delay)
    this.#timer.unref?.()
  }
}

/**
 * 把任意输入夹到合理的帧率区间。
 * @param {unknown} value - 原始值。
 * @returns {number}
 */
function clampFps(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_FPS
  return Math.max(1, Math.min(15, Math.round(numeric)))
}
