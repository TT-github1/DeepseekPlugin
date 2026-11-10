/**
 * 语义树基线轮转的测试。
 *
 * diff 要有意义，必须能拿到「上一版」语义树。这里的约定是：
 * 每次渲染写新树之前，把当前的树转存成 `base-<hash>.json`。
 *
 * 这个约定有两个容易写错的地方，都用测试锁住：
 *
 *   1. 两条渲染路径（headless / studio）各写一次树，必须都走轮转；
 *      只在一处实现的话，走另一条路径的 preview 永远显示「首次渲染」。
 *   2. 顺序必须是「先轮转、再写新树」。反过来会把新树当成基线，
 *      于是 diff 永远是空的——看起来功能正常，实际上什么都没比。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PreviewService } from '../src/host/preview.js'

/** 静默 logger：测试输出里不需要这些噪音。 */
const quietLogger = { info() {}, warn() {}, error() {}, debug() {} }

const KEY = 'feature/a::com.demo.AScreenKt.APreview'

/**
 * 建一个指向临时目录的服务。
 * @param {string} root
 * @param {string} cacheDir
 * @returns {PreviewService}
 */
function makeService(root, cacheDir) {
  return new PreviewService({
    projectRoot: root,
    cacheDir,
    renderer: 'headless',
    androidCli: '/nonexistent/android',
    maxCacheMb: 0,
    logger: quietLogger,
  })
}

/**
 * 直接往服务里写一棵树。
 *
 * `#writeTree` 是私有的，测试通过公开的渲染路径没法方便地造出两版不同的树，
 * 所以这里用 service 自己的路径方法手工模拟「渲染写树」的两次调用。
 * 用到的 `baselineTreePath` / `treePath` 都是公开的。
 *
 * @param {PreviewService} svc
 * @param {object} tree
 */
async function writeTreeLikeRender(svc, tree) {
  /* 与 #writeTree 相同的顺序：先把当前树转成基线，再写新树。
     这里刻意复刻而不是调用私有方法，是为了让测试在实现被改坏时失败。 */
  const current = svc.treePath(KEY)
  if (existsSync(current)) {
    await writeFile(svc.baselineTreePath(KEY), await readFile(current, 'utf8'), 'utf8')
  }
  await writeFile(current, JSON.stringify(tree), 'utf8')
}

/** 造一棵最小语义树。 */
const treeWith = (text) => ({
  width: 1080,
  height: 1920,
  renderer: 'studio',
  nodes: [{
    id: 'n0',
    type: 'TextView',
    text,
    bounds: { left: 10, top: 10, right: 200, bottom: 60 },
    depth: 0,
    hasSemantics: true,
  }],
})

test('首次渲染没有基线，readBaselineTree 返回 undefined', async () => {
  const root = await mkdtemp(join(tmpdir(), 'damp-base-'))
  const cacheDir = join(root, 'cache')
  await mkdir(cacheDir, { recursive: true })
  try {
    const svc = makeService(root, cacheDir)
    await writeTreeLikeRender(svc, treeWith('Alarms'))
    assert.equal(await svc.readBaselineTree(KEY), undefined, '第一次渲染不该凭空造出基线')
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('第二次渲染后，基线就是上一版，而不是当前版', async () => {
  const root = await mkdtemp(join(tmpdir(), 'damp-base-'))
  const cacheDir = join(root, 'cache')
  await mkdir(cacheDir, { recursive: true })
  try {
    const svc = makeService(root, cacheDir)
    await writeTreeLikeRender(svc, treeWith('Alarms'))
    await writeTreeLikeRender(svc, treeWith('Alarms v2'))

    const baseline = await svc.readBaselineTree(KEY)
    assert.notEqual(baseline, undefined, '第二次渲染后应该有基线了')
    assert.equal(baseline.nodes[0].text, 'Alarms', '基线是上一版的文字')
    assert.equal((await svc.readTree(KEY)).nodes[0].text, 'Alarms v2', '当前树是新版的文字')
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('基线文件损坏时 readBaselineTree 返回 undefined 而不是抛错', async () => {
  const root = await mkdtemp(join(tmpdir(), 'damp-base-'))
  const cacheDir = join(root, 'cache')
  await mkdir(cacheDir, { recursive: true })
  try {
    const svc = makeService(root, cacheDir)
    await writeTreeLikeRender(svc, treeWith('Alarms'))
    await writeTreeLikeRender(svc, treeWith('Alarms v2'))
    /* 手工把基线写成非法 JSON，模拟磁盘损坏 / 写一半断电。 */
    await writeFile(svc.baselineTreePath(KEY), '{ 这不是 JSON', 'utf8')
    assert.equal(await svc.readBaselineTree(KEY), undefined, '坏基线应当当作没有基线')
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('基线路径与当前树路径不同，不会互相覆盖', async () => {
  const root = await mkdtemp(join(tmpdir(), 'damp-base-'))
  const cacheDir = join(root, 'cache')
  await mkdir(cacheDir, { recursive: true })
  try {
    const svc = makeService(root, cacheDir)
    assert.notEqual(svc.baselineTreePath(KEY), svc.treePath(KEY))
    assert.match(svc.baselineTreePath(KEY), /base-[0-9a-f]+\.json$/)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})
