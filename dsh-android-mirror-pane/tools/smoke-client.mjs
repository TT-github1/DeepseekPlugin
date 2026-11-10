/**
 * 真实渲染冒烟测试：把 client.js 的组件在 Node 里真跑一遍。
 *
 * 为什么需要它：`node --check` 只验语法，抓不到「变量在声明前被引用」
 * 这类错误——它们语法正确，但组件一渲染就抛 TDZ，整个面板白屏。
 * 这个坑实际踩到过：`imageUrl` 被放在使用它的 useEffect 依赖数组之后，
 * 语法检查全过，用户看到的是空白。
 *
 * 做法：mock 一个最小 React（useState / useEffect / useRef / useCallback
 * 真实记录调用顺序），再 mock 一个能记账的 DOM，然后把组件函数调一次。
 * 只要代码里存在 TDZ 或未捕获的类型错误，这里就会直接抛出来。
 *
 *   node tools/smoke-client.mjs
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = await readFile(join(here, '..', 'client.js'), 'utf8')

/**
 * 极简 DOM 元素：只实现组件里真正用到的部分。
 * getBoundingClientRect 返回固定尺寸，让测量逻辑能拿到确定的数。
 */
function makeElement(tag) {
  const node = {
    tagName: tag,
    style: {},
    dataset: {},
    children: [],
    scrollLeft: 0,
    scrollTop: 0,
    naturalWidth: 1080,
    naturalHeight: 1920,
    complete: true,
    className: '',
    appendChild(child) {
      this.children.push(child)
      return child
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child)
      return child
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getBoundingClientRect() {
      /* 容器 800×900，图片按 contain 后位于 (149,3)，尺寸 503×894。 */
      return this.tagName === 'img'
        ? { left: 149, top: 3, width: 503, height: 894 }
        : { left: 0, top: 0, width: 800, height: 900 }
    },
  }
  return node
}

/** 记录所有 createElement 调用，便于断言"确实渲染了东西"。 */
const rendered = []

/** 本轮渲染中途登记的 effect 体，渲染结束后补跑（见 renderOnce）。 */
const pendingEffects = []

/**
 * 当前这次"挂载"的 hook 状态槽。
 *
 * React 的 hook 靠调用顺序定位状态。这里同样按顺序存进一个数组，
 * 于是同一个组件重渲染时能拿到上次的值——这是让 setState 真正生效的前提。
 * 每次 mount() 重置，模拟一次全新挂载。
 */

/**
 * 两个依赖数组是否等价。
 * 两边都不是数组（例如省略依赖）视为不等价——React 的语义是「省略就每次都跑」。
 */
function depsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  return a.every((value, index) => Object.is(value, b[index]))
}

let hookSlots = []
let hookCursor = 0
/** effect 的状态槽：按调用顺序记依赖数组，用来判断要不要重跑。 */
let effectSlots = []
let effectCursor = 0
/** useCallback 的槽：依赖不变就返回同一个函数引用。 */
let callbackSlots = []
let callbackCursor = 0
/** setState 被调用过就置位，渲染循环据此决定要不要再渲染一轮。 */
let dirty = false

/** 开始一次新的挂载：清空状态槽。 */
function mount() {
  hookSlots = []
  hookCursor = 0
  effectSlots = []
  effectCursor = 0
  callbackSlots = []
  callbackCursor = 0
  dirty = false
}

/**
 * 在组件函数外层包一层：调用前把游标归零，调用后不重置。
 *
 * 不重置游标是刻意的——同一轮渲染里每个 hook 依次取到自己的槽；
 * 重渲染时由 mount 之外的 drive() 重置。
 */
function withHooks(fn) {
  hookCursor = 0
  effectCursor = 0
  callbackCursor = 0
  return fn()
}

