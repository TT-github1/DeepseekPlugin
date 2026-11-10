/**
 * preview 路由层的测试，集中在这次新增的批量入口上。
 *
 * 不起真的 HTTP 服务：`createPreviewHandlers()` 返回的就是普通函数，
 * 传一个假的 req / res 进去就能验完整链路（含 loopback 校验、参数校验、
 * 状态码选择）。这样比起 server 快一个数量级，也不用占端口。
 *
 *   node --test test/preview-routes-batch.test.js
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { PreviewService, PreviewHub } from '../src/host/preview.js'
import { createPreviewHandlers } from '../src/host/preview-routes.js'

const INDEX_VERSION = 1
const quietLogger = { info() {}, warn() {} }

/**
 * 假请求：body 走 JSON、带上 loopback 对端与 Host，才能过 isTrustedRequest。
 * @param {object} body
 * @returns {any}
 */
function fakeRequest(body) {
  const text = JSON.stringify(body ?? {})
  const listeners = {}
  const req = {
    url: '/',
    method: 'POST',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:59473', 'content-length': String(Buffer.byteLength(text)) },
    on(event, handler) {
      listeners[event] = handler
      return req
    },
    destroy() {},
  }
  /* 下一拍再喂数据：readJson 是先挂监听、再等 data/end。 */
  setImmediate(() => {
    listeners.data?.(Buffer.from(text, 'utf8'))
    listeners.end?.()
  })
  return req
}

/**
 * 假响应：把写出去的内容收集起来。
 * @returns {any}
 */
function fakeResponse() {
  const res = {
    status: 0,
    headers: {},
    body: undefined,
    writableEnded: false,
    writeHead(status, headers) {
      res.status = status
      res.headers = headers ?? {}
      return res
    },
    end(payload) {
      res.writableEnded = true
      res.body = payload === undefined ? undefined : JSON.parse(String(payload))
    },
  }
  return res
}

/**
 * 铺一个临时项目 + Hub。
 * @param {string[]} keys
 * @param {object} [options]
 * @returns {Promise<{ root: string, cacheDir: string, hub: any, cli: string, cleanup: () => Promise<void> }>}
 */
async function setup(keys, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'damp-routes-'))
  const cacheDir = join(root, 'cache')
  await mkdir(cacheDir, { recursive: true })
  const cli = join(root, 'fake-android.sh')
  const sleep = options.slow === true ? 'sleep 0.06; ' : ''
  await writeFile(cli, [
    '#!/bin/sh',
    'case "$1" in',
    '  studio) exit 1 ;;',
    `  preview) ${sleep}echo '{"success":false,"globalError":"假 CLI"}' ; exit 0 ;;`,
    'esac',
    'exit 0',
  ].join('\n'), 'utf8')
  const { chmod } = await import('node:fs/promises')
  await chmod(cli, 0o755)

  const entries = {}
  for (const key of keys) {
    const [module, fqn] = key.split('::')
    const parts = fqn.split('.')
    entries[key] = { key, module, fqn, previewId: parts.at(-1), title: parts.at(-2) ?? '' }
  }
  await writeFile(join(cacheDir, 'index.json'), JSON.stringify({
    version: INDEX_VERSION, updatedAt: Date.now(), projectRoot: root, entries,
  }), 'utf8')

  const hub = new PreviewHub({
    defaultRoot: root,
    resolveProjectRoot: () => root,
    options: { cacheDir, androidCli: cli, renderer: 'headless' },
    logger: quietLogger,
  })
  return { root, cacheDir, hub, cli, cleanup: () => rm(root, { recursive: true, force: true }) }
}

/** 把队列等空。 */
async function drain(hub, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const jobs = hub.serviceFor(undefined).jobList()
    if (jobs.every((job) => job.status !== 'queued' && job.status !== 'running')) return
    if (Date.now() > deadline) throw new Error('队列没跑完')
    await new Promise((done) => setTimeout(done, 50))
  }
}

const KEY_A = 'feature/a::com.demo.AScreenKt.APreview'
const KEY_B = 'feature/a::com.demo.BScreenKt.BPreview'
const KEY_C = 'feature/b::com.other.CScreenKt.CPreview'

test('POST /preview/render-batch 接受 keys，返回 202 与 jobIds', async () => {
  const { hub, cleanup } = await setup([KEY_A, KEY_B], { slow: true })
  const handlers = createPreviewHandlers(hub)
  try {
    const res = fakeResponse()
    await handlers.renderBatch(fakeRequest({ keys: [KEY_A, KEY_B] }), res, new URL('http://127.0.0.1/preview/render-batch'))
    assert.equal(res.status, 202, `期望 202，实际 ${res.status}`)
    assert.equal(res.body.accepted, true)
    assert.equal(res.body.jobIds.length, 2)
    assert.equal(res.body.total, 2)
    assert.deepEqual(res.body.skipped, [])
    assert.equal(typeof res.body.batchId, 'string')
    await drain(hub)
  } finally {
    hub.dispose()
    await cleanup()
  }
})

test('POST /preview/render-batch 接受 module，只排该模块', async () => {
  const { hub, cleanup } = await setup([KEY_A, KEY_B, KEY_C], { slow: true })
  const handlers = createPreviewHandlers(hub)
  try {
    const res = fakeResponse()
    await handlers.renderBatch(fakeRequest({ module: 'feature/a' }), res, new URL('http://127.0.0.1/preview/render-batch'))
    assert.equal(res.status, 202)
    assert.equal(res.body.total, 2)
    const modules = new Set(hub.serviceFor(undefined).jobList().map((job) => job.module))
    assert.deepEqual([...modules], ['feature/a'])
    await drain(hub)
  } finally {
    hub.dispose()
    await cleanup()
  }
})

