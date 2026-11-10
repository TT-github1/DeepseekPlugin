/**
 * Compose @Preview 的索引、渲染与语义树。
 *
 * 这里只做「把 Gradle 侧的能力变成可缓存的本地资源」这一件事，不认识 HTTP，
 * 也不认识面板：路由层（preview-routes.js）与 UI 都通过这一层拿数据。
 *
 * 三条实测出来的硬约束，决定了下面的每个设计选择：
 *
 * 1. **单页渲染要 4–5 秒**，40 个 preview 全渲染 ≈ 200 秒。所以索引与渲染必须
 *    彻底分离：`list()` 只读本地 index.json 加一次模块指纹扫描（毫秒级），
 *    渲染是显式动作，进队列异步跑。
 * 2. **渲染结果会过期且用户看不出来**。改一行源码，旧图仍然「看起来是对的」，
 *    这比不显示更危险。所以每条记录都带渲染时的模块指纹，列表实时比对，
 *    给出 fresh / stale / never / error 四态。
 * 3. **两条渲染路径产物结构不同**：headless 给结构化 JSON（`components` 树），
 *    Studio 给缩进文本树。归一化统一在 `normalize*` 里完成，UI 只认一种模型。
 *
 * @module dsh-android-mirror-pane/preview
 */

import { createHash } from 'node:crypto'
import { declaresFlavors, describeScan, extractPreviewFqns, repoLabel, scanPreviewModules } from './discover.js'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { execFile } from 'node:child_process'

/** 缓存根目录：与截图目录并列，重启后仍可回看。 */
const CACHE_ROOT = 'android-mirror-pane/previews'

/** 索引文件名。 */
const INDEX_FILE = 'index.json'

/** 索引结构版本；不兼容的旧索引直接丢弃重建，不做迁移。 */
const INDEX_VERSION = 1

/** 默认渲染的模块。全部实测存在 @Preview，顺序即面板里的分组顺序。 */
export const DEFAULT_MODULES = [
  'feature/sleep/impl',
  'feature/account/impl',
  'feature/devices/impl',
  'feature/profile/impl',
  'feature/ota/impl',
]

/** Studio 可用性探测结果的缓存时长：`studio check` 要 1 秒，不能每次渲染都问。 */
const STUDIO_PROBE_TTL_MS = 60_000

/** 渲染超时。冷启动 Gradle 到出图实测最慢一次约 40 秒，留足余量。 */
const RENDER_TIMEOUT_MS = 300_000

/** `preview list` 超时：它要配置 Gradle，比渲染短得多。 */
const LIST_TIMEOUT_MS = 120_000

/** 队列历史的保留条数（不含正在排队的任务与当前批次）。 */
const MAX_JOB_HISTORY = 20

/** 批次记录的保留条数：面板只需要看最近几批，太老的历史没有意义。 */
const MAX_BATCH_HISTORY = 8

/** 缓存目录默认上限（MB）。单个 preview 的 png + json 实测约 0.2–1 MB。 */
const DEFAULT_MAX_CACHE_MB = 300

/** 缓存文件名：`img-<sha1 前 16 位>.png` 与 `tree-<sha1 前 16 位>.json`。 */
const CACHE_FILE_RE = /^(img|tree)-([0-9a-f]+)\.(png|json)$/

/**
 * 把一组 job 汇总成进度。
 *
 * 前端算进度不能靠 `jobs` 数组的长度：队列只保留有限条历史，一次 42 个的
 * 批量渲染会把更早的条目挤掉，于是「总数」在跑到一半时会莫名其妙变小。
 * 所以聚合值由这一层给，前端只管显示。
 *
 * @param {{ status?: string }[]} jobs
 * @returns {{ total: number, queued: number, running: number, done: number, failed: number, cancelled: number, finished: number, percent: number }}
 */
export function summarizeJobs(jobs) {
  const summary = { total: jobs.length, queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 }
  for (const job of jobs) {
    if (job.status === 'queued') summary.queued += 1
    else if (job.status === 'running') summary.running += 1
    else if (job.status === 'done') summary.done += 1
    else if (job.status === 'error') summary.failed += 1
    else if (job.status === 'cancelled') summary.cancelled += 1
  }
  const finished = summary.done + summary.failed + summary.cancelled
  return { ...summary, finished, percent: summary.total === 0 ? 0 : Math.round((finished / summary.total) * 100) }
}

/**
 * 短哈希，用于缓存文件名。
 * @param {string} text
 * @param {number} [length]
 * @returns {string}
 */
export function shortHash(text, length = 16) {
  return createHash('sha1').update(text).digest('hex').slice(0, length)
}

/**
 * 找 `android` CLI。
 *
 * 用户实测把 CLI 装在 `~/.local/bin/android`，但 PATH 未必包含它，
 * 所以先试几个固定位置再退回 PATH 查找。
 *
 * @param {string | undefined} configured - 配置里指定的路径。
 * @returns {string | undefined}
 */
export function resolveAndroidCli(configured) {
  if (typeof configured === 'string' && configured.length > 0) {
    const expanded = configured.replace(/^~(?=$|\/)/, homedir())
    return existsSync(expanded) ? expanded : undefined
  }
  for (const candidate of [
    join(homedir(), '.local', 'bin', 'android'),
    '/opt/homebrew/bin/android',
    '/usr/local/bin/android',
  ]) {
    if (existsSync(candidate)) return candidate
  }
  /* 最后交给 PATH：execFile 找不到会给出 ENOENT，由调用方转成可读错误。 */
  return 'android'
}

/**
 * 判断一个目录是不是安卓工程的根：有 `gradlew` 或 `settings.gradle(.kts)`。
 * @param {string} dir
 * @returns {boolean}
 */
function looksLikeAndroidProject(dir) {
  return existsSync(join(dir, 'gradlew'))
    || existsSync(join(dir, 'settings.gradle.kts'))
    || existsSync(join(dir, 'settings.gradle'))
}

/**
 * 从起点向上找安卓工程根，最多爬 6 层。
 *
 * 为什么需要这个：DSH 宿主进程的 cwd 是 profile 目录（实测是
 * `~/.dsh/profiles/desktop`），不是用户打开的安卓仓库。所以「项目根」
 * 必须来自配置；配置没写时退化为这一条探测链，而不是直接信任 cwd。
 *
 * @param {string} start
 * @returns {string | undefined}
 */
