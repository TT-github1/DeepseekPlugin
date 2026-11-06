/**
 * 面向 agent 的工具：让模型自己看屏幕、读日志、动手操作。
 *
 * 这是插件从「人看人操作」扩展成「人机共用」的那一层。三段能力：
 *
 *   - `android_screenshot` 抓一帧并**把图像真正交给模型**（image block），
 *     于是模型能直接看到界面，而不只是拿到一个文件路径；
 *   - `android_logcat` 读最近日志，可按级别、关键词、只取崩溃过滤；
 *   - `android_tap` / `android_swipe` / `android_key` 动手操作设备。
 *
 * 图像投递沿用 DSH 自己的规范（与 `dsh-tool-fs` 的 `read_image` 完全一致）：
 * 字节先存进 attachments 服务，工具结果的 `render` 返回
 * `[{type:'text'}, {type:'image', attachment}]`。这条链路任一环不可用
 * （没有 attachment 服务、模型不支持图像输入）就降级为纯文本摘要，
 * 绝不因此报错——文本摘要本身仍然有用。
 *
 * @module dsh-android-mirror-pane/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { capturePng, injectAction, screenSize, listDevices, SERIAL_PATTERN } from './adb.js'

/** 截图存储目录：放在 DSH home 下，重启后仍可回看。 */
const SHOT_DIR = 'android-mirror-pane/shots'

/**
 * 判断当前调用路由的模型是否声明支持图像输入。
 *
 * 拿不到就当作不支持：宁可少给图，也不要在纯文本模型上塞一个它读不了的块。
 *
 * @param {any} ctx - cordis 上下文。
 * @param {any} exec - 工具执行上下文。
 * @returns {Promise<boolean>}
 */
async function routeAcceptsImages(ctx, exec) {
  try {
    const llm = ctx.get?.('llm')
    if (llm === undefined) return false
    const header = exec?.agent?.session?.requestHeader?.()
    const config = header?.config ?? exec?.agent?.options ?? {}
    const provider = config.provider
    const model = config.model
    if (typeof provider !== 'string' || typeof model !== 'string') return false
    const info = await llm.resolveModelInfo(provider, model, exec?.signal)
    return Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')
  } catch {
    return false
  }
}

/**
 * 把 PNG 字节存进附件库，返回可供 image block 使用的引用。
 * @param {any} ctx
 * @param {Buffer} bytes
 * @param {string} name
 * @returns {Promise<object | undefined>}
 */
async function stashImage(ctx, bytes, name) {
  const attachments = ctx.get?.('attachments')
  if (attachments === undefined) return undefined
  try {
    const ref = await attachments.saveImage({ data: bytes, mediaType: 'image/png', name })
    if (ref === undefined) return undefined
    return {
      attachmentId: ref.attachmentId,
      mediaType: ref.mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
      ...(ref.name === undefined ? {} : { name: ref.name }),
    }
  } catch {
    /* 附件库写失败不该让截图工具整体失败，降级为纯文本摘要。 */
    return undefined
  }
}

/**
 * 从 PNG 头部读出宽高，避免为了报个尺寸再去解码整张图。
 * @param {Buffer} png
 * @returns {{ width: number, height: number } | undefined}
 */