test('keys 与 module 都给时以 keys 为准，并在响应里说明被忽略的 module', async () => {
  const { hub, cleanup } = await setup([KEY_A, KEY_B, KEY_C], { slow: true })
  const handlers = createPreviewHandlers(hub)
  try {
    const res = fakeResponse()
    await handlers.renderBatch(
      fakeRequest({ keys: [KEY_C], module: 'feature/a' }),
      res,
      new URL('http://127.0.0.1/preview/render-batch'),
    )
    assert.equal(res.status, 202)
    assert.equal(res.body.total, 1, 'keys 优先，只有一个 key')
    assert.equal(res.body.ignoredModule, 'feature/a')
    await drain(hub)
  } finally {
    hub.dispose()
    await cleanup()
  }
})

test('keys 与 module 都没给 → 400；模块里没有 preview → 200 且 accepted=false', async () => {
  const { hub, cleanup } = await setup([KEY_A])
  const handlers = createPreviewHandlers(hub)
  try {
    const bad = fakeResponse()
    await handlers.renderBatch(fakeRequest({}), bad, new URL('http://127.0.0.1/preview/render-batch'))
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error, 'invalid-batch')

    const emptyKeys = fakeResponse()
    await handlers.renderBatch(fakeRequest({ keys: [] }), emptyKeys, new URL('http://127.0.0.1/preview/render-batch'))
    assert.equal(emptyKeys.status, 400, '空数组等于没给')

    /* 空模块不是错误，只是无事可做：200 + accepted:false 比 400 更诚实。 */
    const empty = fakeResponse()
    await handlers.renderBatch(fakeRequest({ module: 'feature/none' }), empty, new URL('http://127.0.0.1/preview/render-batch'))
    assert.equal(empty.status, 200)
    assert.equal(empty.body.accepted, false)
    assert.equal(empty.body.total, 0)
  } finally {
    hub.dispose()
    await cleanup()
  }
})

test('非 loopback 请求一律 403，批量入口也不例外', async () => {
  const { hub, cleanup } = await setup([KEY_A])
  const handlers = createPreviewHandlers(hub)
  try {
    const req = fakeRequest({ keys: [KEY_A] })
    req.socket.remoteAddress = '192.168.1.20'
    const res = fakeResponse()
    await handlers.renderBatch(req, res, new URL('http://127.0.0.1/preview/render-batch'))
    assert.equal(res.status, 403)
    assert.equal(res.body.error, 'forbidden')
  } finally {
    hub.dispose()
    await cleanup()
  }
})

test('POST /preview/status 保留 jobs 字段，并新增 summary 聚合', async () => {
  /* 前端在读 `{ jobs: [...] }`，这个形状不能变。summary 只是新增字段，
     让前端不必自己数数组就能画进度。 */
  const { hub, cleanup } = await setup([KEY_A, KEY_B], { slow: true })
  const handlers = createPreviewHandlers(hub)
  try {
    await handlers.renderBatch(fakeRequest({ keys: [KEY_A, KEY_B] }), fakeResponse(), new URL('http://127.0.0.1/preview/render-batch'))
    const res = fakeResponse()
    await handlers.status(fakeRequest({}), res, new URL('http://127.0.0.1/preview/status'))
    assert.equal(res.status, 200)
    assert.equal(Array.isArray(res.body.jobs), true, 'jobs 必须还是数组')
    assert.equal(res.body.jobs.length, 2)
    for (const job of res.body.jobs) {
      for (const field of ['id', 'key', 'module', 'fqn', 'title', 'status', 'queuedAt']) {
        assert.equal(field in job, true, `job 缺少 ${field}`)
      }
    }
    assert.equal(res.body.summary.total, 2)
    assert.equal(typeof res.body.summary.done, 'number')
    assert.equal(typeof res.body.summary.failed, 'number')
    assert.equal(res.body.summary.finished, res.body.summary.done + res.body.summary.failed + res.body.summary.cancelled)

    /* 带 jobId 时仍然只回那一条，另外照旧回全量。 */
    const one = fakeResponse()
    await handlers.status(fakeRequest({ jobId: res.body.jobs[0].id }), one, new URL('http://127.0.0.1/preview/status'))
    assert.equal(one.body.job.id, res.body.jobs[0].id)
    assert.equal(one.body.jobs.length, 2)
    await drain(hub)
  } finally {
    hub.dispose()
    await cleanup()
  }
})

test('POST /preview/list 回带 jobSummary 与 batches，entries 结构不变', async () => {
  const { hub, cleanup } = await setup([KEY_A])
  const handlers = createPreviewHandlers(hub)
  try {
    const res = fakeResponse()
    await handlers.list(fakeRequest({}), res, new URL('http://127.0.0.1/preview/list'))
    assert.equal(res.status, 200)
    /* 原有字段一个都不能少。 */
    for (const field of ['projectRoot', 'repoLabel', 'modules', 'entries', 'counts', 'scan', 'jobs', 'studio']) {
      assert.equal(field in res.body, true, `list 缺少原有字段 ${field}`)
    }
    assert.equal(res.body.entries.length, 1)
    for (const field of ['key', 'module', 'fqn', 'title', 'status', 'hasImage']) {
      assert.equal(field in res.body.entries[0], true, `entry 缺少 ${field}`)
    }
    /* 新增的进度字段。 */
    assert.equal(res.body.jobSummary.total, 0)
    assert.deepEqual(res.body.batches, [])
    assert.equal(res.body.cache.maxMb > 0, true)
  } finally {
    hub.dispose()
    await cleanup()
  }
})
