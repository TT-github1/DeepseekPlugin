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

const React = {
  createElement(type, props, ...children) {
    const node = { type, props: props ?? {}, children: children.flat() }
    rendered.push(node)
    return node
  },
  useState(initial) {
    /* 返回 [值, setter]；setter 不触发重渲染，冒烟测试只需验证首次渲染不抛错。 */
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  },
  useEffect(effect) {
    /* 记录但不执行：执行 effect 需要完整的挂载时序，
       这里的目标是「组件函数本体能跑通」，也就是 TDZ 会被暴露的那一步。 */
    return undefined
  },
  useCallback(fn) {
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
globalThis.fetch = () => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({ width: 1080, height: 1920, renderer: 'studio', nodes: [] }),
})
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
}
globalThis.AbortController = class {
  constructor() { this.signal = {} }
  abort() {}
}
globalThis.setInterval = () => 0
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
function renderOnce(name, build) {
  rendered.length = 0
  try {
    build()
  } catch (error) {
    console.error(`✗ ${name} 渲染失败：${error?.message ?? error}`)
    console.error(String(error?.stack ?? '').split('\n').slice(0, 6).join('\n'))
    /* 用 exitCode + throw 双保险：直接 process.exit(1) 在顶层会被吞的情况不会再出现。 */
    process.exitCode = 1
    throw error
  }
  console.log(`✓ ${name} 渲染成功（产生 ${rendered.length} 个元素）`)
  return rendered
}

renderOnce('PreviewTab', () => components.PreviewTab({ sessionId: 's1' }))
renderOnce('PreviewDetail', () => components.PreviewDetail({
  entry,
  sessionId: 's1',
  onBack() {},
  onRender() {},
}))
renderOnce('Body', () => components.Body({ sessionId: 's1' }))

console.log('\n冒烟测试通过：client.js 能注册、能构造、apply 与三个组件都能渲染')
process.exit(0)