export function pngSize(png) {
  if (png.length < 24) return undefined
  if (png[0] !== 0x89 || png[1] !== 0x50) return undefined
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/**
 * 注册全部工具。
 *
 * @param {any} ctx - cordis 上下文。
 * @param {{ adb: string, serial?: string, service: any }} deps
 *   - service 是 MirrorService，用来共享设备选择与日志采集，避免两套 adb 进程。
 * @returns {void}
 */
export function registerTools(ctx, deps) {
  const { adb, service } = deps

  /** 取当前设备序列号；拿不到就抛一条能自救的错误。 */
  const requireSerial = async () => {
    const serial = service.serial ?? (await service.ensureDeviceForTool?.())
    if (serial === undefined) {
      throw new Error('没有可用的安卓设备：请确认 USB 已连接，且手机上已允许 USB 调试（adb devices 能看到 device 状态）')
    }
    return serial
  }

  /* ── 截图：把界面交给模型看 ── */
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'android_screenshot',
    description: [
      '抓取这台安卓设备当前的屏幕，并**把画面作为图片直接返回**，让你自己看到界面长什么样。',
      '排查 UI 问题、确认改动是否生效、看清报错弹窗时用它，比让用户手动截图发给你快得多。',
      '只看文字类状态（某段文字在不在、列表有几行）时，先考虑 android_logcat，成本更低。',
    ].join(' '),
    parameters: {
      save: {
        type: 'boolean',
        description: '是否把这一帧另存到 DSH home 下长期保留；默认 false，只用于本次查看。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          serial: { type: 'string', required: true, description: '设备序列号。' },
          width: { type: 'integer', description: '画面像素宽。' },
          height: { type: 'integer', description: '画面像素高。' },
          bytes: { type: 'integer', description: '图片字节数。' },
          savedPath: { type: 'string', description: '另存时的绝对路径；未另存则没有此项。' },
          image: {
            type: 'object',
            additionalProperties: false,
            description: '图像附件引用；仅在模型支持图像输入时出现。',
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => {
        const parts = [{
          type: 'text',
          text: value.image === undefined
            ? `已抓取 ${value.serial} 的屏幕：${value.width ?? '?'}x${value.height ?? '?'}，${value.bytes} 字节。当前模型不接受图像输入，因此只给出摘要。`
            : `已抓取 ${value.serial} 的屏幕：${value.width}x${value.height}，${value.bytes} 字节。`,
        }]
        if (value.image !== undefined) parts.push({ type: 'image', attachment: value.image })
        return parts
      },
      presentationMeta: (_args, value) => ({ serial: value.serial, width: value.width, height: value.height }),
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const serial = await requireSerial()
      const png = await capturePng(adb, serial)
      const size = pngSize(png)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const name = `android-${serial}-${stamp}.png`
      let savedPath
      if (args.save === true) {
        const dir = await service.shotDirectory?.()
        if (dir !== undefined) {
          const { writeFile } = await import('node:fs/promises')
          const { join } = await import('node:path')
          savedPath = join(dir, name)
          await writeFile(savedPath, png)
        }
      }
      const image = await stashImage(ctx, png, name)
      return {
        serial,
        ...(size === undefined ? {} : { width: size.width, height: size.height }),
        bytes: png.length,
        ...(savedPath === undefined ? {} : { savedPath }),
        ...(image === undefined ? {} : { image }),
      }
    },
    presentCall: () => ({ card: 'generic', title: '抓取安卓屏幕', kind: 'read' }),
  })), 'android-mirror-pane: 截图工具')

  /* ── 读日志 ── */
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'android_logcat',
    description: [
      '读取这台安卓设备的日志（默认只读当前前台 App，与你日常看日志的口径一致）。',
      '报错排查顺序建议：先 onlyCrash 或 minLevel=W 看有没有异常，再放宽到 V 看上下文。',
      '返回按时间排序的文本行，每行「时间 级别 tag: 正文」。行数很多时用 keyword 收窄，不要一次要几千行。',
    ].join(' '),
    parameters: {
      minLevel: {
        type: 'string',
        description: '最低级别：V/D/I/W/E/F，默认 V（全部）。',
      },
      keyword: {
        type: 'string',
        description: '只看包含这段文字的日志（匹配 tag 与正文，不区分大小写）。',
      },
      onlyCrash: {
        type: 'boolean',
        description: '只返回崩溃与 ANR 相关行，排查闪退时先用它。',
      },
      limit: {
        type: 'integer',
        description: '最多返回多少行，默认 200，上限 2000。',
      },
      packageName: {
        type: 'string',
        description: '指定要采集哪个应用的日志；不传则沿用面板当前的选择。传空字符串表示全量日志。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lines: { type: 'integer', required: true, description: '实际返回的行数。' },
          total: { type: 'integer', description: '采集器累计收到的行数。' },
          dropped: { type: 'integer', description: '因缓冲上限被丢弃的行数。' },
          packageName: { type: 'string', description: '当前采集的目标包名；全量模式没有此项。' },
          text: { type: 'string', required: true, description: '日志正文，每行一条。' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.text.length === 0 ? `（没有匹配的日志；累计采集 ${value.total ?? 0} 行）` : value.text,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const serial = await requireSerial()
      /* 允许临时切换采集目标，切完保留，方便连续几次都在同一口径下看。 */
      if (typeof args.packageName === 'string') {
        await service.setLogcatPackage?.(serial, args.packageName.trim() === '' ? undefined : args.packageName.trim())
      }
      const limit = Number.isFinite(Number(args.limit)) ? Math.max(1, Math.min(2000, Number(args.limit))) : 200
      const result = service.readLogcat?.({
        limit,
        minLevel: typeof args.minLevel === 'string' ? args.minLevel.toUpperCase().slice(0, 1) : undefined,
        keyword: typeof args.keyword === 'string' ? args.keyword : undefined,
        onlyCrash: args.onlyCrash === true,
      }) ?? { lines: [], total: 0, dropped: 0 }
      /* 把结构化行压成一行一条的文本，模型读起来最省 token。 */
      const text = result.lines
        .map((line) => line.kind === 'section'
          ? line.text
          : `${line.time ?? ''} ${line.level ?? ''} ${line.tag ?? ''}: ${line.message ?? line.raw ?? ''}`)
        .join('\n')
      return {
        lines: result.lines.length,
        ...(result.total === undefined ? {} : { total: result.total }),
        ...(result.dropped === undefined ? {} : { dropped: result.dropped }),
        ...(result.packageName === undefined ? {} : { packageName: result.packageName }),
        text,
      }
    },
    presentCall: () => ({ card: 'generic', title: '读取安卓日志', kind: 'read' }),
  })), 'android-mirror-pane: 日志工具')

  /* ── 操作：点击与滑动 ── */
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'android_tap',
    description: [
      '点击安卓屏幕上的一个位置。坐标是**归一化的 0..1**（左上角为 0,0，右下角为 1,1），',
      '这样不受分辨率与横竖屏影响。先用 android_screenshot 看清界面，再算坐标。',
    ].join(' '),
    parameters: {
      x: { type: 'number', required: true, description: '横向位置，0（最左）到 1（最右）。' },
      y: { type: 'number', required: true, description: '纵向位置，0（最上）到 1（最下）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          serial: { type: 'string', required: true },
        },
      },
      render: () => [{ type: 'text', text: '已点击。如果界面没变化，先重新截图确认目标位置。' }],
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const serial = await requireSerial()
      const size = await service.screenSizeForTool?.() ?? await screenSize(adb, serial)
      await injectAction(adb, serial, size, { action: 'tap', x: args.x, y: args.y })
      return { ok: true, serial }
    },
    presentCall: (args) => ({ card: 'generic', title: `点击 (${args.x}, ${args.y})`, kind: 'write' }),
  })), 'android-mirror-pane: 点击工具')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'android_swipe',
    description: '从一点滑到另一点（归一化 0..1 坐标），常用于滚动列表、拖动滑块、下拉刷新。',
    parameters: {
      x1: { type: 'number', required: true, description: '起点横向 0..1。' },
      y1: { type: 'number', required: true, description: '起点纵向 0..1。' },
      x2: { type: 'number', required: true, description: '终点横向 0..1。' },
      y2: { type: 'number', required: true, description: '终点纵向 0..1。' },
      durationMs: { type: 'integer', description: '滑动耗时，默认 200 毫秒；越快越像甩动。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          serial: { type: 'string', required: true },
        },
      },
      render: () => [{ type: 'text', text: '已滑动。需要确认结果就再截一张图。' }],
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const serial = await requireSerial()
      const size = await service.screenSizeForTool?.() ?? await screenSize(adb, serial)
      await injectAction(adb, serial, size, {
        action: 'swipe',
        x1: args.x1,
        y1: args.y1,
        x2: args.x2,
        y2: args.y2,
        durationMs: args.durationMs,
      })
      return { ok: true, serial }
    },
    presentCall: (args) => ({ card: 'generic', title: `滑动 (${args.x1}, ${args.y1}) → (${args.x2}, ${args.y2})`, kind: 'write' }),
  })), 'android-mirror-pane: 滑动工具')

  /* ── 设备列表：多设备时先确认操作对象 ── */
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'android_devices',
    description: '列出当前通过 adb 连接的安卓设备（serial、状态、型号）。多台设备时先调它确认要操作哪一台。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          current: { type: 'string', description: '面板当前选中的设备序列号。' },
          devices: {
            type: 'array',
            required: true,
            description: '所有已连接的设备。',
          },
          text: { type: 'string', required: true, description: '人读摘要。' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    isConcurrencySafe: () => true,
    async execute() {
      const devices = await listDevices(adb)
      const text = devices.length === 0
        ? '没有检测到任何设备。请连接 USB 并在手机上允许 USB 调试。'
        : devices.map((d) => `${d.serial}  ${d.state}  ${d.model ?? ''}`).join('\n')
      return {
        ...(service.serial === undefined ? {} : { current: service.serial }),
        devices: devices.map((d) => ({ serial: d.serial, state: d.state, model: d.model ?? null })),
        text,
      }
    },
    presentCall: () => ({ card: 'generic', title: '列出安卓设备', kind: 'read' }),
  })), 'android-mirror-pane: 设备列表工具')
}
