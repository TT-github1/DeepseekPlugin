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
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
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
  #queue = Promise.resolve()
  #activeChild = undefined
  #disposed = false
  #studioProbe = { at: 0, value: undefined }
  #scan = { running: false, startedAt: 0, finishedAt: 0, error: undefined, cliAvailable: undefined }

  /**
   * @param {{
   *   projectRoot: string,
   *   modules?: string[],
   *   androidCli?: string,
   *   renderer?: 'auto' | 'headless' | 'studio',
   *   studioProject?: string,
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
    /* 缓存按项目分目录：不同仓库的 preview 同名不同图，混在一个目录里会串。 */
    this.#dir = join(homedir(), '.dsh', CACHE_ROOT, shortHash(this.#projectRoot, 12))
  }

  /** 缓存目录。 */
  get directory() {
    return this.#dir
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

  /**
   * 重算全部模块的指纹。
   * @returns {Promise<void>}
   */
  async #refreshFingerprints() {
    const next = new Map()
    for (const module of this.#modules) {
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
      const current = this.#fingerprints.get(entry.module)
      let status
      if (entry.renderedAt === undefined) {
        status = entry.lastError === undefined ? 'never' : 'error'
      } else if (entry.lastError !== undefined) {
        status = 'error'
      } else if (current !== undefined && entry.sourceHash !== current) {
        status = 'stale'
      } else {
        status = 'fresh'
      }
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
      jobs: this.jobList(),
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
    const entry = this.#entries.get(key)
    if (entry === undefined) throw new Error(`索引里没有这个 preview：${key}，请先刷新索引`)
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
    })
    return { jobId: id, queued: true, duplicate: false }
  }

  /**
   * 真正跑一次渲染。
   * @param {any} job
   * @returns {Promise<void>}
   */
  async #run(job) {
    if (this.#disposed) {
      job.status = 'cancelled'
      return
    }
    if (job.status === 'cancelled') return
    const entry = this.#entries.get(job.key)
    if (entry === undefined) {
      job.status = 'error'
      job.error = '索引里已经没有这个 preview'
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
      /* 只留最近 20 条任务记录，队列状态不用无限长。 */
      if (this.#jobs.size > 20) {
        const finished = [...this.#jobs.values()]
          .filter((item) => item.status !== 'queued' && item.status !== 'running')
          .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
        for (const stale of finished.slice(0, this.#jobs.size - 20)) this.#jobs.delete(stale.id)
      }
    }
  }

  /**
   * 按配置选路径渲染一个 preview，并把产物落到缓存目录。
   *
   * @param {PreviewEntry} entry
   * @returns {Promise<{ renderer: string, width: number, height: number, treeNodes: number }>}
   */
  async #renderEntry(entry) {
    await mkdir(this.#dir, { recursive: true })
    const studio = await this.studioStatus()
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
    await writeFile(this.treePath(entry.key), JSON.stringify(tree), 'utf8')
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
    await writeFile(this.treePath(entry.key), JSON.stringify(tree), 'utf8')
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
    for (const path of [this.imagePath(key), this.treePath(key)]) {
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
      if (job.status === 'queued') job.status = 'cancelled'
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
