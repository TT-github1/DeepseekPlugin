/**
 * 面向 agent 的工具：让模型自己看屏幕、读日志、动手操作。
 *
 * 这是插件从「人看人操作」扩展成「人机共用」的那一层。三段能力：
 *
 *   - `android_screenshot` 抓一帧并**把图像真正交给模型**（image block），
 *     于是模型能直接看到界面，而不只是拿到一个文件路径；
 *   - `android_logcat` 读最近日志，可按级别、关键词、只取崩溃过滤；
 *   - `android_tap` / `android_swipe` / `android_key` 动手操作设备；
 *   - `android_preview_list` / `android_preview_render` 列出并渲染项目里的
 *     Compose `@Preview`，渲染结果同样以 image block 交给模型。
 *
 * 后两个工具背后是 preview 子系统的 `PreviewService`，而它由 `PreviewHub`
 * 按会话分发。`PreviewHub` 在 `index.js` 里创建，本文件不拥有它，所以
 * `registerTools` 新增了一个可选的 `preview` 依赖（实例或 getter 都行）：
 * 没有传就不注册这两个工具，已有的设备工具完全不受影响。
 *
 * 图像投递沿用 DSH 自己的规范（与 `dsh-tool-fs` 的 `read_image` 完全一致）：
 * 字节先存进 attachments 服务，工具结果的 `render` 返回
 * `[{type:'text'}, {type:'image', attachment}]`。这条链路任一环不可用
 * （没有 attachment 服务、模型不支持图像输入）就降级为纯文本摘要，
 * 绝不因此报错——文本摘要本身仍然有用。
 *
 * @module dsh-android-mirror-pane/tools
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { defineTool } from '@deepseek-ai/dsh-tools'
import { capturePng, injectAction, screenSize, listDevices, SERIAL_PATTERN } from './adb.js'

/** 截图存储目录：放在 DSH home 下，重启后仍可回看。 */
const SHOT_DIR = 'android-mirror-pane/shots'

/** 列表一次最多铺多少行。再多就让模型用 module 收窄，而不是灌上百行噪音。 */
const PREVIEW_LIST_LIMIT = 40

/** 等一次渲染的上限。实测 2–8 秒；60 秒是给冷启动 Gradle 留的余量。 */
const PREVIEW_RENDER_TIMEOUT_MS = 60_000

/** 轮询渲染任务的间隔。 */
const PREVIEW_POLL_MS = 400

/** 名称没匹配上或有歧义时，最多列多少条候选。 */
const PREVIEW_CANDIDATE_LIMIT = 8

/** 状态标记：一眼区分已渲染、源码已变、从未渲染、渲染失败。 */
const PREVIEW_STATUS_MARKS = { fresh: '✓', stale: '~', never: '·', error: '✗' }

/**
 * 等一小会儿。轮询渲染任务用它，不引外部依赖。
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * 从工具执行上下文里取当前会话 id。
 *
 * PreviewHub 靠它决定用哪个项目根，取错就会去扫别的仓库，所以逐层兜底而不是
 * 假定只有一个位置。`agent.id` 是 Agent 接口上的正式字段（就是 SessionId），
 * 其余几个是不同宿主版本放过它的地方，按可靠性排在这之后。
 *
 * @param {any} exec - 工具执行上下文。
 * @returns {string | undefined}
 */