export function findAndroidProject(start) {
  let current = resolve(start)
  for (let depth = 0; depth < 6; depth++) {
    if (looksLikeAndroidProject(current)) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

/**
 * 递归列出目录下的文件，跳过 `build` 与隐藏目录。
 * @param {string} dir
 * @param {(path: string) => boolean} accept
 * @param {string[]} [out]
 * @returns {Promise<string[]>}
 */
async function walkFiles(dir, accept, out = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const item of entries) {
    if (item.name.startsWith('.') || item.name === 'build') continue
    const full = join(dir, item.name)
    if (item.isDirectory()) {
      await walkFiles(full, accept, out)
    } else if (item.isFile() && accept(full)) {
      out.push(full)
    }
  }
  return out
}

/**
 * 从 `build.gradle.kts` 里读出这个模块依赖的同项目模块。
 *
 * 只看 `project(":a:b")` 这种形式——外部依赖不会随本地源码变，
 * 读了也没意义。实测 `feature/account/impl` 依赖 9 个 core/feature 模块，
 * 而它的文案全部放在 `core/resources`，所以「模块自己的 src」远不足以
 * 判断它有没有变。
 *
 * @param {string} moduleDir - 模块绝对路径。
 * @returns {Promise<string[]>} 依赖的模块路径（如 `core/resources`）。
 */
export async function projectDependencies(moduleDir) {
  const out = new Set()
  for (const name of ['build.gradle.kts', 'build.gradle']) {
    let text
    try {
      text = await readFile(join(moduleDir, name), 'utf8')
    } catch {
      continue
    }
    const re = /project\(\s*["'](:[^"']+)["']\s*\)/g
    for (;;) {
      const match = re.exec(text)
      if (match === null) break
      /* `:feature:account:impl` → `feature/account/impl`。 */
      out.add(match[1].slice(1).split(':').join('/'))
    }
  }
  return [...out].sort()
}

/**
 * 算一个模块的源码指纹，范围是它**自己加所有同项目依赖**的 `src`。
 *
 * 为什么必须带上依赖：实测 `feature/account/impl` 的界面文案来自
 * `core/resources` 的 strings.xml，只改那个文件、不改 account 一行代码，
 * 渲染结果就已经变了。只对模块自己的 src 求指纹会把这种情况判成「最新」，
 * 而那正是「看到旧图以为是新的」——比不显示更危险。
 *
 * 用**文件内容**而不是 mtime：mtime 会骗人，`git checkout`、切分支、
 * 还原改动都会让 mtime 变而内容不变，整批 preview 会被误标为过期。
 *
 * 代价可接受：实测五个模块连同依赖闭包约 700 个 .kt/.xml、3.4 MB，
 * 全读一遍 70 ms，而首屏预算是 1 秒。
 *
 * @param {string} moduleDir - 模块绝对路径。
 * @returns {Promise<string>} 指纹；模块不存在时返回空串。
 */
export async function moduleFingerprint(moduleDir, options = {}) {
  /* 依赖闭包只算一层还是递归，由调用方决定；单测里直接给一层的目录列表。 */
  const dirs = Array.isArray(options.modules) && options.modules.length > 0
    ? options.modules
    : [moduleDir]
  const files = []
  for (const dir of dirs) {
    const root = join(dir, 'src')
    const found = await walkFiles(root, (path) => path.endsWith('.kt') || path.endsWith('.xml'))
    for (const file of found) files.push({ file, base: root })
  }
  files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
  const hash = createHash('sha256')
  for (const { file, base } of files) {
    let bytes
    try {
      bytes = await readFile(file)
    } catch {
      continue
    }
    hash.update(relative(base, file))
    hash.update('\u0000')
    hash.update(bytes)
    hash.update('\u0000')
  }
  return `${files.length}:${hash.digest('hex').slice(0, 24)}`
}

/**
 * 解析 `android studio check` 的输出，得到「项目名 → 状态」。
 *
 * 实测格式：
 * ```
 * pid: 1988
 * version: Rabbit 2 | 2026.2.2
 * Projects:
 *     READY     Z3             /Users/.../New
 * ```
 *
 * @param {string} text
 * @returns {{ running: boolean, version?: string, projects: { name: string, path: string, ready: boolean }[] }}
 */
export function parseStudioCheck(text) {
  const projects = []
  const lines = text.split('\n')
  let inProjects = false
  let version
  for (const line of lines) {
    const versionMatch = /^version:\s*(.+)$/.exec(line.trim())
    if (versionMatch !== null) version = versionMatch[1].trim()
    if (/^Projects:\s*$/.test(line.trim())) {
      inProjects = true
      continue
    }
    if (inProjects !== true) continue
    /* 形如「READY  Z3  /path」，三列以空白分开。 */
    const match = /^\s+(\S+)\s+(\S+)\s+(\/.*)$/.exec(line)
    if (match === null) {
      if (line.trim().length === 0) continue
      inProjects = false
      continue
    }
    projects.push({ ready: match[1].toUpperCase() === 'READY', name: match[2], path: match[3].trim() })
  }
  return { running: projects.length > 0, ...(version === undefined ? {} : { version }), projects }
}

/**
 * 从 FQN 里拆出包名、文件名与函数名。
 *
 * 实测 FQN 形如 `com.joyroom.z3.feature.account.impl.EmailLoginScreenKt.PhoneLoginContentPreview`：
 * 倒数第二段是 Kotlin 顶层函数所在的类名（带 `Kt` 后缀），最后一段是函数名。
 *
 * @param {string} fqn
 * @returns {{ packageName: string, className: string, fileName: string, functionName: string }}
 */
export function splitFqn(fqn) {
  const parts = String(fqn).split('.').filter((part) => part.length > 0)
  const functionName = parts.pop() ?? ''
  const className = parts.pop() ?? ''
  const fileName = className.endsWith('Kt') ? `${className.slice(0, -2)}.kt` : `${className}.kt`
  return { packageName: parts.join('.'), className, fileName, functionName }
}

/**
 * 把 headless 路径的组件树归一化成面板模型。
 *
 * 实测每个节点形如：
 * ```json
 * { "name": "Text", "bounds": { "left": 63, "top": 189, "right": 628, "bottom": 279, "width": 565, "height": 90 },
 *   "sourceLocation": { "fileName": "PhoneLoginScreen.kt", "lineNumber": 563 },
 *   "semantics": { "text": "Sign in with email" }, "modifiers": { ... }, "children": [ ... ] }
 * ```
 * 77 个节点里只有 16 个带 semantics——所以 `hasSemantics` 是 UI 默认筛选的依据。
 *
 * @param {any} tree - 组件树 JSON。
 * @returns {{ width: number, height: number, renderer: string, nodes: object[] }}
 */
export function normalizeHeadlessTree(tree) {
  const nodes = []
  const visit = (node, depth) => {
    if (node === null || typeof node !== 'object') return
    const semantics = node.semantics !== null && typeof node.semantics === 'object' ? node.semantics : undefined
    const text = typeof semantics?.text === 'string' ? semantics.text : undefined
    const role = typeof semantics?.role === 'string' ? semantics.role : undefined
    const description = typeof semantics?.contentDescription === 'string' ? semantics.contentDescription : undefined
    const actions = typeof semantics?.actions === 'string' ? semantics.actions.split(',').map((s) => s.trim()).filter(Boolean) : []
    const bounds = node.bounds ?? {}
    const source = node.sourceLocation
    const node_ = {
      id: `n${nodes.length}`,
      type: typeof node.name === 'string' ? node.name : 'Unknown',
      bounds: {
        left: Number(bounds.left) || 0,
        top: Number(bounds.top) || 0,
        right: Number(bounds.right) || 0,
        bottom: Number(bounds.bottom) || 0,
      },
      depth,
      hasSemantics: semantics !== undefined,
      ...(text === undefined ? {} : { text }),
      ...(role === undefined ? {} : { role }),
      ...(description === undefined ? {} : { contentDescription: description }),
      ...(actions.length === 0 ? {} : { actions }),
      ...(typeof source?.fileName === 'string'
        ? { source: { file: source.fileName, ...(Number.isFinite(Number(source.lineNumber)) ? { line: Number(source.lineNumber) } : {}) } }
        : {}),
    }
    nodes.push(node_)
    for (const child of Array.isArray(node.children) ? node.children : []) visit(child, depth + 1)
  }
  for (const root of Array.isArray(tree?.components) ? tree.components : []) visit(root, 0)
  return {
    width: Number(tree?.width) || 0,
    height: Number(tree?.height) || 0,
    renderer: 'headless',
    nodes,
  }
}

/**
 * Studio 文本树里算「有语义」的控件类型。
 *
 * 不在这里的类型（`View`、`ComposeView`、`ComposeViewAdapter`、`ScrollView`…）
 * 都是布局容器：它们要么和父节点同样大小，要么本身不带任何文字，
 * 默认视图里显示出来只会淹没真正要看的那十几行。
 */
const SEMANTIC_VIEW_TYPES = new Set([
  'TextView', 'Button', 'EditText', 'CheckBox', 'RadioButton', 'Switch',
  'ToggleButton', 'SeekBar', 'ProgressBar', 'Spinner', 'ImageView', 'ImageButton',
  'TextInputLayout', 'TextInputEditText', 'Chip', 'Tab', 'Toolbar',
])

/**
 * 把 Studio 路径的缩进文本树归一化成同一个模型。
 *
 * 实测一行形如：
 * ```
 *           TextView (left: 63, top: 189, right: 628, bottom: 279) text="Sign in with email"
 * ```
 * 缩进每级 2 个空格。它的「控件类型」天然是 Android View 名（`TextView`/`Button`），
 * 比 headless 的 Compose 结构可读得多——这是 Studio 路径值得保留的主要原因。
 *
 * @param {string} text - 命令的 stdout。
 * @returns {{ width: number, height: number, renderer: string, nodes: object[] }}
 */
export function normalizeStudioTree(text) {
  const nodes = []
  let width = 0
  let height = 0
  const lineRe = /^(\s*)(\S+)\s+\(left:\s*(-?\d+),\s*top:\s*(-?\d+),\s*right:\s*(-?\d+),\s*bottom:\s*(-?\d+)\)\s*(.*)$/
  for (const raw of String(text).split('\n')) {
    const match = lineRe.exec(raw)
    if (match === null) continue
    const depth = Math.floor(match[1].length / 2)
    const bounds = {
      left: Number(match[3]),
      top: Number(match[4]),
      right: Number(match[5]),
      bottom: Number(match[6]),
    }
    /* 根节点就是整块画布，它的 bounds 就是渲染尺寸。 */
    if (nodes.length === 0) {
      width = bounds.right - bounds.left
      height = bounds.bottom - bounds.top
    }
    const rest = match[7] ?? ''
    const textMatch = /text="((?:[^"\\]|\\.)*)"/.exec(rest)
    const descriptionMatch = /contentDescription="((?:[^"\\]|\\.)*)"/.exec(rest)
    const type = match[2]
    const hasText = textMatch !== null && textMatch[1].length > 0
    const hasDescription = descriptionMatch !== null && descriptionMatch[1].length > 0
    const hasSemantics = hasText || hasDescription || SEMANTIC_VIEW_TYPES.has(type)
    nodes.push({
      id: `n${nodes.length}`,
      type,
      bounds,
      depth,
      hasSemantics,
      ...(hasText ? { text: textMatch[1] } : {}),
      ...(hasDescription ? { contentDescription: descriptionMatch[1] } : {}),
    })
  }
  return { width, height, renderer: 'studio', nodes }
}

/**
 * 起一个子进程跑 CLI，返回 stdout / stderr / 退出码。
 *
 * 不用 spawn 是为了拿到 `maxBuffer` 与 `timeout` 这两个现成行为；
 * 渲染输出的 JSON 最多几百 KB，32MB 足够且能挡住异常巨大的输出。
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, timeoutMs?: number }} [options]
 * @returns {{ promise: Promise<{ stdout: string, stderr: string, code: number }>, kill: () => void }}
 */
function spawnCli(command, args, options = {}) {
  let child
  const promise = new Promise((resolvePromise, reject) => {
    child = execFile(
      command,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? RENDER_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        encoding: 'utf8',
        env: { ...process.env, /* Gradle 在 CI 里被关掉的彩色输出这里不影响解析，但关掉更省字节。 */ CI: 'true' },
      },
      (error, stdout, stderr) => {
        if (error !== null && error !== undefined) {
          /* 超时与找不到命令要分开报：前者会让用户以为代码坏了，后者只要装 CLI。 */
          if (error.killed === true) {
            reject(new Error(`命令超时（${Math.round((options.timeoutMs ?? RENDER_TIMEOUT_MS) / 1000)} 秒）：${command} ${args[0] ?? ''}`))
            return
          }
          if (error.code === 'ENOENT') {
            reject(new Error(`找不到命令 ${command}，请安装 Android CLI（见 cordis.patch.yml 的 preview.androidCli）`))
            return
          }
          const detail = String(stderr ?? '').trim().split('\n').slice(-30).join('\n')
          const failure = new Error(detail.length > 0 ? detail : `命令失败（退出码 ${error.code ?? '?'}）`)
          failure.exitCode = typeof error.code === 'number' ? error.code : undefined
          failure.stdout = String(stdout ?? '')
          reject(failure)
          return
        }
        resolvePromise({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: 0 })
      },
    )
  })
  return { promise, kill: () => { try { child?.kill('SIGTERM') } catch { /* 已退出 */ } } }
}