const React = {
  createElement(type, props, ...children) {
    const node = { type, props: props ?? {}, children: children.flat() }
    rendered.push(node)
    return node
  },
  useState(initial) {
    const index = hookCursor++
    if (!(index in hookSlots)) {
      hookSlots[index] = typeof initial === 'function' ? initial() : initial
    }
    const setter = (next) => {
      const resolved = typeof next === 'function' ? next(hookSlots[index]) : next
      /* 浅比较：值没变就不标脏，避免 effect 里 setState 同类值导致死循环。 */
      if (resolved !== hookSlots[index]) {
        hookSlots[index] = resolved
        dirty = true
      }
    }
    return [hookSlots[index], setter]
  },
  useEffect(effect, deps) {
    /* 按依赖数组决定要不要重跑——真实 React 就是这个语义。
       早先无条件每次重跑，于是 effect 里 setState 会让下一轮又登记同一个
       effect，无限循环直到撞上 MAX_PASSES。 */
    const index = effectCursor++
    const previous = effectSlots[index]
    const same = previous !== undefined
      && Array.isArray(deps) && Array.isArray(previous.deps)
      && deps.length === previous.deps.length
      && deps.every((value, at) => Object.is(value, previous.deps[at]))
    if (same) return undefined
    effectSlots[index] = { deps }
    /* 排进队列、由 renderOnce 在本轮渲染结束后统一执行。
       早先这里是「只记录不执行」，理由是"需要完整挂载时序"，
       结果留下一个真实盲区：详情页的点击反查、导出、缩放重测全在 effect
       与事件回调里，冒烟测试一个都没碰到——effect 体里写错变量名照样全绿。
       实际上 effect 体对时序的要求只有一条：组件函数已经跑完。
       渲染结束后补跑足够覆盖，见 flushEffects。 */
    pendingEffects.push(effect)
    return undefined
  },
  useCallback(fn, deps) {
    /* 按依赖数组稳定引用：真实 React 在依赖不变时返回同一个函数。
       早先无条件 `return fn`，于是每次渲染都造出新函数，
       依赖它的 effect 次次被判为「变了」——effect 反复重跑 + setState，
       渲染永远不收敛。 */
    const index = callbackCursor++
    const previous = callbackSlots[index]
    const same = previous !== undefined
      && depsEqual(previous.deps, deps)
    if (same) return previous.fn
    callbackSlots[index] = { fn, deps }
    return fn
  },
  useRef(initial) {
    return { current: initial ?? null }
  },
  useMemo(fn) {
    return fn()
  },
}

const styleElements = []
const documentMock = {
  head: { appendChild: (node) => styleElements.push(node) },
  createElement: (tag) => makeElement(tag),
  getElementById: () => null,
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
}

const windowMock = {
  __DAMP_LOADED__: false,
  __ModuleLoader__: {
    load(spec) {
      captured = spec
    },
  },
  addEventListener() {},
  removeEventListener() {},
  getComputedStyle: () => ({
    borderLeftWidth: '0px',
    borderTopWidth: '0px',
    paddingLeft: '3px',
    paddingTop: '3px',
  }),
  devicePixelRatio: 2,
}

let captured
globalThis.window = windowMock
globalThis.document = documentMock
/* Node 24 的 navigator 是只读 getter，用 defineProperty 覆盖。 */
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
/**
 * fetch 的 mock：按 URL 分派。
 *
 * 早先是「任何请求都回同一棵空树」，于是两个分支**测不到**：
 * 详情页的 diff 面板（要 hasBaseline、要三组变更数据）、
 * 总览页的批量进度条（要 summary 里 queued/running 大于 0）。
 * 拉进来都是空数据，等于那部分渲染代码从未执行。
 */