function sessionIdOf(exec) {
  const agent = exec?.agent
  const session = agent?.session ?? exec?.session
  const header = session?.header
  const candidates = [
    agent?.id,
    session?.id,
    session?.sessionId,
    header?.id,
    header?.sessionId,
    agent?.sessionId,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/**
 * 把用户写的模块名对到索引里真实的模块路径。
 *
 * 用户常写 `feature/sleep` 而真实路径是 `feature/sleep/impl`，所以精确匹配
 * 之外还做前缀、包含两档；多义就报错让调用方写全，不要瞎猜一个。
 *
 * @param {string[]} modules - 索引里的模块列表。
 * @param {string} wanted - 用户传入的模块名。
 * @returns {{ module?: string, candidates: string[] }}
 */
function resolveModuleFilter(modules, wanted) {
  const normalized = wanted.trim().replace(/^\.?\//, '').replace(/\/+$/, '')
  if (normalized.length === 0) return { candidates: [] }
  if (modules.includes(normalized)) return { module: normalized, candidates: [] }
  const prefixed = modules.filter((module) => module.startsWith(`${normalized}/`) || normalized.startsWith(`${module}/`))
  if (prefixed.length === 1) return { module: prefixed[0], candidates: [] }
  if (prefixed.length > 1) return { candidates: prefixed }
  const loose = modules.filter((module) => module.includes(normalized))
  if (loose.length === 1) return { module: loose[0], candidates: [] }
  if (loose.length > 1) return { candidates: loose }
  return { candidates: [] }
}

/**
 * 按从严到宽的顺序把一个名字对到唯一的 preview。
 *
 * 档位依次是：key → fqn → previewId（函数名）→ title → 后缀 → 包含。
 * 每一档内部只看「命中几个」：恰好一个才算成功，多个就把候选原样交回去，
 * 由调用方拼一条能让模型重试的错误——猜一个渲染出来错的屏比报错糟得多。
 *
 * @param {object[]} entries - `PreviewService.list()` 返回的条目。
 * @param {string} name - 用户传入的名字。
 * @returns {{ kind: 'match', entry: object } | { kind: 'ambiguous', candidates: object[] } | { kind: 'none', candidates: object[] }}
 */
function matchPreviewEntry(entries, name) {
  const wanted = name.trim()
  if (wanted.length === 0) return { kind: 'none', candidates: [] }
  const needle = wanted.toLowerCase()
  /* 索引里这四项理应都在，但历史上换过版本，缺字段不该让整个工具抛错。 */
  const field = (entry, key) => (typeof entry?.[key] === 'string' ? entry[key] : '')
  const lower = (entry, key) => field(entry, key).toLowerCase()
  const tiers = [
    (entry) => field(entry, 'key') === wanted,
    (entry) => field(entry, 'fqn') === wanted,
    (entry) => lower(entry, 'key') === needle || lower(entry, 'fqn') === needle,
    (entry) => field(entry, 'previewId') === wanted,
    (entry) => lower(entry, 'previewId') === needle,
    (entry) => lower(entry, 'title') === needle,
    (entry) => field(entry, 'fqn').endsWith(`.${wanted}`) || field(entry, 'key').endsWith(`::${wanted}`),
    (entry) => lower(entry, 'fqn').endsWith(`.${needle}`) || lower(entry, 'key').endsWith(`::${needle}`),
    (entry) => ['key', 'fqn', 'previewId', 'title'].some((key) => field(entry, key).includes(wanted)),
    (entry) => ['key', 'fqn', 'previewId', 'title'].some((key) => lower(entry, key).includes(needle)),
  ]
  for (const tier of tiers) {
    const hits = entries.filter(tier)
    if (hits.length === 1) return { kind: 'match', entry: hits[0] }
    if (hits.length > 1) return { kind: 'ambiguous', candidates: hits }
  }
  /* 完全没命中：按词重叠给几条「你可能想找的」，别让模型对着空结果猜。 */
  const words = needle.split(/[^a-z0-9]+/).filter((word) => word.length > 1)
  const scored = entries
    .map((entry) => {
      const haystack = `${field(entry, 'key')} ${field(entry, 'title')} ${field(entry, 'previewId')}`.toLowerCase()
      return { entry, score: words.filter((word) => haystack.includes(word)).length }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
  return { kind: 'none', candidates: scored.slice(0, PREVIEW_CANDIDATE_LIMIT).map((item) => item.entry) }
}

/**
 * 把一条 preview 压成一行，供错误信息与列表展示。
 * @param {object} entry
 * @returns {string}
 */
function previewLine(entry) {
  return `${entry.key}（${entry.title}）`
}

/**
 * 从语义树里挑出「有字的节点」，让模型在没有图像能力时也能读懂界面。
 *
 * 只取 text / contentDescription：布局容器没有文字，列出来只会淹没真正要看的
 * 那十几行。按 bounds.top 排一遍更接近人从上往下读的顺序。
 *
 * @param {object | undefined} tree - `readTree()` 的结果。
 * @param {number} [limit] - 最多几条。
 * @returns {{ items: { label: string, kind: string, type?: string }[], more: number }}
 */
function describeTree(tree, limit = 16) {
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : []
  const picked = []
  const seen = new Set()
  for (const node of nodes) {
    const text = typeof node?.text === 'string' && node.text.trim().length > 0 ? node.text.trim() : undefined
    const description = typeof node?.contentDescription === 'string' && node.contentDescription.trim().length > 0
      ? node.contentDescription.trim()
      : undefined
    if (text === undefined && description === undefined) continue
    const kind = text === undefined ? '描述' : '文字'
    const label = text ?? description
    /* 同一个 label 出现两次多半是外层容器复述了内层文本，去重后更好读。 */
    const dedupeKey = `${kind}:${label}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    picked.push({
      label,
      kind,
      ...(typeof node.type === 'string' ? { type: node.type } : {}),
      top: Number(node?.bounds?.top) || 0,
    })
  }
  picked.sort((a, b) => a.top - b.top)
  return {
    items: picked.slice(0, limit).map(({ top, ...rest }) => rest),
    more: Math.max(0, picked.length - limit),
  }
}

/**
 * 等一个渲染任务收尾。
 *
 * 三种结局分开返回，因为它们对调用方意味着不同的事：完成（读图）、超时
 * （还在跑，稍后再查）、被取消（这次请求不要了）。超时不当错误——Gradle
 * 冷启动就是会慢，抛错只会让模型重试出一堆重复任务。
 *
 * @param {any} service - PreviewService。
 * @param {string} jobId
 * @param {{ timeoutMs: number, signal?: AbortSignal }} options
 * @returns {Promise<{ job?: object, timedOut?: boolean, aborted?: boolean }>}
 */
async function pollPreviewJob(service, jobId, options) {
  const deadline = Date.now() + options.timeoutMs
  for (;;) {
    if (options.signal?.aborted === true) return { aborted: true }
    const jobs = typeof service.jobList === 'function' ? service.jobList() : []
    const job = jobs.find((item) => item?.id === jobId)
    if (job !== undefined && job.status !== 'queued' && job.status !== 'running') return { job }
    if (Date.now() >= deadline) return { timedOut: true, job }
    await delay(PREVIEW_POLL_MS)
  }
}

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
 * @param {{ adb: string, serial?: string, service: any, preview?: any }} deps
 *   - service 是 MirrorService，用来共享设备选择与日志采集，避免两套 adb 进程。
 *   - preview 是 `PreviewHub` 实例，或返回它的同步/异步 getter。**可选**：
 *     不传就不注册 preview 两个工具，设备工具照常工作。之所以可选，是为了
 *     让 `index.js` 尚未改动时现有调用依旧成立。
 * @returns {void}
 */
export function registerTools(ctx, deps) {
  const { adb, service } = deps
  const previewSource = deps?.preview

  /**
   * 取当前会话对应的 PreviewService。
   *
   * 每次都重新解析而不是注册时缓存一次：项目根跟着会话工作目录走，用户在
   * 同一个 DSH 里可能刚 `cd` 到另一个安卓仓库。
   *
   * @param {any} exec - 工具执行上下文，用来读会话 id。
   * @returns {Promise<any>}
   */
  const requirePreviewService = async (exec) => {
    let hub = previewSource
    if (typeof hub === 'function') hub = await hub()
    if (hub === undefined || hub === null) {
      throw new Error('预览服务没有接上：插件没有拿到 PreviewHub 实例，因此无法读 @Preview 索引。这是插件装配问题，请让用户检查插件配置，不要重试。')
    }
    const sessionId = sessionIdOf(exec)
    const target = typeof hub.serviceFor === 'function' ? await hub.serviceFor(sessionId) : undefined
    if (target === undefined || target === null) {
      throw new Error('取不到当前会话的预览服务：可能是会话上下文缺失，或没有识别出安卓项目根。请确认当前会话是在一个含 gradlew 的安卓项目里打开的，再重试。')
    }
    return target
  }

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

  /* preview 两个工具只在拿到 PreviewHub 时才注册：老调用方（没传 preview）
     不会突然多出两个永远报错的工具。 */
  if (previewSource === undefined || previewSource === null) return

  /* ── 列 @Preview：只读索引，不触发渲染 ── */
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'android_preview_list',
    description: [
      '列出当前安卓项目里所有 Compose `@Preview`（含每个的渲染状态），**只读索引，不会触发渲染**。',
      '想知道「这个仓库有哪些界面可以看」、或渲染前先确认某个 preview 叫什么时用它；',
      '要看到画面本身请用 android_preview_render。',
      '状态标记：✓ 已渲染可直接看，~ 源码已变需要重渲染，· 从未渲染，✗ 上次渲染失败。',
      '数目多时传 module 收窄（如 `feature/sleep/impl`，也接受 `feature/sleep` 这种前缀）。',
    ].join(' '),
    parameters: {
      module: {
        type: 'string',
        description: '只看某个模块，形如 `feature/account/impl`；可写前缀（`feature/sleep` 会匹配 `feature/sleep/impl`）。不传即全部。',
      },
      staleOnly: {
        type: 'boolean',
        description: '只列「源码已变」（stale）和「从未渲染」（never）的，用来挑出该重渲染的那些。默认 false 列全部。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectRoot: { type: 'string', required: true, description: '当前项目根目录。' },
          total: { type: 'integer', required: true, description: '过滤后命中的 preview 数。' },
          shown: { type: 'integer', required: true, description: '文本里实际列出的条数；小于 total 说明被截断了。' },
          counts: {
            type: 'object',
            additionalProperties: false,
            description: '按状态统计。',
            properties: {
              fresh: { type: 'integer' },
              stale: { type: 'integer' },
              never: { type: 'integer' },
              error: { type: 'integer' },
            },
          },
          text: { type: 'string', required: true, description: '给模型看的紧凑清单，按模块分组。' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const svc = await requirePreviewService(exec)
      const listing = await svc.list()
      /* 索引文件是磁盘上的 JSON，损坏或被旧版本写坏时可能混进 null 之类的东西：
         先过滤成「真条目」，否则下面读 entry.module 会直接把工具搞崩。 */
      const all = (Array.isArray(listing?.entries) ? listing.entries : [])
        .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.key === 'string')
      /* modules 正常由索引给出；万一为空，就从条目里推一遍，免得模块过滤永远匹配不上。 */
      const declaredModules = Array.isArray(listing?.modules) ? listing.modules.filter((item) => typeof item === 'string') : []
      const modules = declaredModules.length > 0
        ? declaredModules
        : [...new Set(all.map((entry) => entry.module).filter((item) => typeof item === 'string'))]

      /* 模块过滤：写错模块名不要静默返回空表，那会让模型以为项目里没有 preview。 */
      let scoped = all
      if (typeof args.module === 'string' && args.module.trim().length > 0) {
        const resolved = resolveModuleFilter(modules, args.module)
        if (resolved.module === undefined) {
          throw new Error(resolved.candidates.length === 0
            ? `没有模块叫「${args.module}」。当前项目的模块是：${modules.join('、') || '（索引为空，可能还没扫描过）'}`
            : `模块名「${args.module}」不唯一，可能是：${resolved.candidates.join('、')}。请写全其中的一个。`)
        }
        scoped = all.filter((entry) => entry.module === resolved.module)
      }
      if (args.staleOnly === true) {
        scoped = scoped.filter((entry) => entry.status === 'stale' || entry.status === 'never')
      }

      if (scoped.length === 0) {
        const reason = all.length === 0
          ? `${listing?.projectRoot ?? '当前目录'} 里还没有任何 @Preview 记录：要么项目里确实没有 @Preview，要么索引还没扫描过（在预览面板点一次「刷新索引」）。`
          : '按当前条件没筛到 preview，去掉 module 或 staleOnly 再试。'
        return {
          projectRoot: String(listing?.projectRoot ?? ''),
          total: 0,
          shown: 0,
          counts: { fresh: 0, stale: 0, never: 0, error: 0 },
          text: reason,
        }
      }

      /* 按模块分组：模块顺序沿用索引给的顺序，组内按标题排，读起来和面板一致。 */
      const groups = new Map()
      for (const entry of scoped) {
        const module = String(entry.module ?? '（未知模块）')
        const bucket = groups.get(module)
        if (bucket === undefined) groups.set(module, [entry])
        else bucket.push(entry)
      }
      const counts = { fresh: 0, stale: 0, never: 0, error: 0 }
      for (const entry of scoped) {
        if (counts[entry.status] !== undefined) counts[entry.status] += 1
      }

      /* 超过上限就不再逐个铺：每组只给前几条，剩下的靠 module 参数收窄。
         不加这段的话，一个 70 个 preview 的仓库会淹没模型上下文。 */
      const truncated = scoped.length > PREVIEW_LIST_LIMIT
      const perModuleCap = truncated ? 5 : Number.POSITIVE_INFINITY
      const lines = []
      lines.push(`${listing?.repoLabel ?? '安卓项目'} · ${String(listing?.projectRoot ?? '（未识别项目根）')}`)
      lines.push(`共 ${scoped.length} 个 preview：`
        + `${counts.fresh} 已渲染 · ${counts.stale} 源码已变 · ${counts.never} 从未渲染 · ${counts.error} 失败`)
      let shown = 0
      for (const [module, bucket] of groups) {
        lines.push('')
        lines.push(`${module}（${bucket.length}）`)
        for (const entry of bucket.slice(0, perModuleCap)) {
          const mark = PREVIEW_STATUS_MARKS[entry.status] ?? '?'
          const size = Number.isFinite(entry.width) && Number.isFinite(entry.height) ? ` ${entry.width}x${entry.height}` : ''
          const failed = entry.status === 'error' && typeof entry.lastError === 'string' && entry.lastError.length > 0
            ? `  ← ${entry.lastError.slice(0, 120)}`
            : ''
          /* title 与 previewId 在旧索引里可能缺失，用 key 兜底而不是印出 undefined。 */
          const label = String(entry.title ?? entry.previewId ?? entry.key ?? '')
          const functionName = String(entry.previewId ?? entry.fqn ?? '')
          lines.push(`  ${mark} ${label}  ${functionName}${size}${failed}`)
          shown += 1
        }
        if (bucket.length > perModuleCap) {
          lines.push(`  …另有 ${bucket.length - perModuleCap} 个，传 module="${module}" 单独看`)
        }
      }
      if (truncated) {
        lines.push('')
        lines.push(`清单已截断（共 ${scoped.length} 个，上面列了 ${shown} 个）。用 module 参数收窄，或用 staleOnly=true 只看待渲染的。`)
      }
      lines.push('')
      lines.push('渲染某个 preview 用 android_preview_render，name 可以直接用它上面的 previewId（函数名）。')

      return {
        projectRoot: String(listing?.projectRoot ?? ''),
        total: scoped.length,
        shown,
        counts,
        text: lines.join('\n'),
      }
    },
    presentCall: () => ({ card: 'generic', title: '列出 @Preview', kind: 'read' }),
  })), 'android-mirror-pane: preview 列表工具')

  /* ── 渲染 @Preview：把画面交给模型看 ── */
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'android_preview_render',
    description: [
      '渲染一个 Compose `@Preview` 成图片，**把画面作为图片直接返回**，让你看到这个界面长什么样。',
      '用它确认 UI 改动、看清布局与文案，比让用户手动截图快得多。',
      'name 传 key、FQN 或函数名（previewId）都行，也接受片段匹配；匹配不到或有歧义会返回候选，照着候选重传即可。',
      '默认会等渲染完成（通常 2–8 秒，冷启动更久）；给 wait=false 则只排队并立刻返回 jobId。',
      '返回里同时带语义树的文字摘要，所以即使模型不能看图，也能知道界面上有哪些文字。',
      '不想触发构建时别用这个：列出有哪些 preview 用 android_preview_list。',
    ].join(' '),
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: '要渲染的 preview：完整 key（`module::FQN`）、FQN、或函数名（如 `SleepAlarmContentPreview`）。先精确匹配，再按后缀与包含匹配。',
      },
      wait: {
        type: 'boolean',
        description: '是否等渲染完成，默认 true。渲染要 2–8 秒；改成 false 会立刻返回 jobId，之后用 android_preview_list 看状态。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', required: true, description: '这个 preview 的索引 key。' },
          title: { type: 'string', required: true, description: '人读名字。' },
          module: { type: 'string', required: true, description: '所属模块。' },
          status: {
            type: 'string',
            required: true,
            description: '本次结果：`done` 已出图（可能附文字摘要），`rendering` 仍在渲染（wait=false、超时或请求被取消）。渲染失败会直接以错误返回，不会走到这里。',
          },
          jobId: { type: 'string', description: '渲染任务号，可用来在任务列表里对照。' },
          renderer: { type: 'string', description: '渲染器：`studio` 或 `headless`。' },
          width: { type: 'integer', description: '图片像素宽。' },
          height: { type: 'integer', description: '图片像素高。' },
          treeNodes: { type: 'integer', description: '语义树节点数。' },
          error: { type: 'string', description: '仅在渲染成功但图片文件读不出来时出现，说明读不到的原因；此时只有文字摘要。' },
          text: { type: 'string', required: true, description: '给模型看的摘要：名字、模块、渲染器、尺寸，以及从语义树读出的界面文字。' },
          image: {
            type: 'object',
            additionalProperties: false,
            description: '图像附件引用；仅在模型支持图像输入且附件服务可用时出现。',
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
        const parts = [{ type: 'text', text: value.text }]
        if (value.image !== undefined) parts.push({ type: 'image', attachment: value.image })
        return parts
      },
      presentationMeta: (_args, value) => ({ key: value.key, module: value.module, status: value.status }),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const svc = await requirePreviewService(exec)
      const listing = await svc.list()
      /* 与 list 工具同样的理由：索引是磁盘上的 JSON，先滤掉坏条目再匹配。 */
      const entries = (Array.isArray(listing?.entries) ? listing.entries : [])
        .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.key === 'string')
      if (entries.length === 0) {
        throw new Error(`当前项目（${listing?.projectRoot ?? '未知目录'}）里没有任何 @Preview 记录，所以没有可渲染的东西。如果项目里确实有 @Preview，请先在预览面板点一次「刷新索引」再重试。`)
      }

      const matched = matchPreviewEntry(entries, String(args.name ?? ''))
      if (matched.kind === 'ambiguous') {
        /* 歧义不要猜：渲染错的界面比报错更费时间。把候选连 key 一起给出去。 */
        throw new Error([
          `名字「${args.name}」匹配到 ${matched.candidates.length} 个 preview，请改用一个更具体的 name（可以直接抄下面的 key）：`,
          ...matched.candidates.slice(0, PREVIEW_CANDIDATE_LIMIT).map((entry) => `  - ${previewLine(entry)}`),
        ].join('\n'))
      }
      if (matched.kind === 'none') {
        const hint = matched.candidates.length === 0
          ? '先用 android_preview_list 看有哪些 preview。'
          : '你是不是想找：\n'
            + matched.candidates.map((entry) => `  - ${previewLine(entry)}`).join('\n')
        throw new Error(`没有匹配到名字为「${args.name}」的 preview。${hint}`)
      }

      const entry = matched.entry
      const queued = await svc.enqueue(entry.key)
      if (queued === undefined || typeof queued.jobId !== 'string') {
        throw new Error(`渲染入队失败（preview：${entry.key}），预览服务没有返回任务号。请让用户检查预览面板是否正常。`)
      }

      const base = {
        key: entry.key,
        title: String(entry.title ?? entry.previewId ?? entry.key),
        module: String(entry.module ?? ''),
        jobId: queued.jobId,
      }

      /* wait=false：只排队，让调用方自己稍后再看。 */
      if (args.wait === false) {
        return {
          ...base,
          status: 'rendering',
          text: [
            `已排队渲染「${base.title}」（${base.module}），任务 ${queued.jobId}。`,
            queued.duplicate === true ? '这个 preview 之前就在队列里，复用了同一条任务。' : '',
            '稍后用 android_preview_list 看它的状态，或再调一次本工具（wait=true）等它出图。',
          ].filter((line) => line.length > 0).join(''),
        }
      }

      const waited = await pollPreviewJob(svc, queued.jobId, {
        timeoutMs: PREVIEW_RENDER_TIMEOUT_MS,
        signal: exec?.signal,
      })
      if (waited.aborted === true) {
        return { ...base, status: 'rendering', text: `「${base.title}」的渲染请求已取消；任务 ${queued.jobId} 可能仍在后台跑，稍后用 android_preview_list 看结果。` }
      }
      if (waited.timedOut === true) {
        /* 超时不是错误：Gradle 冷启动就是会慢，抛错只会让模型反复重试堆任务。 */
        return {
          ...base,
          status: 'rendering',
          text: `「${base.title}」还在渲染，已等了 ${Math.round(PREVIEW_RENDER_TIMEOUT_MS / 1000)} 秒仍未完成（任务 ${queued.jobId}）。这不是失败：稍后再调一次本工具等它出图，或用 android_preview_list 看状态。`,
        }
      }

      const job = waited.job ?? {}
      if (job.status === 'error') {
        const reason = typeof job.error === 'string' && job.error.length > 0 ? job.error : '（渲染器没有给出原因）'
        throw new Error(`「${base.title}」（${base.module}）渲染失败：${reason}\n可以先看 android_preview_list 里该模块其他 preview 是否也失败——如果都失败，多半是构建或渲染器环境问题，需要用户处理；只这一个失败则可能是这个 @Preview 的代码有问题。`)
      }
      if (job.status !== 'done') {
        throw new Error(`「${base.title}」的渲染任务以 ${job.status ?? '未知状态'} 结束，没有产出图片。任务号 ${queued.jobId}。`)
      }

      const key = entry.key
      const imageFile = typeof svc.imagePath === 'function' ? svc.imagePath(key) : undefined
      const tree = typeof svc.readTree === 'function' ? await svc.readTree(key).catch(() => undefined) : undefined
      const described = describeTree(tree)

      let png
      let fileError
      try {
        if (typeof imageFile !== 'string' || !existsSync(imageFile)) {
          fileError = '渲染完成但缓存里没有图片文件'
        } else {
          png = await readFile(imageFile)
        }
      } catch (error) {
        fileError = String(error?.message ?? error)
      }

      const size = png === undefined ? undefined : pngSize(png)
      const width = size?.width ?? (Number.isFinite(job.width) ? job.width : undefined)
      const height = size?.height ?? (Number.isFinite(job.height) ? job.height : undefined)
      const renderer = typeof job.renderer === 'string' ? job.renderer : (typeof entry.renderer === 'string' ? entry.renderer : undefined)
      const treeNodes = Number.isFinite(job.treeNodes) ? job.treeNodes : (Array.isArray(tree?.nodes) ? tree.nodes.length : undefined)

      /* 摘要里必须有「界面上有什么字」：模型不支持图像时这是唯一的信息来源。 */
      const summary = [
        `已渲染「${base.title}」（${base.module}，key ${key}）。`,
        [
          renderer === undefined ? undefined : `渲染器 ${renderer}`,
          width === undefined || height === undefined ? undefined : `尺寸 ${width}x${height}`,
          treeNodes === undefined ? undefined : `语义树 ${treeNodes} 个节点`,
        ].filter((item) => item !== undefined).join('，'),
        described.items.length === 0
          ? '语义树里没有带文字的节点：可能这个界面是纯图形/空态，或者渲染器没抓到语义。'
          : `界面上读到的文字（${described.items.length + described.more} 条，按从上到下）：\n`
            + described.items.map((item, index) => `  ${index + 1}. ${item.label}${item.kind === '描述' ? `（contentDescription${item.type === undefined ? '' : `，${item.type}`}）` : ''}`).join('\n')
            + (described.more > 0 ? `\n  …另有 ${described.more} 条未列出。` : ''),
      ].filter((line) => typeof line === 'string' && line.length > 0).join('\n')

      if (png === undefined) {
        /* 图没了但渲染是成功的：给文本，不报错——语义树仍然有用。 */
        return {
          ...base,
          status: 'done',
          ...(renderer === undefined ? {} : { renderer }),
          ...(width === undefined ? {} : { width }),
          ...(height === undefined ? {} : { height }),
          ...(treeNodes === undefined ? {} : { treeNodes }),
          ...(fileError === undefined ? {} : { error: fileError }),
          text: `${summary}\n（图片读不出来：${fileError ?? '未知原因'}，因此只给出上面的文字摘要。）`,
        }
      }

      /* 图像投递：模型能看图且附件服务在，就真的给图；否则安静降级成文本。 */
      const acceptsImages = await routeAcceptsImages(ctx, exec)
      const name = `android-preview-${String(entry.previewId ?? 'preview')}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
      const image = acceptsImages ? await stashImage(ctx, png, name) : undefined
      const text = image === undefined
        ? `${summary}\n（当前模型不接受图像输入或附件服务不可用，所以只给出上面的文字摘要。）`
        : `${summary}\n以上文字就是画面里的内容，图片已在下面给出。`

      return {
        ...base,
        status: 'done',
        ...(renderer === undefined ? {} : { renderer }),
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
        ...(treeNodes === undefined ? {} : { treeNodes }),
        ...(image === undefined ? {} : { image }),
        text,
      }
    },
    presentCall: (args) => ({ card: 'generic', title: `渲染 @Preview：${args.name}`, kind: 'write' }),
  })), 'android-mirror-pane: preview 渲染工具')
}