/**
 * 一条索引记录。
 * @typedef {{
 *   key: string, module: string, fqn: string, previewId: string,
 *   title: string, previewParams?: Record<string, string>,
 *   renderedAt?: number, renderer?: string, sourceHash?: string,
 *   width?: number, height?: number, treeNodes?: number,
 *   lastError?: string, lastErrorAt?: number
 * }} PreviewEntry
 */

/**
 * Preview 服务：索引、指纹、渲染队列。
 *
 * 渲染队列故意只有 1 个并发：两个 Gradle 同时跑会争同一个目录锁，
 * 实测结果是第二个一直等到第一个超时，比串行慢得多。
 */
export class PreviewService {
  #projectRoot
  #modules
  #cli
  #renderer
  #studioProject
  #logger
  #dir
  /** @type {Map<string, PreviewEntry>} */
  #entries = new Map()
  #loaded = false
  #dirty = false
  /** 模块 → 指纹；每次 list 重算。 */
  #fingerprints = new Map()
  /** 模块 → 依赖闭包的模块目录；只跟构建脚本有关，随扫描失效。 */
  #closures = new Map()
  /** 配置里显式指定的模块；undefined 表示走自动发现。 */
  #configuredModules
  /** 最近一次扫描实际处理的模块（含 flavored 标记）。 */
  #scannedModules = []
  #jobs = new Map()
  /** 批次号 → 进度摘要；批量渲染时前端靠它显示「已跑 12/42」。 */
  #batches = new Map()
  #queue = Promise.resolve()
  #activeChild = undefined
  #disposed = false
  /** 缓存上限（字节）；0 表示不限制。 */
  #maxCacheBytes = DEFAULT_MAX_CACHE_MB * 1024 * 1024
  /** 正在跑的清理 Promise，避免两次渲染完成同时扫目录互相覆盖索引。 */
  #trimming = undefined
  #studioProbe = { at: 0, value: undefined }
  #scan = { running: false, startedAt: 0, finishedAt: 0, error: undefined, cliAvailable: undefined }