const fetchRoutes = {
  tree: { width: 1080, height: 1920, renderer: 'studio', nodes: [] },
  status: {
    jobs: [{ id: 'job-1', key: 'feature/x::com.demo.XKt.XPreview', status: 'running' }],
    summary: { total: 3, queued: 1, running: 1, done: 1, failed: 0, cancelled: 0, finished: 1, percent: 33 },
    batches: [{
      id: 'batch-1',
      keys: ['a', 'b', 'c'],
      jobIds: ['job-1'],
      total: 3,
      done: 1,
      failed: 0,
      cancelled: 0,
      active: true,
      running: true,
      percent: 33,
    }],
  },
  list: {
    entries: [{
      key: 'feature/x::com.demo.XKt.XPreview',
      module: 'feature/x',
      fqn: 'com.demo.XKt.XPreview',
      previewId: 'XPreview',
      title: 'X',
      status: 'stale',
      hasImage: false,
    }],
    /* 首屏就带一个在跑的 job：`PreviewTab` 的轮询 effect 只在 activeIds
       非空时才启动，列表里没有活跃任务的话，批量进度条那条分支永远走不到。 */
    jobs: [{ id: 'job-1', key: 'feature/x::com.demo.XKt.XPreview', status: 'running' }],
    modules: ['feature/x'],
    scan: { running: false, startedAt: 0, finishedAt: 1 },
    jobSummary: { total: 3, queued: 1, running: 1, done: 1, failed: 0, cancelled: 0, finished: 1, percent: 33 },
    batches: [{
      id: 'batch-1',
      keys: ['a', 'b', 'c'],
      jobIds: ['job-1'],
      total: 3,
      done: 1,
      failed: 0,
      cancelled: 0,
      active: true,
      running: true,
      percent: 33,
    }],
    cache: { maxMb: 300 },
  },
  diff: {
    added: [{ id: 'a1', type: 'TextView', depth: 1, hasSemantics: true, text: '新增项', bounds: { left: 10, top: 20, right: 200, bottom: 60 } }],
    removed: [{ id: 'r1', type: 'Button', depth: 1, hasSemantics: true, text: '已删项', bounds: { left: 10, top: 80, right: 300, bottom: 140 } }],
    changed: [{
      id: 'c1',
      beforeId: 'c1',
      afterId: 'c1',
      type: 'Button',
      depth: 1,
      kind: 'both',
      matchedBy: 'geometry',
      changes: [{ field: 'text', before: '确定', after: '取消' }],
      boundsChange: {
        before: { left: 10, top: 200, right: 300, bottom: 260 },
        after: { left: 14, top: 208, right: 304, bottom: 268 },
        delta: { left: 4, top: 8, right: 4, bottom: 8, width: 0, height: 0 },
        maxDelta: 8,
      },
    }],
    unchanged: { count: 3 },
    frame: { before: { width: 1080, height: 1920 }, after: { width: 1080, height: 1920 }, sizeChanged: false, rendererChanged: false, changed: false },
    summary: { beforeNodes: 6, afterNodes: 6, added: 1, removed: 1, changed: 1, unchanged: 3, textChanged: 1, geometryChanged: 1, hasChanges: true },
    options: { minDelta: 1, semanticOnly: true },
    hasBaseline: true,
  },
}

globalThis.fetch = (url) => {
  const target = String(url ?? '')
  let payload = fetchRoutes.list
  if (target.includes('/preview/diff')) payload = fetchRoutes.diff
  else if (target.includes('/preview/tree')) payload = fetchRoutes.tree
  else if (target.includes('/preview/status')) payload = fetchRoutes.status
  return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
}
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
}
globalThis.AbortController = class {
  constructor() { this.signal = {} }
  abort() {}
}
/* 轮询用 setInterval：真让它按 1.5 秒跑，测试就得等；完全不跑，
   进度条这类"只在轮询回来后才出现"的分支又测不到。
   折中：登记回调、立刻同步执行一次，然后不再重复。 */
const intervalCallbacks = []
globalThis.setInterval = (fn) => {
  intervalCallbacks.push(fn)
  /* 立刻跑一次，模拟"第一个轮询周期已到"。回调里的 fetch 是 Promise，
     这里不等它——由渲染循环的多轮重渲染把结果收敛出来。 */
  try {
    fn()
  } catch {
    /* 回调内部自己处理错误；这里吞掉是为了不让 mock 掩盖真实异常，
       真实异常会在重渲染路径上再次抛出。 */
  }
  return intervalCallbacks.length
}
globalThis.clearInterval = () => {}
globalThis.setTimeout = () => 0
globalThis.clearTimeout = () => {}

/* 组件是 factory 内部的闭包，外面拿不到；为了让冒烟测试能真正渲染它们，
   在工厂返回对象之前插入一句导出，仅在测试里生效。
   这样不用改动产品代码，也不会漏掉「组件本体」这条最容易白屏的路径。 */
