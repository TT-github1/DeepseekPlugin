/**
 * adb 访问层：定位 adb、解析设备列表、取单帧、注入输入。
 *
 * 所有对外入口都只接受已校验的 serial（见 SERIAL_PATTERN），避免把
 * 外部字符串拼进命令行。子进程一律用参数数组形式，不经过 shell。
 *
 * @module dsh-android-mirror-pane/adb
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** adb serial 的保守白名单：USB 序列号、emulator-5554、含点冒号下划线的厂商序列。 */
export const SERIAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

/** 单条 adb 命令的默认超时；截图和 dump 在慢设备上可能到数秒。 */
const DEFAULT_TIMEOUT_MS = 15_000

/**
 * 按优先级找一个可用的 adb：显式配置 → ANDROID_SDK_ROOT → ANDROID_HOME →
 * 常见 SDK 安装位置 → PATH。
 * @param {string | undefined} configured - config 里显式给出的路径。
 * @returns {string} 可执行文件路径或裸名 `adb`（交给 PATH 解析）。
 */
export function resolveAdb(configured) {
  if (typeof configured === 'string' && configured.length > 0) return configured
  const candidates = []
  for (const envName of ['ANDROID_SDK_ROOT', 'ANDROID_HOME']) {
    const root = process.env[envName]
    if (root) candidates.push(join(root, 'platform-tools', 'adb'))
  }
  candidates.push(join(homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'))
  candidates.push(join(homedir(), 'Android', 'Sdk', 'platform-tools', 'adb'))
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return 'adb'
}

/**
 * 跑一条 adb 命令并收集 stdout 字节。
 * @param {string} adb - adb 路径。
 * @param {readonly string[]} args - 参数数组（不含 adb 自身）。
 * @param {{ timeoutMs?: number, maxBytes?: number }} [options] - 超时与输出上限。
 * @returns {Promise<Buffer>} stdout 原始字节。
 */
export function adbBytes(adb, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024
  return new Promise((resolve, reject) => {
    const child = spawn(adb, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = []
    let size = 0
    let stderr = ''
    let settled = false
    /* stdout 是二进制（截图），不能设 encoding。 */
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`adb ${args[0]} 超时 ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref?.()
    child.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          child.kill('SIGKILL')
          reject(new Error(`adb ${args[0]} 输出超过 ${maxBytes} 字节`))
        }
        return
      }
      chunks.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      /* stderr 只用于报错信息，限长避免刷爆内存。 */
      if (stderr.length < 4096) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`adb ${args.join(' ')} 失败 (${code}): ${stderr.trim() || '无输出'}`))
        return
      }
      resolve(Buffer.concat(chunks))
    })
  })
}

/**
 * 跑一条 adb 命令并返回 utf8 文本。
 * @param {string} adb - adb 路径。
 * @param {readonly string[]} args - 参数数组。
 * @param {{ timeoutMs?: number }} [options] - 超时。
 * @returns {Promise<string>} 去尾空白的 stdout。
 */
export async function adbText(adb, args, options = {}) {
  const bytes = await adbBytes(adb, args, options)
  return bytes.toString('utf8').trim()
}

/**
 * 列出当前设备。
 * @param {string} adb - adb 路径。
 * @returns {Promise<Array<{ serial: string, state: string, model?: string, product?: string, transportId?: string }>>}
 */
export async function listDevices(adb) {
  const text = await adbText(adb, ['devices', '-l'])
  const devices = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('List of devices')) continue
    /* 形如：3053399274005VM device usb:1-1 product:PD2055 model:V2055A device:PD2055 transport_id:6 */
    const match = /^(\S+)\s+(\S+)(.*)$/.exec(trimmed)
    if (match === null) continue
    const [, serial, state, rest] = match
    if (!SERIAL_PATTERN.test(serial)) continue
    const fields = Object.create(null)
    for (const token of rest.trim().split(/\s+/)) {
      const separator = token.indexOf(':')
      if (separator <= 0) continue
      fields[token.slice(0, separator)] = token.slice(separator + 1)
    }
    devices.push({
      serial,
      state,
      model: fields.model,
      product: fields.product,
      transportId: fields.transport_id,
    })
  }
  return devices
}

/**
 * 选一台可用设备：显式 serial 优先，其次 ANDROID_SERIAL，最后第一台 online 设备。
 * @param {string} adb - adb 路径。
 * @param {string | undefined} preferred - config / 调用方指定的 serial。
 * @returns {Promise<{ serial: string, devices: Array<object> } | { serial: undefined, devices: Array<object> }>}
 */
export async function pickDevice(adb, preferred) {
  const devices = await listDevices(adb)
  const online = devices.filter((device) => device.state === 'device')
  const want = preferred ?? process.env.ANDROID_SERIAL
  if (typeof want === 'string' && want.length > 0) {
    const hit = online.find((device) => device.serial === want)
    if (hit !== undefined) return { serial: hit.serial, devices }
    return { serial: undefined, devices }
  }
  return { serial: online[0]?.serial, devices }
}

/**
 * 抓一帧 PNG。
 * @param {string} adb - adb 路径。
 * @param {string} serial - 已校验的设备序列号。
 * @returns {Promise<Buffer>} PNG 字节。
 */
export async function capturePng(adb, serial) {
  if (!SERIAL_PATTERN.test(serial)) throw new Error('invalid serial')
  const bytes = await adbBytes(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { timeoutMs: 20_000 })
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
    throw new Error('screencap 返回的不是 PNG')
  }
  return bytes
}

/**
 * 抓一帧原始 RGBA 像素（`screencap` 裸格式）。
 *
 * 比 PNG 路径快约一倍：PNG 压缩在设备端要花掉大部分时间，而裸格式的
 * 10MB 走 USB 只需几百毫秒，转码交给本机 ffmpeg 更划算。
 * 前 12 字节是 `width(u32le) height(u32le) format(u32le)` 头，随后是
 * 紧排的 RGBA 像素。
 *
 * @param {string} adb - adb 路径。
 * @param {string} serial - 设备序列号。
 * @returns {Promise<{ width: number, height: number, pixels: Buffer }>}
 */
export async function captureRaw(adb, serial) {
  if (!SERIAL_PATTERN.test(serial)) throw new Error('invalid serial')
  const bytes = await adbBytes(adb, ['-s', serial, 'exec-out', 'screencap'], { timeoutMs: 20_000 })
  if (bytes.length < 13) throw new Error('screencap 原始输出过短')
  const width = bytes.readUInt32LE(0)
  const height = bytes.readUInt32LE(4)
  if (width === 0 || height === 0 || bytes.length < 12 + width * height * 4) {
    throw new Error(`screencap 原始尺寸异常: ${width}x${height}, 收到 ${bytes.length} 字节`)
  }
  return { width, height, pixels: bytes.subarray(12) }
}

/**
 * 取屏幕尺寸。
 * @param {string} adb - adb 路径。
 * @param {string} serial - 设备序列号。
 * @returns {Promise<{ width: number, height: number }>}
 */
export async function screenSize(adb, serial) {
  if (!SERIAL_PATTERN.test(serial)) throw new Error('invalid serial')
  const text = await adbText(adb, ['-s', serial, 'shell', 'wm', 'size'])
  /* 可能有两行（Override / Physical），取最后一个有效值。 */
  const matches = [...text.matchAll(/(\d+)x(\d+)/g)]
  const last = matches.at(-1)
  if (last === undefined) throw new Error(`无法解析屏幕尺寸: ${text.slice(0, 200)}`)
  return { width: Number(last[1]), height: Number(last[2]) }
}

/**
 * 注入输入事件。坐标是归一化的 0..1，按当前屏幕尺寸换算成像素，
 * 这样面板缩放、横竖屏切换都不需要客户端关心真实分辨率。
 * @param {string} adb - adb 路径。
 * @param {string} serial - 设备序列号。
 * @param {{ width: number, height: number }} size - 当前屏幕像素尺寸。
 * @param {object} action - 动作描述，见 index.js 的 /control 约定。
 * @returns {Promise<void>}
 */
export async function injectAction(adb, serial, size, action) {
  if (!SERIAL_PATTERN.test(serial)) throw new Error('invalid serial')
  const px = (x) => Math.max(0, Math.min(size.width - 1, Math.round(x * size.width)))
  const py = (y) => Math.max(0, Math.min(size.height - 1, Math.round(y * size.height)))

  switch (action.action) {
    case 'tap': {
      await adbText(adb, ['-s', serial, 'shell', 'input', 'tap', String(px(action.x)), String(py(action.y))])
      return
    }
    case 'drag': {
      const duration = clampInt(action.durationMs, 16, 5000, 200)
      await adbText(adb, [
        '-s', serial, 'shell', 'input', 'swipe',
        String(px(action.x1)), String(py(action.y1)),
        String(px(action.x2)), String(py(action.y2)),
        String(duration),
      ])
      return
    }
    case 'swipe': {
      /* 与 drag 同义，保留独立名字给滚轮映射用。 */
      const duration = clampInt(action.durationMs, 16, 5000, 120)
      await adbText(adb, [
        '-s', serial, 'shell', 'input', 'swipe',
        String(px(action.x1)), String(py(action.y1)),
        String(px(action.x2)), String(py(action.y2)),
        String(duration),
      ])
      return
    }
    case 'key': {
      const code = String(action.key);
      if (!/^[A-Z0-9_]{1,40}$/.test(code)) throw new Error('invalid key code')
      await adbText(adb, ['-s', serial, 'shell', 'input', 'keyevent', code])
      return
    }
    case 'text': {
      const text = String(action.text ?? '');
      if (text.length === 0 || text.length > 2000) throw new Error('invalid text')
      /* input text 把空格当参数分隔，必须先转义。 */
      const escaped = text.replace(/([\\()<>|;&*~^"'`$#!{}\[\]])/g, '\\$1').replace(/ /g, '%s')
      await adbText(adb, ['-s', serial, 'shell', 'input', 'text', escaped])
      return
    }
    default:
      throw new Error(`未知动作: ${String(action.action)}`)
  }
}

/**
 * 把任意输入夹到整数区间。
 * @param {unknown} value - 原始值。
 * @param {number} min - 下界。
 * @param {number} max - 上界。
 * @param {number} fallback - 非法时取值。
 * @returns {number}
 */
function clampInt(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, Math.round(numeric)))
}