  /**
   * @param {{
   *   projectRoot: string,
   *   modules?: string[],
   *   androidCli?: string,
   *   renderer?: 'auto' | 'headless' | 'studio',
   *   studioProject?: string,
   *   maxCacheMb?: number,
   *   cacheDir?: string,
   *   logger?: any,
   * }} options
   */
  constructor(options) {
    /* 项目根按优先级解析：显式配置 > 调用方给的候选目录（会话工作目录）
       > 从候选目录向上找 gradlew。都不成立就停在候选目录上，
       面板会显示空索引并提示去配置，而不是悄悄扫错地方。 */
    const configured = typeof options.projectRoot === 'string' && options.projectRoot.length > 0
      ? options.projectRoot
      : undefined
    const candidates = [
      configured,
      ...(Array.isArray(options.projectRootCandidates) ? options.projectRootCandidates : []),
    ].filter((entry) => typeof entry === 'string' && entry.length > 0)
    let root
    for (const candidate of candidates) {
      const expanded = candidate.replace(/^~(?=$|\/)/, homedir())
      if (configured === candidate) {
        /* 明确配置的路径直接采信，不再向上爬——用户说在哪就在哪。 */
        root = resolve(expanded)
        break
      }
      const found = findAndroidProject(expanded)
      if (found !== undefined) {
        root = found
        break
      }
    }
    this.#projectRoot = root ?? resolve(candidates[0] ?? process.cwd())

    /* 模块来源三级优先：配置 > 自动发现 > 内置兜底。
       只有「配置里明确给了」才算锁定，空数组与不传都视为没配。 */
    this.#configuredModules = Array.isArray(options.modules) && options.modules.length > 0
      ? options.modules.map((module) => String(module).replace(/^\.?\//, ''))
      : undefined
    this.#modules = this.#configuredModules ?? DEFAULT_MODULES
    this.#cli = resolveAndroidCli(options.androidCli)
    this.#renderer = options.renderer === 'headless' || options.renderer === 'studio' ? options.renderer : 'auto'
    this.#studioProject = typeof options.studioProject === 'string' && options.studioProject.length > 0 ? options.studioProject : undefined
    this.#logger = options.logger ?? console
    /* 缓存上限：不配置就用默认值；显式给 0 表示不清理（给排障留一条后路）。 */
    const maxCacheMb = Number(options.maxCacheMb)
    this.#maxCacheBytes = Number.isFinite(maxCacheMb) && maxCacheMb >= 0
      ? Math.floor(maxCacheMb * 1024 * 1024)
      : DEFAULT_MAX_CACHE_MB * 1024 * 1024
    /* 缓存按项目分目录：不同仓库的 preview 同名不同图，混在一个目录里会串。
       `cacheDir` 只给单测与特殊部署用——单测必须能指向临时目录，
       绝不能碰用户真实的 ~/.dsh/android-mirror-pane/。 */
    this.#dir = typeof options.cacheDir === 'string' && options.cacheDir.length > 0
      ? resolve(options.cacheDir.replace(/^~(?=$|\/)/, homedir()))
      : join(homedir(), '.dsh', CACHE_ROOT, shortHash(this.#projectRoot, 12))
  }

  /** 缓存目录。 */
  get directory() {
    return this.#dir
  }

  /** 缓存上限（MB）；0 表示不清理。 */
  get maxCacheMb() {
    return this.#maxCacheBytes === 0 ? 0 : Math.round(this.#maxCacheBytes / 1024 / 1024)
  }

  /** 被扫描的安卓项目根目录。 */
  get projectRoot() {
    return this.#projectRoot
  }

  /**
   * 当前有 preview 的模块列表。
   *
   * 优先用索引里实际存在的模块——自动发现之后，这才是真相；
   * 索引为空（还没扫过）时才退回「将要扫描」的模块列表，
   * 否则新仓库在首屏会显示一串根本不含 preview 的内置模块名。
   */
  get modules() {
    if (this.#entries.size > 0) {
      const seen = new Set()
      for (const entry of this.#entries.values()) seen.add(entry.module)
      /* 保持扫描顺序，避免每次返回的顺序都不同。 */
      const order = this.#scannedModules.map((target) => target.path)
      const ordered = order.filter((module) => seen.has(module))
      for (const module of seen) if (!ordered.includes(module)) ordered.push(module)
      return ordered
    }
    return this.#scannedModules.length > 0
      ? this.#scannedModules.map((target) => target.path)
      : [...this.#modules]
  }

  /** 仓库短名，面板顶部显示「当前仓库」用。 */
  get repoLabel() {
    return repoLabel(this.#projectRoot)
  }

  /** 最近一次扫描状态。 */
  get scanState() {
    return {
      running: this.#scan.running,
      startedAt: this.#scan.startedAt || undefined,
      finishedAt: this.#scan.finishedAt || undefined,
      error: this.#scan.error,
      cliAvailable: this.#scan.cliAvailable,
      /* 发现阶段的摘要：哪些模块被扫了、为什么跳过、用了配置还是自动发现。 */
      discovery: this.#scan.discovery,
      progress: this.#scan.progress,
    }
  }

  /**
   * 读索引。损坏或版本不符就当空索引——缓存丢了最多是重新渲染，
   * 不该让整个面板报错。
   * @returns {Promise<void>}
   */
  async #load() {
    if (this.#loaded) return
    this.#loaded = true
    try {
      const text = await readFile(join(this.#dir, INDEX_FILE), 'utf8')
      const parsed = JSON.parse(text)
      if (parsed?.version !== INDEX_VERSION || typeof parsed?.entries !== 'object') return
      for (const entry of Object.values(parsed.entries)) {
        if (entry === null || typeof entry !== 'object') continue
        if (typeof entry.key !== 'string' || typeof entry.fqn !== 'string') continue
        this.#entries.set(entry.key, entry)
      }
    } catch {
      /* 没有索引、或是被截断的坏文件：从空开始。 */
    }
  }

  /**
   * 原子写索引：先写临时文件再 rename，避免面板正好在读到半个文件。
   * @returns {Promise<void>}
   */
  async #save() {
    if (!this.#dirty) return
    this.#dirty = false
    try {
      await mkdir(this.#dir, { recursive: true })
      const payload = {
        version: INDEX_VERSION,
        updatedAt: Date.now(),
        projectRoot: this.#projectRoot,
        entries: Object.fromEntries(this.#entries),
      }
      const tmp = join(this.#dir, `.index-${process.pid}.tmp`)
      await writeFile(tmp, JSON.stringify(payload), 'utf8')
      await rename(tmp, join(this.#dir, INDEX_FILE))
    } catch (error) {
      this.#logger.warn?.(`[android-mirror-pane] 写 preview 索引失败：${String(error?.message ?? error)}`)
    }
  }

  /** 图片文件路径。 */
  imagePath(key) {
    return join(this.#dir, `img-${shortHash(key)}.png`)
  }

  /** 语义树文件路径。 */
  treePath(key) {
    return join(this.#dir, `tree-${shortHash(key)}.json`)
  }

  /** 上一版语义树的路径，供 diff 当基线用。 */
  baselineTreePath(key) {
    return join(this.#dir, `base-${shortHash(key)}.json`)
  }

  /**
   * 写入语义树，并把当前版本轮转成基线。
   *
   * 为什么单独抽出来：headless 与 studio 两条渲染路径各写一次树，
   * 如果只在一处轮转，用另一条路径渲染的 preview 就永远没有基线、
   * diff 永远显示「首次渲染」。轮转必须先做（把旧树改名成 base-），
   * 再写新树，否则新旧会互相覆盖。
   *
   * @param {string} key
   * @param {object} tree
   */
  async #writeTree(key, tree) {
    const current = this.treePath(key)
    /* 旧的当前树成为新基线。读失败（文件不存在/损坏）不算错，
       只是这次 diff 没有基线可用。 */
    try {
      const previous = await readFile(current, 'utf8')
      await writeFile(this.baselineTreePath(key), previous, 'utf8')
    } catch {
      /* 没有上一版：保持基线缺省。 */
    }
    await writeFile(current, JSON.stringify(tree), 'utf8')
  }

  /**
   * 读上一版语义树，作为 diff 的基线。
   * @param {string} key
   * @returns {Promise<object | undefined>}
   */
  async readBaselineTree(key) {
    try {
      const text = await readFile(this.baselineTreePath(key), 'utf8')
      const parsed = JSON.parse(text)
      return parsed !== null && typeof parsed === 'object' ? parsed : undefined
    } catch {
      return undefined
    }
  }

  /**
   * 建立「缓存文件名里的短哈希 → key」的反查表。
   *
   * 文件名只存 sha1 前 16 位，反查只能拿索引里的 key 逐个算哈希。索引量级是
   * 几十到几百条，一次扫描建表远比逐文件遍历索引便宜。
   *
   * @returns {Map<string, string>}
   */
  #hashToKey() {
    const map = new Map()
    for (const key of this.#entries.keys()) map.set(shortHash(key), key)
    return map
  }

  /**
   * 某个缓存文件当前是否被引用——被引用的不能删。
   *
   * 三类「被引用」，任一命中就不动它：
   * 1. 索引里状态为 `fresh` 的条目：它就是「现在看到的是最新」的那张图，
   *    删掉之后卡片变灰底，用户会以为渲染结果丢了。
   * 2. 队列里 queued / running 的 job 的 key：文件正在写或马上要写，
   *    此时删掉会和写入抢同一个路径。
   * 3. 还在跑的批次里的 key：它们马上要入队，属于同一批的「即将写入」。
   *
   * 状态是 `stale` / `error` / `never` 的条目**不** pin：它们要么源码已变、
   * 要么从未渲染成功，文件留着也只是过期图，正是 LRU 该淘汰的对象；
   * 淘汰之后靠 `list()` 现场 `existsSync` 判定 `hasImage`，卡片仍在。
   *
   * @param {string} key
   * @returns {boolean}
   */
  #isKeyPinned(key) {
    for (const job of this.#jobs.values()) {
      if (job.key === key && (job.status === 'queued' || job.status === 'running')) return true
    }
    for (const batch of this.#batches.values()) {
      if (batch.running === true && batch.keys.includes(key)) return true
    }
    const entry = this.#entries.get(key)
    if (entry === undefined) return false
    return this.#statusOf(entry) === 'fresh'
  }

  /**
   * 清理缓存到上限以内：按文件 mtime 最旧的先删。
   *
   * 什么时候跑很关键：
   * - **不在 `list()` 里跑**。list 是首屏高频路径（面板有任务时每 1.5 秒轮询），
   *   扫目录 + 每个文件一次 stat，在几千个文件时会拖到几百毫秒，首屏 1 秒预算
   *   会被吃掉。
   * - **在渲染成功后跑**。渲染成功是唯一会让目录变大的动作（一次多出 png + json），
   *   所以「刚写完就顺手清」既不在首屏挡路，也只在上限真的被突破时才生效；
   *   此刻用户正在等图，多几十毫秒无感。失败路径不跑：那时没有新文件（中间
   *   产物已在 `#renderWithHeadless` 的 finally 里删掉），扫一遍目录纯属浪费。
   *
   * LRU 的「用」用文件 mtime 表示：`GET /preview/image` 走的是 readFile，
   * 不会刷新 mtime（也不该刷新——刷新要额外 utimes，而看列表时会一次拉几十张图，
   * 那才是高频路径）。所以语义是「按最近一次写入时间淘汰」，对 preview 缓存
   * 够用：一个 preview 被重渲染就会写新文件，mtime 自然变新。
   *
   * @param {{ force?: boolean }} [options] - `force` 跳过「正在清理」的去重（单测用）。
   * @returns {Promise<{ removed: number, freed: number, total: number, max: number }>}
   */
  async trimCache(options = {}) {
    await this.#load()
    if (this.#maxCacheBytes === 0) return { removed: 0, freed: 0, total: 0, max: 0 }
    /* 串行化：两次渲染完成可能几乎同时触发清理，并发扫目录会让两边都基于
       同一份旧索引做删除，最后落盘的可能是被覆盖掉的状态。 */
    if (options.force === true) return this.#trimCacheOnce()
    if (this.#trimming !== undefined) return this.#trimming
    this.#trimming = this.#trimCacheOnce().finally(() => { this.#trimming = undefined })
    return this.#trimming
  }

  /**
   * `trimCache` 的实际步骤。
   * @returns {Promise<{ removed: number, freed: number, total: number, max: number }>}
   */
  async #trimCacheOnce() {
    let filenames
    try {
      filenames = await readdir(this.#dir)
    } catch {
      /* 目录还不存在：没有可清理的东西。 */
      return { removed: 0, freed: 0, total: 0, max: this.#maxCacheBytes }
    }
    /** @type {{ path: string, size: number, atime: number, mtime: number, kind: string, hash: string }[]} */
    const files = []
    let total = 0
    for (const name of filenames) {
      const match = CACHE_FILE_RE.exec(name)
      /* 认不出来的文件（index.json、`.index-*.tmp`、render-* 中间目录、
         用户自己放的东西）一律不碰：删错了没法恢复。 */
      if (match === null) continue
      /* 前后缀必须配对：`img-x.json` 之类不是本服务的产物。 */
      if (match[1] === 'img' && match[3] !== 'png') continue
      if (match[1] === 'tree' && match[3] !== 'json') continue
      const path = join(this.#dir, name)
      let info
      try {
        info = await stat(path)
      } catch {
        continue
      }
      if (info.isFile() !== true) continue
      total += info.size
      files.push({ path, size: info.size, atime: info.atimeMs, mtime: info.mtimeMs, kind: match[1], hash: match[2] })
    }
    if (total <= this.#maxCacheBytes) return { removed: 0, freed: 0, total, max: this.#maxCacheBytes }

    /* 判「哪些是 fresh（不许删）」要靠模块指纹，而指纹只有 list() 走过之后才有。
       这里对缺指纹的模块现算一次——**只在超限时**发生（大多数渲染根本走不到
       这一行），算的是读源码文件，几十毫秒，而且与 list() 用同一个入口，
       不会出现两套算法判出两种状态。 */
    const missingModules = new Set()
    for (const entry of this.#entries.values()) {
      if (!this.#fingerprints.has(entry.module)) missingModules.add(entry.module)
    }
    for (const module of missingModules) {
      try {
        this.#fingerprints.set(module, await this.#fingerprintOf(module))
      } catch {
        /* 算不出来就保持缺失：`#statusOf` 会把这类当 fresh，也就是**不删**。
           宁可这一轮少清理，也不能删掉用户正在看的图。 */
      }
    }

    /* 最旧的先删。mtime 主序、atime 次序：同一毫秒写入的两个文件靠 atime 分开，
       两者都一样就按路径排，保证同一份输入永远淘汰同一批文件（可测）。 */
    files.sort((a, b) => (a.mtime - b.mtime) || (a.atime - b.atime) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

    const removedKeys = new Set()
    const hashToKey = this.#hashToKey()
    let freed = 0
    let removed = 0
    for (const file of files) {
      if (total - freed <= this.#maxCacheBytes) break
      /* 反查不到归属的文件不动：它要么是更早版本留下的、要么 key 已从索引消失，
         两者都属于「不确定就别删」。 */
      const key = hashToKey.get(file.hash)
      if (key === undefined) continue
      if (this.#isKeyPinned(key)) continue
      try {
        await unlink(file.path)
      } catch {
        continue
      }
      freed += file.size
      removed += 1
      removedKeys.add(key)
    }

    /* 删完同步索引：清掉渲染信息，让条目回到 `never`。**不删条目本身**——
       历史上删过 entry，卡片会从面板上凭空消失，用户以为源码里被删了。
       这里只保留识别字段，与 `forget()` 的处理保持一致。 */
    for (const key of removedKeys) {
      const entry = this.#entries.get(key)
      if (entry === undefined) continue
      this.#entries.set(key, {
        key: entry.key,
        module: entry.module,
        fqn: entry.fqn,
        previewId: entry.previewId,
        title: entry.title,
        ...(entry.flavored === true ? { flavored: true } : {}),
        ...(entry.previewParams === undefined ? {} : { previewParams: entry.previewParams }),
      })
      this.#dirty = true
    }
    /* 沿用现有原子写（临时文件 + rename），不直接覆盖 index.json。 */
    await this.#save()
    if (removed > 0) {
      this.#logger.info?.(`[android-mirror-pane] preview 缓存超出上限，清理 ${removed} 个文件、${Math.round(freed / 1024)} KB`)
    }
    return { removed, freed, total: total - freed, max: this.#maxCacheBytes }
  }

  /**
   * 一条 entry 现在处于四态里的哪个。与 `list()` 里的判定必须一致。
   * @param {PreviewEntry} entry
   * @returns {'fresh' | 'stale' | 'never' | 'error'}
   */
  #statusOf(entry) {
    const current = this.#fingerprints.get(entry.module)
    if (entry.renderedAt === undefined) return entry.lastError === undefined ? 'never' : 'error'
    if (entry.lastError !== undefined) return 'error'
    if (current !== undefined && entry.sourceHash !== current) return 'stale'
    return 'fresh'
  }

  /**
   * 重算全部模块的指纹。
   *
   * 范围是 `#modules` **并上索引里实际出现过的模块**。只看 `#modules` 是个
   * 隐蔽的坑：自动发现之后索引里可能有十几个模块，而 `#modules` 还是内置的
   * 那五个，于是其余模块的指纹永远缺失，`#statusOf` 把「查不到指纹」当成
   * `fresh`——列表里那些模块的图永远不会被标成「源码已变」，LRU 也永远
   * 不敢删它们。
   *
   * @returns {Promise<void>}
   */
  async #refreshFingerprints() {
    const next = new Map()
    const modules = new Set(this.#modules)
    for (const entry of this.#entries.values()) modules.add(entry.module)
    for (const module of modules) {
      next.set(module, await this.#fingerprintOf(module))
    }
    this.#fingerprints = next
  }

  /**
   * 某个模块的指纹（含依赖闭包）。
   *
   * 所有算指纹的地方都必须走这里。之前渲染完成时直接调 moduleFingerprint
   * 只算了自己那 21 个文件，而 list 比的是含依赖的 389 个文件，
   * 于是每张刚渲染好的图立刻显示「源码已变」——两处算法不一致造成的假过期。
   *
   * @param {string} module
   * @returns {Promise<string>}
   */
  async #fingerprintOf(module) {
    return moduleFingerprint(join(this.#projectRoot, module), {
      modules: await this.#moduleClosure(module),
    })
  }

  /**
   * 取某个模块的依赖闭包（含自己）。
   *
   * 递归展开 `project(...)` 依赖，最多 8 层防止环。闭包只跟构建脚本有关，
   * 所以缓存起来——它不会随着改源码而变化，改了构建脚本才会重算。
   *
   * @param {string} module
   * @returns {Promise<string[]>} 绝对路径列表。
   */
  async #moduleClosure(module) {
    const cached = this.#closures.get(module)
    if (cached !== undefined) return cached
    const seen = new Set()
    const queue = [module]
    const dirs = []
    for (let depth = 0; depth < 8 && queue.length > 0; depth++) {
      const batch = queue.splice(0, queue.length)
      for (const name of batch) {
        if (seen.has(name)) continue
        seen.add(name)
        const dir = join(this.#projectRoot, name)
        if (!existsSync(dir)) continue
        dirs.push(dir)
        for (const dependency of await projectDependencies(dir)) {
          if (!seen.has(dependency)) queue.push(dependency)
        }
      }
    }
    this.#closures.set(module, dirs)
    return dirs
  }

  /**
   * 列出全部 preview 及其状态。**不触发渲染**，这是首屏 1 秒的关键。
   * @returns {Promise<object>}
   */
  async list() {
    await this.#load()
    await this.#refreshFingerprints()
    const entries = []
    for (const entry of this.#entries.values()) {
      const status = this.#statusOf(entry)
      entries.push({
        key: entry.key,
        module: entry.module,
        fqn: entry.fqn,
        previewId: entry.previewId,
        title: entry.title,
        status,
        renderedAt: entry.renderedAt,
        renderer: entry.renderer,
        width: entry.width,
        height: entry.height,
        treeNodes: entry.treeNodes,
        hasImage: entry.renderedAt !== undefined && existsSync(this.imagePath(entry.key)),
        /* flavored 模块只能走 Studio 渲染，面板要把这件事显示出来。 */
        ...(entry.flavored === true ? { flavored: true, needsStudio: true } : {}),
        previewParams: entry.previewParams,
        lastError: entry.lastError,
        lastErrorAt: entry.lastErrorAt,
      })
    }
    /* 按模块配置顺序分组，组内按名字排；面板直接照这个顺序铺。 */
    const order = new Map(this.#modules.map((module, index) => [module, index]))
    entries.sort((a, b) => {
      const moduleOrder = (order.get(a.module) ?? 999) - (order.get(b.module) ?? 999)
      return moduleOrder !== 0 ? moduleOrder : a.title.localeCompare(b.title)
    })
    const jobs = this.jobList()
    return {
      projectRoot: this.#projectRoot,
      repoLabel: repoLabel(this.#projectRoot),
      modules: this.modules,
      entries,
      counts: {
        total: entries.length,
        fresh: entries.filter((e) => e.status === 'fresh').length,
        stale: entries.filter((e) => e.status === 'stale').length,
        never: entries.filter((e) => e.status === 'never').length,
        error: entries.filter((e) => e.status === 'error').length,
      },
      scan: this.scanState,
      jobs,
      /* 进度聚合放在这里，前端不必自己数 `jobs`——那数组只保留有限条历史，
         一次 42 个的批量会把早先的条目挤掉，数出来的总数会中途缩水。 */
      jobSummary: summarizeJobs(jobs),
      batches: this.batchList(),
      cache: { maxMb: this.maxCacheMb },
    }
  }

  /**
   * 重新扫描所有模块的 @Preview 清单。
   *
   * 只在用户点「刷新索引」或首次打开面板时调用：`preview list` 要配一次 Gradle，
   * 实测 1 秒（增量后），但没必要每次 list 都跑。
   *
   * @returns {Promise<object>} 与 list() 相同的结构。
   */
  /**
   * 重扫模块的 @Preview 清单。
   *
   * 分两种模块走不同路径，这是实测逼出来的：
   *
   * - **无 flavors**：跑 `android preview list`，拿到的还有
   *   `previewParams`（name/widthDp/locale），信息最全；
   * - **有 flavors**：CLI 必然失败（它硬编码找 `debug` 变体，实际叫
   *   `StandardDebug`），所以改从源码正则提取 FQN。这一条让那 42 个
   *   preview 也能出现在面板里——它们只能走 Studio 渲染。
   *
   * 只扫「确实含 @Preview」的模块：全量跑 CLI 实测 3 秒/模块，
   * 28 个模块要 90 秒，而预筛只要 141 毫秒。
   *
   * @returns {Promise<object>} 与 list() 相同的结构。
   */
  async reconcile() {
    await this.#load()
    /* 重扫意味着构建脚本可能也动过，依赖闭包要重新展开。 */
    this.#closures.clear()
    if (this.#scan.running) return this.list()
    this.#scan = {
      running: true,
      startedAt: Date.now(),
      finishedAt: 0,
      error: undefined,
      cliAvailable: this.#scan.cliAvailable,
      modules: [],
      progress: { done: 0, total: 0 },
      discovery: undefined,
    }
    const seen = new Set()
    try {
      await mkdir(this.#dir, { recursive: true })

      /* 第一步：发现。配置里显式给了模块就照它来，否则自动扫描。
         自动扫描失败（没有 settings.gradle.kts）时退回内置列表。 */
      const configured = this.#configuredModules
      let targets
      if (configured !== undefined) {
        targets = configured.map((path) => ({ path, flavored: undefined }))
        this.#scan.discovery = { source: 'config', modules: targets.length }
      } else {
        const scan = await scanPreviewModules(this.#projectRoot)
        this.#scan.discovery = {
          source: 'auto',
          modules: scan.modules.length,
          skipped: scan.skipped.length,
          durationMs: scan.durationMs,
          summary: describeScan(scan),
        }
        targets = scan.modules.length > 0
          ? scan.modules
          : DEFAULT_MODULES.map((path) => ({ path, flavored: false }))
      }
      this.#scan.progress.total = targets.length
      this.#scannedModules = targets

      for (const target of targets) {
        const module = target.path
        const moduleDir = join(this.#projectRoot, module)
        /* dispose 之后不再为后续模块起子进程：scan.running 会在 finally 里
           复位，剩下的模块交给下一次 reconcile。 */
        if (this.#disposed) break
        if (!existsSync(moduleDir)) {
          this.#scan.progress.done += 1
          continue
        }
        let entries = []
        /* `flavored === undefined` 表示配置指定但没探测过，先探测一次。 */
        const flavored = target.flavored ?? (await declaresFlavors(moduleDir))
        if (flavored === true) {
          /* CLI 对 flavored 模块不可用，改从源码提取。 */
          const extracted = await extractPreviewFqns(moduleDir)
          entries = extracted.map((item) => ({ methodFqn: item.fqn }))
          this.#scan.cliAvailable = this.#scan.cliAvailable ?? true
        } else {
          let payload
          try {
            const run = spawnCli(this.#cli, ['preview', 'list', `:${module.split('/').join(':')}`, '--format=json'], {
              cwd: this.#projectRoot,
              timeoutMs: LIST_TIMEOUT_MS,
            })
            this.#activeChild = run
            const result = await run.promise
            this.#activeChild = undefined
            payload = JSON.parse(result.stdout)
            this.#scan.cliAvailable = true
          } catch (error) {
            this.#activeChild = undefined
            const message = String(error?.message ?? error)
            this.#scan.error = `${module}: ${message}`
            this.#scan.cliAvailable = error?.message?.includes('找不到命令') === true ? false : true
            /* CLI 挂了也还有源码可依：至少让卡片出现，渲染时才暴露真问题。 */
            const extracted = await extractPreviewFqns(moduleDir)
            entries = extracted.map((item) => ({ methodFqn: item.fqn }))
          }
          if (payload !== undefined) {
            entries = Array.isArray(payload?.previews) ? payload.previews : []
          }
        }
        for (const preview of entries) {
          const fqn = typeof preview?.methodFqn === 'string' ? preview.methodFqn : ''
          if (fqn.length === 0) continue
          const key = `${module}::${fqn}`
          seen.add(key)
          const split = splitFqn(fqn)
          const previous = this.#entries.get(key)
          const entry = {
            key,
            module,
            fqn,
            previewId: split.functionName,
            title: prettyTitle(split),
            ...(flavored === true ? { flavored: true } : {}),
            ...(previous?.renderedAt === undefined ? {} : { renderedAt: previous.renderedAt }),
            ...(previous?.renderer === undefined ? {} : { renderer: previous.renderer }),
            ...(previous?.sourceHash === undefined ? {} : { sourceHash: previous.sourceHash }),
            ...(previous?.width === undefined ? {} : { width: previous.width }),
            ...(previous?.height === undefined ? {} : { height: previous.height }),
            ...(previous?.treeNodes === undefined ? {} : { treeNodes: previous.treeNodes }),
            ...(previous?.lastError === undefined ? {} : { lastError: previous.lastError, lastErrorAt: previous.lastErrorAt }),
            ...(preview?.previewParams === undefined ? {} : { previewParams: preview.previewParams }),
          }
          this.#entries.set(key, entry)
          this.#dirty = true
        }
        this.#scan.progress.done += 1
      }

      /* 源码里删掉或改名的 preview：连同缓存一起清掉，免得卡片永远留着旧图。 */
      const liveModules = new Set(this.#scannedModules.map((target) => target.path))
      for (const [key, entry] of [...this.#entries]) {
        if (!liveModules.has(entry.module)) continue
        if (seen.has(key)) continue
        this.#entries.delete(key)
        this.#dirty = true
      }
      this.#scan.error = undefined
    } finally {
      this.#scan.running = false
      this.#scan.finishedAt = Date.now()
      await this.#save()
    }
    return this.list()
  }

  /**
   * 探测 Studio 是否可用且本项目已就绪。
   * @returns {Promise<{ available: boolean, project?: string, version?: string }>}
   */
  async studioStatus() {
    const now = Date.now()
    if (now - this.#studioProbe.at < STUDIO_PROBE_TTL_MS && this.#studioProbe.value !== undefined) {
      return this.#studioProbe.value
    }
    /* dispose 之后不再探测：`studio check` 也是子进程。 */
    if (this.#disposed) return { available: false }
    let value = { available: false }
    try {
      const run = spawnCli(this.#cli, ['studio', 'check'], { cwd: this.#projectRoot, timeoutMs: 30_000 })
      this.#activeChild = run
      const result = await run.promise
      this.#activeChild = undefined
      const parsed = parseStudioCheck(result.stdout)
      /* 只有项目路径与我们的一致才算可用：开着别的项目时渲染结果是错的。 */
      const mine = parsed.projects.find((project) => project.ready && resolve(project.path) === this.#projectRoot)
      if (mine !== undefined) {
        value = { available: true, project: this.#studioProject && parsed.projects.some((p) => p.name === this.#studioProject) ? this.#studioProject : mine.name, ...(parsed.version === undefined ? {} : { version: parsed.version }) }
      } else {
        value = { available: false, projects: parsed.projects.map((project) => ({ name: project.name, ready: project.ready })) }
      }
    } catch {
      this.#activeChild = undefined
      value = { available: false }
    }
    this.#studioProbe = { at: now, value }
    return value
  }

  /**
   * 发起一次渲染，立即返回任务号。
   *
   * 不等待渲染完成是刻意的：5 秒的渲染放进 HTTP 请求里，前端只能转圈，
   * 也就做不了「排队中 / 进度 / 取消」这些状态。
   *
   * @param {string} key - `${module}::${fqn}`。
   * @returns {Promise<{ jobId: string, queued: boolean, duplicate: boolean }>}
   */
  async enqueue(key) {
    await this.#load()
    const outcome = this.#enqueueOne(key)
    if (outcome === undefined) throw new Error(`索引里没有这个 preview：${key}，请先刷新索引`)
    return outcome
  }

  /**
   * 把一批 preview 一次性排进**同一条串行队列**。
   *
   * 为什么是「一次排一批」而不是「循环调用 enqueue」：单个渲染 2–8 秒，
   * 42 个 preview 要 3 分钟以上，前端一个一个点不可行。批量排队的价值不在于
   * 并行（并行的两个 Gradle 会争同一个目录锁，实测反而更慢），而在于
   * 一次请求就把整个模块铺进队列，之后 Gradle 预热与 daemon 复用都在
   * 同一条链上连续发生。
   *
   * 三件事按这个顺序：
   * 1. 去掉重复的 key（同一批里出现两次只排一次）；
   * 2. 跳过已经在排队/在跑的 key（复用那个 job，不新造——`enqueue` 的
   *    `duplicate` 判重语义保持不变，这里只是把结果汇总）；
   * 3. 其余的按传入顺序依次入队，**逐个排队**，不是一个批次一个 task：
   *    这样每个 key 都有自己的 job 状态，某个失败只影响它自己，后面的照常跑。
   *
   * @param {string[]} keys - 一批 `${module}::${fqn}`。
   * @returns {Promise<{ batchId: string, jobIds: string[], skipped: string[], unknown: string[], total: number }>}
   */
  async enqueueMany(keys) {
    await this.#load()
    const list = Array.isArray(keys) ? keys.filter((key) => typeof key === 'string' && key.length > 0) : []
    const batch = {
      id: `batch-${shortHash(`${Date.now()}:${Math.random()}`, 10)}`,
      keys: [],
      jobIds: [],
      skipped: [],
      unknown: [],
      running: false,
      /** jobId → 终态；由 `#settleBatch` 填写，批次进度只认它。 */
      settled: new Map(),
      startedAt: Date.now(),
      finishedAt: undefined,
    }
    const seen = new Set()
    for (const key of list) {
      if (seen.has(key)) continue
      seen.add(key)
      batch.keys.push(key)
      const outcome = this.#enqueueOne(key)
      if (outcome === undefined) {
        /* 索引里没有这个 key：不报错整批，只记下来让调用方知道。 */
        batch.unknown.push(key)
        continue
      }
      if (outcome.duplicate === true) batch.skipped.push(key)
      batch.jobIds.push(outcome.jobId)
    }
    /* 复用的 job（duplicate）可能早就结束或正在跑：先把已知终态填进去，
       否则进度会从「已完成 0/42」开始，看起来像又跑了一遍。 */
    for (const id of batch.jobIds) {
      const job = this.#jobs.get(id)
      if (job === undefined) continue
      if (job.status !== 'queued' && job.status !== 'running') batch.settled.set(id, job.status)
    }
    batch.running = batch.settled.size < batch.jobIds.length
    if (batch.running !== true) batch.finishedAt = Date.now()
    this.#batches.set(batch.id, batch)
    this.#trimBatches()
    return {
      batchId: batch.id,
      jobIds: batch.jobIds,
      skipped: batch.skipped,
      unknown: batch.unknown,
      total: batch.jobIds.length,
    }
  }

  /**
   * 把某个模块下的全部 preview 排进队列。
   *
   * 面板上的操作是「渲染这个模块」，所以这条路径比传一大串 key 更常用。
   * 只排该模块**需要更新**的（非 fresh）还是全部，由调用方通过 `options`
   * 决定；默认全排，因为「批量渲染」的语义就是「把这一批都刷新一遍」。
   *
   * @param {string} module - 如 `feature/account/impl`。
   * @param {{ onlyOutdated?: boolean }} [options] - `onlyOutdated` 跳过已经 fresh 的。
   * @returns {Promise<{ batchId: string, jobIds: string[], skipped: string[], unknown: string[], total: number }>}
   */
  async enqueueModule(module, options = {}) {
    await this.#load()
    /* 指纹得先有值，`onlyOutdated` 才判得准；list() 顺带刷新了它。 */
    if (options.onlyOutdated === true) await this.#refreshFingerprints()
    const keys = []
    for (const entry of this.#entries.values()) {
      if (entry.module !== module) continue
      if (options.onlyOutdated === true && this.#statusOf(entry) === 'fresh') continue
      keys.push(entry.key)
    }
    if (keys.length === 0) {
      return { batchId: '', jobIds: [], skipped: [], unknown: [], total: 0 }
    }
    return this.enqueueMany(keys)
  }

  /**
   * 入队一个 key 的内部实现；索引里没有时返回 `undefined`。
   *
   * 抽出来是因为 `enqueue` 要抛异常、批量路径要跳过，两者语义不同但
   * 判重与排队必须走同一段代码——`duplicate` 的行为是前端依赖的。
   *
   * @param {string} key
   * @returns {{ jobId: string, queued: boolean, duplicate: boolean } | undefined}
   */
  #enqueueOne(key) {
    const entry = this.#entries.get(key)
    if (entry === undefined) return undefined
    /* 同一个 preview 已经在队列里就复用那个任务，避免连点堆出五六个 Gradle。 */
    for (const job of this.#jobs.values()) {
      if (job.key === key && (job.status === 'queued' || job.status === 'running')) {
        return { jobId: job.id, queued: job.status === 'queued', duplicate: true }
      }
    }
    const id = `job-${shortHash(`${key}:${Date.now()}:${Math.random()}`, 12)}`
    const job = {
      id,
      key,
      module: entry.module,
      fqn: entry.fqn,
      title: entry.title,
      status: /** @type {'queued' | 'running' | 'done' | 'error' | 'cancelled'} */ ('queued'),
      queuedAt: Date.now(),
    }
    this.#jobs.set(id, job)
    /* 串成一条链：一次只跑一个 Gradle。 */
    this.#queue = this.#queue.then(() => this.#run(job)).catch((error) => {
      job.status = 'error'
      job.error = String(error?.message ?? error)
      job.finishedAt = Date.now()
      this.#finish(job)
    })
    return { jobId: id, queued: true, duplicate: false }
  }

  /**
   * 某个 job 落定时，把它记进所属批次的 `settled`。
   *
   * 为什么不用定时轮询：轮询有两个坑——第一次 tick 要等 200 ms（前端会看到
   * 一个已经跑完的 batch 仍显示 `active: true`），以及 job 记录被历史裁剪
   * 之后就数不到了（42 个的批量跑到一半，进度反而往回退）。在 `#run` 的
   * finally 里同步记账，两个坑都不存在。
   *
   * @param {any} job
   * @returns {void}
   */
  #settleBatch(job) {
    if (this.#batches.size === 0) return
    for (const batch of this.#batches.values()) {
      if (batch.jobIds.includes(job.id) !== true) continue
      batch.settled.set(job.id, job.status)
      if (batch.settled.size >= batch.jobIds.length && batch.running === true) {
        batch.running = false
        batch.finishedAt = Date.now()
      }
    }
  }

  /** 批次记录只留最近几条。 */
  #trimBatches() {
    if (this.#batches.size <= MAX_BATCH_HISTORY) return
    const finished = [...this.#batches.values()]
      .filter((batch) => batch.running !== true)
      .sort((a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt))
    for (const stale of finished.slice(0, this.#batches.size - MAX_BATCH_HISTORY)) this.#batches.delete(stale.id)
  }

  /**
   * 批次快照，带实时进度。
   *
   * 进度只认 `settled`（job 落定时记下的终态），不数 `#jobs`——那本字典会
   * 被历史裁剪挤掉条目，数出来的总数会中途缩水。
   *
   * @returns {object[]}
   */
  batchList() {
    return [...this.#batches.values()].map((batch) => {
      let done = 0
      let failed = 0
      let cancelled = 0
      for (const status of batch.settled.values()) {
        if (status === 'error') failed += 1
        else if (status === 'cancelled') cancelled += 1
        else done += 1
      }
      const total = batch.jobIds.length
      const finished = done + failed + cancelled
      const running = total - finished
      return {
        id: batch.id,
        total,
        done,
        failed,
        cancelled,
        /* `queued` / `running` 只表示「还没落定」，前端画进度条用的是
           `finished / total`，这两个字段留着方便排查「卡在哪」。 */
        queued: running,
        running: 0,
        finished,
        percent: total === 0 ? 100 : Math.round((finished / total) * 100),
        skipped: batch.skipped.length,
        unknown: batch.unknown.length,
        active: batch.running === true,
        startedAt: batch.startedAt,
        finishedAt: batch.finishedAt,
      }
    })
  }

  /**
   * 真正跑一次渲染。
   * @param {any} job
   * @returns {Promise<void>}
   */
  async #run(job) {
    /* 所有终态（cancelled / entry 没了 / done / error）都要走 `#finish`，
       否则批次进度会永远停在「还有 1 个没跑完」。 */
    if (this.#disposed) {
      job.status = 'cancelled'
      job.finishedAt = Date.now()
      this.#finish(job)
      return
    }
    if (job.status === 'cancelled') {
      job.finishedAt = job.finishedAt ?? Date.now()
      this.#finish(job)
      return
    }
    const entry = this.#entries.get(job.key)
    if (entry === undefined) {
      job.status = 'error'
      job.error = '索引里已经没有这个 preview'
      job.finishedAt = Date.now()
      this.#finish(job)
      return
    }
    job.status = 'running'
    job.startedAt = Date.now()
    try {
      const outcome = await this.#renderEntry(entry)
      const fingerprint = await this.#fingerprintOf(entry.module)
      this.#fingerprints.set(entry.module, fingerprint)
      job.status = 'done'
      job.renderer = outcome.renderer
      job.width = outcome.width
      job.height = outcome.height
      job.treeNodes = outcome.treeNodes
      job.error = undefined
      this.#entries.set(entry.key, {
        ...entry,
        renderedAt: Date.now(),
        renderer: outcome.renderer,
        sourceHash: fingerprint,
        width: outcome.width,
        height: outcome.height,
        treeNodes: outcome.treeNodes,
        lastError: undefined,
        lastErrorAt: undefined,
      })
      this.#dirty = true
      await this.#save()
      /* 渲染成功是**唯一**会让缓存目录变大的时刻（一次多出 png + json），
         所以清理挂在这里：只在真正增长之后跑，不在 list() 那条首屏路径上
         扫目录。此刻用户正在等图，多出几十毫秒无感。
         失败路径不清理：那时没有新文件（中间产物已在 #renderWithHeadless
         的 finally 里删掉），扫一遍目录纯属浪费，而且「失败不清旧图」
         的承诺不该被一次清理顺手违背。 */
      try {
        await this.trimCache()
      } catch (error) {
        this.#logger.warn?.(`[android-mirror-pane] preview 缓存清理失败：${String(error?.message ?? error)}`)
      }
    } catch (error) {
      job.status = 'error'
      job.error = String(error?.message ?? error)
      /* 失败不清旧图：上一张仍然比空白有用，卡片会用 error 徽标提示。 */
      this.#entries.set(entry.key, {
        ...entry,
        lastError: job.error,
        lastErrorAt: Date.now(),
      })
      this.#dirty = true
      await this.#save()
    } finally {
      this.#activeChild = undefined
      job.finishedAt = Date.now()
      this.#finish(job)
    }
  }

  /**
   * job 落定后的统一收尾：记批次进度、裁历史。
   * @param {any} job
   * @returns {void}
   */
  #finish(job) {
    this.#settleBatch(job)
    this.#trimJobs()
  }

  /**
   * 裁掉过老的 job 记录。
   *
   * 只裁已经结束的：批量渲染 42 个时有 41 个还 `queued`，如果按「总数超了就删」
   * 去删，正在排队的任务会被挤掉，前端看到进度倒退、卡片也不再显示「排队中」。
   * 所以先数「活跃」的条数，超出上限的那部分只从已结束的记录里裁——
   * 活跃的多到超过上限时就不裁（宁可多留几条记录，也不能丢任务）。
   *
   * @returns {void}
   */
  #trimJobs() {
    const active = [...this.#jobs.values()].filter((job) => job.status === 'queued' || job.status === 'running')
    const limit = Math.max(MAX_JOB_HISTORY, active.length)
    if (this.#jobs.size <= limit) return
    const finished = [...this.#jobs.values()]
      .filter((job) => job.status !== 'queued' && job.status !== 'running')
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
    for (const stale of finished.slice(0, this.#jobs.size - limit)) this.#jobs.delete(stale.id)
  }

  /**
   * 按配置选路径渲染一个 preview，并把产物落到缓存目录。
   *
   * @param {PreviewEntry} entry
   * @returns {Promise<{ renderer: string, width: number, height: number, treeNodes: number }>}
   */
  async #renderEntry(entry) {
    /* dispose 之后一律不再起子进程：面板已经关掉，此时再拉一个 Gradle
       只会让用户在后台看到一个跑满 CPU 的 daemon 却找不到是谁。 */
    if (this.#disposed) throw new Error('面板已关闭，渲染取消')
    await mkdir(this.#dir, { recursive: true })
    const studio = await this.studioStatus()
    /* 探测 Studio 也要几百毫秒，期间可能被 dispose；spawn 前再确认一次。 */
    if (this.#disposed) throw new Error('面板已关闭，渲染取消')
    const preferStudio = this.#renderer === 'studio' || (this.#renderer === 'auto' && studio.available)
    /* flavored 模块的 headless 路径是死的：CLI 硬编码找 `debug` 变体，
       而实际变体叫 `StandardDebug`，跑起来必然失败。所以这里直接给出
       可操作的错误，而不是让用户对着 `Runfiles command failed` 猜。 */
    if (entry.flavored === true && preferStudio === false) {
      throw new Error(
        '这个模块声明了 productFlavors，只能用 Android Studio 渲染。'
        + '请打开 Android Studio 并等本项目索引完成（android studio check 显示 READY）后重试。',
      )
    }
    if (preferStudio) {
      try {
        return await this.#renderWithStudio(entry)
      } catch (error) {
        if (this.#renderer === 'studio') throw error
        if (entry.flavored === true) {
          /* 已经确认 headless 对它是死路，不要再降级去撞一次。 */
          throw error
        }
        /* auto 模式下 Studio 失败（进入 indexing、文件没保存等）就降级，
           否则用户会以为是插件坏了。降级这件事会标在详情页上。 */
        this.#logger.warn?.(`[android-mirror-pane] Studio 渲染失败，降级 headless：${String(error?.message ?? error)}`)
      }
    }
    return this.#renderWithHeadless(entry)
  }

  /**
   * headless 路径：只依赖 Gradle，Studio 关着也能用。
   * @param {PreviewEntry} entry
   */
  async #renderWithHeadless(entry) {
    /* CLI 会在这里铺出完整的包目录结构；我们只留最终的 png 与归一化后的 tree，
       中间产物在下面 finally 里删掉——实测单个 preview 就有 3.6 MB。 */
    const outDir = join(this.#dir, `render-${shortHash(entry.key)}`)
    const reference = `:${entry.module.split('/').join(':')}`
    try {
      return await this.#renderHeadlessInto(entry, outDir, reference)
    } finally {
      await rm(outDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * headless 渲染的实际步骤，抽出来只为让外层 finally 统一清理中间产物。
   * @param {PreviewEntry} entry
   * @param {string} outDir
   * @param {string} reference
   */
  async #renderHeadlessInto(entry, outDir, reference) {
    const run = spawnCli(this.#cli, [
      'preview', 'render', reference,
      `--fqn=${entry.fqn}`,
      '--component-tree',
      '--format=json',
      '-o', outDir,
    ], { cwd: this.#projectRoot, timeoutMs: RENDER_TIMEOUT_MS })
    this.#activeChild = run
    const result = await run.promise
    this.#activeChild = undefined
    const payload = JSON.parse(result.stdout)
    if (payload?.success !== true) {
      throw new Error(payload?.globalError ?? '渲染失败：CLI 未返回 success')
    }
    const item = Array.isArray(payload.results) ? payload.results.find((r) => r?.methodFqn === entry.fqn) ?? payload.results[0] : undefined
    if (item === undefined) throw new Error('渲染失败：结果里没有这个 preview')
    if (typeof item.imagePath !== 'string' || !existsSync(item.imagePath)) {
      throw new Error('渲染失败：没有生成图片')
    }
    const png = await readFile(item.imagePath)
    await writeFile(this.imagePath(entry.key), png)
    let tree
    if (typeof item.componentTreePath === 'string' && existsSync(item.componentTreePath)) {
      const raw = JSON.parse(await readFile(item.componentTreePath, 'utf8'))
      tree = normalizeHeadlessTree(raw)
    } else {
      tree = { width: 0, height: 0, renderer: 'headless', nodes: [] }
    }
    await this.#writeTree(entry.key, tree)
    return {
      renderer: 'headless',
      width: tree.width,
      height: tree.height,
      treeNodes: tree.nodes.length,
    }
  }

  /**
   * Studio 路径：快一倍，语义树是 TextView/Button 这种可读的名字。
   * @param {PreviewEntry} entry
   */
  async #renderWithStudio(entry) {
    const studio = await this.studioStatus()
    if (studio.available !== true || studio.project === undefined) {
      throw new Error('Studio 不可用')
    }
    const split = splitFqn(entry.fqn)
    const file = await this.#resolveSourceFile(entry.module, split)
    if (file === undefined) throw new Error(`找不到 preview 的源文件：${split.fileName}`)
    const imagePath = this.imagePath(entry.key)
    const run = spawnCli(this.#cli, [
      'studio', 'render-compose-preview',
      `--output-image-file=${imagePath}`,
      '--print-semantics',
      `--project=${studio.project}`,
      relative(this.#projectRoot, file),
      split.functionName,
    ], { cwd: this.#projectRoot, timeoutMs: RENDER_TIMEOUT_MS })
    this.#activeChild = run
    const result = await run.promise
    this.#activeChild = undefined
    if (!existsSync(imagePath)) throw new Error('渲染失败：Studio 没有生成图片')
    const tree = normalizeStudioTree(result.stdout)
    await this.#writeTree(entry.key, tree)
    return { renderer: 'studio', width: tree.width, height: tree.height, treeNodes: tree.nodes.length }
  }

  /**
   * 把 FQN 映射回源文件。
   *
   * 先按约定拼路径（快路径）；不在就退化为模块内按文件名搜一遍，
   * 因为实际项目里既有 `src/main/kotlin` 也有别处生成的源码目录。
   *
   * @param {string} module
   * @param {{ packageName: string, fileName: string }} split
   * @returns {Promise<string | undefined>}
   */
  async #resolveSourceFile(module, split) {
    const moduleDir = join(this.#projectRoot, module)
    const packagePath = split.packageName.split('.').join(sep)
    for (const sourceSet of ['main', 'debug', 'release']) {
      for (const language of ['kotlin', 'java']) {
        const candidate = join(moduleDir, 'src', sourceSet, language, packagePath, split.fileName)
        if (existsSync(candidate)) return candidate
      }
    }
    const found = await walkFiles(join(moduleDir, 'src'), (path) => path.endsWith(`/${split.fileName}`) || path.endsWith(sep + split.fileName))
    return found[0]
  }

  /**
   * 队列快照。
   * @returns {object[]}
   */
  jobList() {
    return [...this.#jobs.values()].map((job) => ({
      id: job.id,
      key: job.key,
      module: job.module,
      fqn: job.fqn,
      title: job.title,
      status: job.status,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      renderer: job.renderer,
      width: job.width,
      height: job.height,
      treeNodes: job.treeNodes,
      error: job.error,
    }))
  }

  /**
   * 读一个 preview 的语义树。
   * @param {string} key
   * @returns {Promise<object | undefined>}
   */
  async readTree(key) {
    try {
      const text = await readFile(this.treePath(key), 'utf8')
      const parsed = JSON.parse(text)
      if (parsed === null || typeof parsed !== 'object') return undefined
      if (!Array.isArray(parsed.nodes)) return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  /**
   * 丢掉一条记录的缓存文件。
   *
   * 只清渲染产物，**不删索引项**：这个 preview 仍在源码里，
   * 删掉条目会让卡片从总览里凭空消失，用户会以为它被删了。
   * 清完之后它的状态自然回到 `never`。
   *
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async forget(key) {
    await this.#load()
    const entry = this.#entries.get(key)
    if (entry === undefined) return false
    this.#entries.set(key, {
      key: entry.key,
      module: entry.module,
      fqn: entry.fqn,
      previewId: entry.previewId,
      title: entry.title,
      ...(entry.previewParams === undefined ? {} : { previewParams: entry.previewParams }),
    })
    this.#dirty = true
    await this.#save()
    for (const path of [this.imagePath(key), this.treePath(key), this.baselineTreePath(key)]) {
      try { await unlink(path) } catch { /* 已经没有就算了 */ }
    }
    /* 顺手把这棵树的中间产物目录也清掉，别让缓存目录越攒越大。 */
    try { await rm(join(this.#dir, `render-${shortHash(key)}`), { recursive: true, force: true }) } catch { /* 没跑过 headless */ }
    return true
  }

  /** 停止一切：杀掉正在跑的渲染进程，不让面板关掉后还留一个 Gradle daemon 在跑。 */
  dispose() {
    this.#disposed = true
    this.#activeChild?.kill()
    this.#activeChild = undefined
    for (const job of this.#jobs.values()) {
      if (job.status === 'queued') {
        job.status = 'cancelled'
        job.finishedAt = Date.now()
        this.#settleBatch(job)
      }
    }
    /* 批次也一起收尾：dispose 之后 `#watchBatch` 不会再看到 pending，
       但立刻标掉更准确——面板关掉时进度条不该停在 40%。 */
    for (const batch of this.#batches.values()) {
      if (batch.running === true) {
        batch.running = false
        batch.finishedAt = Date.now()
      }
    }
  }
}

/**
 * 按大写字母切词：`PhoneLogin` → `Phone Login`。
 * @param {string} text
 * @returns {string}
 */
function spaced(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 由 FQN 生成给人看的名字。
 *
 * 实测 40 个 preview 的命名高度规律：类名是 `<页面>ScreenKt`，函数是
 * `<页面>ContentPreview`。所以两边都要先剥掉这些模板词，再判断「函数名
 * 是不是只是把类名重复了一遍」——是的话只显示一次，
 * 于是 `PhoneLoginScreenKt.PhoneLoginContentPreview` 变成 `Phone Login`，
 * 而不是 `Phone Login · Phone Login Content`。
 *
 * @param {{ className: string, functionName: string }} split
 * @returns {string}
 */
export function prettyTitle(split) {
  const classBase = split.className.replace(/Kt$/, '').replace(/(Screen|Dialog|Activity|Fragment|Page|View)$/, '')
  const fnBase = split.functionName
    .replace(/Preview$/, '')
    .replace(/(Content|Screen|Body)$/, '')
  if (fnBase.length === 0 || fnBase === classBase) return spaced(classBase)
  /* 函数名常以类名为前缀（`ImageCaptchaDialogBody`），去掉重复的那一段。 */
  if (fnBase.startsWith(classBase) && fnBase.length > classBase.length) {
    const rest = fnBase.slice(classBase.length)
    return `${spaced(classBase)} · ${spaced(rest)}`
  }
  if (classBase.startsWith(fnBase)) return spaced(classBase)
  return `${spaced(classBase)} · ${spaced(fnBase)}`
}

/**
 * 多项目分派：按会话找到对应的 PreviewService。
 *
 * 为什么需要这一层：面板是挂在会话上的，同一个 DSH 里可能同时开着两个
 * 安卓仓库。索引、指纹、渲染队列都与「哪个项目」强绑定（模块名相对项目根、
 * 缓存按项目分目录），所以一个项目一个 Service 最不容易串。
 *
 * 路由只跟这个 Hub 打交道，不必知道内部有几个项目。
 */
export class PreviewHub {
  #resolveProjectRoot
  #defaultRoot
  #options
  #logger
  /** @type {Map<string, PreviewService>} */
  #services = new Map()

  /**
   * @param {{
   *   defaultRoot: string,
   *   resolveProjectRoot?: (sessionId: string) => string | undefined,
   *   options: object,
   *   logger?: any,
   * }} input
   */
  constructor(input) {
    this.#defaultRoot = input.defaultRoot
    this.#resolveProjectRoot = input.resolveProjectRoot
    this.#options = input.options ?? {}
    this.#logger = input.logger ?? console
  }

  /**
   * 某个会话该用哪个项目根。
   * @param {string | undefined} sessionId
   * @returns {string}
   */
  rootFor(sessionId) {
    if (sessionId === undefined || this.#resolveProjectRoot === undefined) return this.#defaultRoot
    try {
      const directory = this.#resolveProjectRoot(sessionId)
      if (typeof directory !== 'string' || directory.length === 0) return this.#defaultRoot
      /* 会话目录可能就是项目内的子目录（agent 用 cd 进过 feature 模块），
         所以向上找 gradlew 再决定项目根。 */
      return findAndroidProject(directory) ?? this.#defaultRoot
    } catch {
      return this.#defaultRoot
    }
  }

  /**
   * 取（必要时创建）某个会话对应的服务。
   * @param {string | undefined} sessionId
   * @returns {PreviewService}
   */
  serviceFor(sessionId) {
    const root = this.rootFor(sessionId)
    const existing = this.#services.get(root)
    if (existing !== undefined) return existing
    const service = new PreviewService({ ...this.#options, projectRoot: root, logger: this.#logger })
    this.#services.set(root, service)
    return service
  }

  /** 全部已创建的服务。 */
  get services() {
    return [...this.#services.values()]
  }

  /** 停止一切。 */
  dispose() {
    for (const service of this.#services.values()) service.dispose()
    this.#services.clear()
  }
}