const instrumented = source.replace(
  '        return {\n          inject: [\'slots\', \'locale\'],',
  '        if (window.__DAMP_TEST_EXPORTS__ !== undefined) window.__DAMP_TEST_EXPORTS__({ PreviewDetail, PreviewTab, Body, L })\n        return {\n          inject: [\'slots\', \'locale\'],',
)

/* 用函数包装执行 client.js：它原本靠 window.__ModuleLoader__ 注册模块。 */
const runner = new Function('window', 'document', 'navigator', 'fetch', 'ResizeObserver', 'AbortController', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', instrumented)
try {
  runner(windowMock, documentMock, globalThis.navigator, globalThis.fetch, globalThis.ResizeObserver, globalThis.AbortController, globalThis.setInterval, globalThis.clearInterval, globalThis.setTimeout, globalThis.clearTimeout)
} catch (error) {
  console.error(`client.js 顶层执行失败：${error?.message ?? error}`)
  process.exit(1)
}

if (captured === undefined) {
  console.error('client.js 没有调用 window.__ModuleLoader__.load')
  process.exit(1)
}

if (!instrumented.includes('__DAMP_TEST_EXPORTS__')) {
  console.error('注入点没找到，client.js 的导出结构可能变了——请更新本测试的注入串')
  process.exit(1)
}
console.log('✓ 模块注册成功，id =', captured.id)

/* 取出 apply 与组件，真跑一次渲染。 */
let client
try {
  client = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`未知依赖 ${name}`)
  })
} catch (error) {
  console.error(`factory 执行失败：${error?.message ?? error}`)
  process.exit(1)
}

console.log('✓ factory 执行成功，导出 apply =', typeof client.apply)

/* 模拟 apply：只跑样式注入那个 effect，验证 CSS 字符串没写坏。 */
const effects = []
const ctxMock = {
  effect(fn) {
    effects.push(fn)
    return () => {}
  },
  inject(names, callback) {
    /* 不执行注入，避免依赖完整的 DSH 客户端环境。 */
    return () => {}
  },
}
try {
  client.apply(ctxMock)
} catch (error) {
  console.error(`apply 执行失败：${error?.message ?? error}`)
  process.exit(1)
}
console.log(`✓ apply 执行成功，注册了 ${effects.length} 个 effect`)

/* ── 真正渲染组件：TDZ 会在这里暴露 ─────────────────────────── */
let components
windowMock.__DAMP_TEST_EXPORTS__ = (value) => { components = value }
client = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error(`未知依赖 ${name}`)
})
if (components === undefined) {
  console.error('没能拿到组件导出')
  process.exit(1)
}
console.log('✓ 拿到组件：', Object.keys(components).join(', '))

const entry = {
  key: 'feature/x::com.demo.XKt.XPreview',
  module: 'feature/x',
  fqn: 'com.demo.XKt.XPreview',
  title: 'X',
  status: 'fresh',
  hasImage: true,
  renderedAt: Date.now(),
  renderer: 'studio',
  width: 1080,
  height: 1920,
}
const tree = {
  width: 1080,
  height: 1920,
  renderer: 'studio',
  nodes: [{
    id: 'n0',
    type: 'TextView',
    bounds: { left: 466, top: 42, right: 615, bottom: 105 },
    depth: 0,
    hasSemantics: true,
    text: 'Alarms',
  }],
}

/** 渲染一次并把组件内所有 h(...) 调用记下来。 */
/**
 * 渲染一个组件，并在 setState 被调用后继续重渲染，直到状态稳定。
 *
 * 为什么要多轮：组件的分支面板（详情的「语义树 / 对比上一版」、
 * 总览的进度条）靠状态切换才出现。只渲染首帧的话，这些分支整段不执行，
 * 里面的渲染辅助函数写错也发现不了——这正是上一轮留下的盲区。
 *
 * 每轮：渲染 → 补跑 effect（effect 里可能 setState）→ 若标脏则再来一轮。
 * 最多 MAX_PASSES 轮，防止 effect 与 setState 互相触发形成死循环。
 */

/**
 * 排空挂起的微任务与宏任务，直到没有新的状态变更。
 *
 * 组件的加载链是 `post()` → `await fetch` → `await response.json()`，
 * 至少三层 await；每层都要让出一次事件循环才会推进。
 * 固定排 N 次不如排到"连续两轮没人标脏"为止。
 */
async function settle(rounds = 12) {
  let quiet = 0
  for (let index = 0; index < rounds; index++) {
    const before = dirty
    await new Promise((resolve) => setImmediate(resolve))
    if (dirty === before) {
      quiet++
      /* 连续两轮没有新变更，认为异步链已跑完。 */
      if (quiet >= 2) return
    } else {
      quiet = 0
    }
  }
}

const MAX_PASSES = 8

async function renderOnce(name, build) {
  rendered.length = 0
  pendingEffects.length = 0
  mount()
  let output
  let pass = 0
  for (;;) {
    pass++
    try {
      output = withHooks(build)
    } catch (error) {
      console.error(`✗ ${name} 渲染失败（第 ${pass} 轮）：${error?.message ?? error}`)
      console.error(String(error?.stack ?? '').split('\n').slice(0, 6).join('\n'))
      /* 用 exitCode + throw 双保险：直接 process.exit(1) 在顶层会被吞的情况不会再出现。 */
      process.exitCode = 1
      throw error
    }
    flushEffects(name)
    /* 排空异步：effect 里发的 fetch 是 Promise，而 post() 内部还有一层
       await response.json()，所以一次 setImmediate 不够——链上每个 await
       都要一个回合。多排几次，直到连续两回合都没有新的 setState。
       不排就会漏掉"数据到达后重渲染"这一整类分支（批量进度条就是）。 */
    await settle()
    if (!dirty) break
    if (pass >= MAX_PASSES) {
      console.error(`✗ ${name} 渲染 ${MAX_PASSES} 轮仍未稳定，疑似 effect 与 setState 互相触发`)
      process.exitCode = 1
      throw new Error(`${name} 渲染不收敛`)
    }
    dirty = false
  }
  console.log(`✓ ${name} 渲染成功（产生 ${rendered.length} 个元素，${pass} 轮）`)
  return output
}

/**
 * 补跑本轮登记的 effect 体。
 *
 * 组件函数跑完才执行，这正是 React 的顺序；effect 体内抛错说明真实挂载时
 * 也会抛，用户看到的就是白屏或半残面板，所以这里必须让它失败。
 *
 * 清理函数**不在挂载时执行**——真实 React 只在卸载或依赖变化时调用它。
 * 早先这里连清理一起跑，`useEffect(() => () => { alive.current = false }, [])`
 * 于是立刻把组件标记成已卸载，后续所有 setState 全被守卫挡掉，
 * 依赖数据的分支（批量进度条）永远渲染不出来，还看不出一丝异常。
 */
function flushEffects(name) {
  const queued = pendingEffects.splice(0, pendingEffects.length)
  for (let index = 0; index < queued.length; index++) {
    try {
      queued[index]()
    } catch (error) {
      console.error(`✗ ${name} 的 effect 体执行失败：${error?.message ?? error}`)
      console.error(String(error?.stack ?? '').split('\n').slice(0, 6).join('\n'))
      process.exitCode = 1
      throw error
    }
  }
  if (queued.length > 0) console.log(`  └ 已补跑 ${queued.length} 个 effect 体`)
}

/**
 * 交给组件的事件回调在这里登记，渲染后由 fireHandlers 逐个触发。
 *
 * 组件的交互逻辑（点击图反查节点、导出、缩放）全挂在 onClick 上，
 * 只渲染不触发等于没测。这里把每个带 onClick 的元素排进队列。
 */
function collectHandlers(nodes) {
  const handlers = []
  for (const node of nodes) {
    if (typeof node?.props?.onClick === 'function') handlers.push({ node, onClick: node.props.onClick })
  }
  return handlers
}

/**
 * 触发登记过的 onClick。
 *
 * 只触发"看起来安全"的那些：点图、缩放按钮这类。真实点击可能触发网络请求
 * （fetch 已被 mock 成拒绝），我们只关心回调里没有未定义变量、没有类型错误，
 * 所以逐个跑、捕获并报告首个失败。
 */
function fireHandlers(name, handlers) {
  let fired = 0
  for (const handler of handlers) {
    try {
      handler.onClick({ preventDefault() {}, stopPropagation() {}, currentTarget: handler.node })
      fired++
    } catch (error) {
      console.error(`✗ ${name} 的 onClick 回调执行失败：${error?.message ?? error}`)
      console.error(String(error?.stack ?? '').split('\n').slice(0, 6).join('\n'))
      process.exitCode = 1
      throw error
    }
  }
  if (fired > 0) console.log(`  └ 已触发 ${fired} 个 onClick 回调`)
}


/**
 * 在后代元素里找到文字匹配某个正则的按钮，点它，然后渲染到稳定。
 *
 * 为什么需要：详情页的 diff 面板与总览页的批量进度条都藏在状态分支后面，
 * 首帧压根不走那条路径。点一下按钮把状态切过去，才能把那部分代码执行到。
 *
 * @param {string} name - 组件名（用于日志）
 * @param {RegExp} pattern - 按钮文字要匹配的模式
 * @param {() => any} build - 重新渲染用的函数
 */
async function clickButton(name, pattern, build) {
  const target = rendered.find((node) => {
    if (node?.type !== 'button') return false
    const text = node.children.filter((child) => typeof child === 'string').join('')
    return pattern.test(text)
  })
  if (target === undefined) {
    console.error(`✗ ${name}：找不到文字匹配 ${pattern} 的按钮，界面结构可能变了`)
    process.exitCode = 1
    throw new Error(`${name} 缺少按钮 ${pattern}`)
  }
  /* 点完之后挂载状态已经存在，不再 mount()，直接走渲染循环让分支出现。 */
  pendingEffects.length = 0
  dirty = false
  try {
    target.props.onClick({ preventDefault() {}, stopPropagation() {}, currentTarget: target })
  } catch (error) {
    console.error(`✗ ${name} 的「${pattern}」按钮点击失败：${error?.message ?? error}`)
    process.exitCode = 1
    throw error
  }
  let pass = 0
  for (;;) {
    pass++
    try {
      withHooks(build)
    } catch (error) {
      console.error(`✗ ${name} 点击后渲染失败（第 ${pass} 轮）：${error?.message ?? error}`)
      console.error(String(error?.stack ?? '').split('\n').slice(0, 6).join('\n'))
      process.exitCode = 1
      throw error
    }
    flushEffects(name)
    await settle()
    if (!dirty) break
    if (pass >= MAX_PASSES) {
      console.error(`✗ ${name} 点击后渲染 ${MAX_PASSES} 轮仍未稳定`)
      process.exitCode = 1
      throw new Error(`${name} 点击后渲染不收敛`)
    }
    dirty = false
  }
  console.log(`  └ 已展开「${pattern.source.split('|')[0]}」分支（${pass} 轮）`)
}

await renderOnce('PreviewTab', () => components.PreviewTab({ sessionId: 's1' }))

/* 详情页是交互最密集的一块：点击反查、导出、缩放都挂在这里。 */
const detailBuild = () => components.PreviewDetail({
  entry,
  sessionId: 's1',
  onBack() {},
  onRender() {},
})
await renderOnce('PreviewDetail', () => detailBuild())

/* 详情页的「对比上一版」面板默认不渲染（pane 初始是 'tree'）。
   单独点一次那个按钮，逼出 diff 分支——里面的 diffLabel / diffDetail /
   diffRow 三个渲染辅助函数只有走到这条分支才会执行。 */
await clickButton('PreviewDetail', /对比上一版|Compare to previous/, detailBuild)

await renderOnce('Body', () => components.Body({ sessionId: 's1' }))

console.log('\n冒烟测试通过：client.js 能注册、能构造、apply 与三个组件都能渲染')
process.exit(0)
