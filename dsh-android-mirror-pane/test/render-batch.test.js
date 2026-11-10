/**
 * 批量渲染队列的测试。
 *
 * 真实的 Gradle 渲染不进单测（要几十秒、还要一整套 SDK），所以这里用一个
 * 假的 `android` 可执行脚本：`preview render` 立刻失败并给出可读错误，
 * `studio check` 直接失败（于是走 headless），`preview list` 给一份固定的
 * JSON。这样测的是**队列语义**——排队顺序、判重、失败不中断、进度聚合——
 * 而这些正是批量渲染唯一复杂的地方。
 *
 *   node --test test/render-batch.test.js
 */

import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { PreviewService, summarizeJobs } from '../src/host/preview.js'

/** 与 preview.js 里的 INDEX_VERSION 一致。 */
const INDEX_VERSION = 1

const quietLogger = { info() {}, warn() {} }

/**
 * 写一个假 CLI。
 *
 * 参数 `mode` 决定 `preview render` 的行为：
 * - `'fail'`：立刻失败（用来验证「一批里某个失败，后面的照跑」）；
 * - `'slow-fail'`：睡一会儿再失败（用来观察 running / queued 的分布）。
 *
 * @param {string} root
 * @param {'fail' | 'slow-fail'} [mode]
 * @returns {Promise<string>}
 */
async function makeFakeCli(root, mode = 'fail') {
  const path = join(root, 'fake-android.sh')
  const sleep = mode === 'slow-fail' ? 'sleep 0.06; ' : ''
  await writeFile(path, [
    '#!/bin/sh',
    'case "$1" in',
    /* studio check 拿不到就返回非零：面板会当成「Studio 不可用」，走 headless。 */
    '  studio) exit 1 ;;',
    `  preview) ${sleep}echo '{"success":false,"globalError":"假 CLI 不渲染"}' ; exit 0 ;;`,
    'esac',
    'exit 0',
  ].join('\n'), 'utf8')
  await chmod(path, 0o755)
  return path
}

/**
 * 造一条索引记录。
 * @param {string} key
 * @returns {object}
 */
function makeEntry(key) {
  const [module, fqn] = key.split('::')
  const parts = fqn.split('.')
  return { key, module, fqn, previewId: parts.at(-1), title: parts.at(-2) ?? '' }
}

/**
 * 在临时目录里铺一个带索引的缓存目录与服务。
 * @param {string[]} keys
 * @param {{ maxCacheMb?: number, cliMode?: 'fail' | 'slow-fail', module?: string }} [options]
 * @returns {Promise<{ root: string, cacheDir: string, svc: PreviewService, cli: string, cleanup: () => Promise<void> }>}
 */
async function setup(keys, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'damp-batch-'))
  const cacheDir = join(root, 'cache')
  await mkdir(cacheDir, { recursive: true })
  const cli = await makeFakeCli(root, options.cliMode ?? 'fail')
  const entries = {}
  for (const key of keys) entries[key] = makeEntry(key)
  await writeFile(join(cacheDir, 'index.json'), JSON.stringify({
    version: INDEX_VERSION, updatedAt: Date.now(), projectRoot: root, entries,
  }), 'utf8')
  const svc = new PreviewService({
    projectRoot: root,
    cacheDir,
    androidCli: cli,
    renderer: 'headless',
    /* 缓存上限调大：这些测试关心的是队列，不是 LRU。 */
    maxCacheMb: options.maxCacheMb ?? 300,
    logger: quietLogger,
  })
  return { root, cacheDir, svc, cli, cleanup: () => rm(root, { recursive: true, force: true }) }
}

/**
 * 等队列跑到「没有 queued/running」为止。
 * @param {PreviewService} svc
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
/**
 * 等队列跑空。
 *
 * 注意不能只看「没有 queued/running 的 job」就返回：job 状态是逐个落定的，
 * 最后一个 job 的状态刚变、批次记账（#settleBatch）可能还没跟上，
 * 此时读 batchList 会拿到少一条的计数——实测 1/10 概率报 24 !== 25。
 * 所以再等一个宏任务周期，让批次收尾跑完。
 */
async function drain(svc, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const jobs = svc.jobList()
    const active = jobs.filter((job) => job.status === 'queued' || job.status === 'running')
    if (active.length === 0) break
    if (Date.now() > deadline) throw new Error(`队列没跑完：${active.map((job) => job.status).join(',')}`)
    await new Promise((done) => setTimeout(done, 50))
  }
  /* 队列空了不代表批次记账完成，再让出两轮事件循环。 */
  await new Promise((done) => setTimeout(done, 50))
  await new Promise((done) => setTimeout(done, 50))
}

const KEY_A = 'feature/a::com.demo.AScreenKt.APreview'
const KEY_B = 'feature/a::com.demo.BScreenKt.BPreview'
const KEY_C = 'feature/b::com.other.CScreenKt.CPreview'

test('enqueueMany 一次排入整批，全部进队列且按传入顺序', async () => {
  const { svc, cleanup } = await setup([KEY_A, KEY_B, KEY_C])
  try {
    const outcome = await svc.enqueueMany([KEY_A, KEY_B, KEY_C])
    assert.equal(outcome.total, 3)
    assert.equal(outcome.jobIds.length, 3)
    assert.deepEqual(outcome.skipped, [])
    assert.deepEqual(outcome.unknown, [])
    assert.equal(typeof outcome.batchId, 'string')

    /* 立刻看：应该 1 个 running + 2 个 queued（严格串行，不是并行）。 */
    const jobs = svc.jobList()
    assert.equal(jobs.length, 3)
    assert.deepEqual(jobs.map((job) => job.key), [KEY_A, KEY_B, KEY_C], '顺序必须与传入一致')

    /* 批次摘要要能直接拿来算进度。 */
    const [batch] = svc.batchList()
    assert.equal(batch.id, outcome.batchId)
    assert.equal(batch.total, 3)
    assert.equal(batch.active, true)
    assert.equal(batch.percent <= 100, true)

    await drain(svc)
  } finally {
    svc.dispose()
    await cleanup()
  }
})

test('已在队列里的 key 会被跳过而不是重复排（duplicate 语义不变）', async () => {
  /* 前端靠 `duplicate` 判断「这个已经在跑了」，批量路径不能改变它：
     同一批里重复出现、以及先单点再批量，都应该复用同一个 job。 */
  const { svc, cleanup } = await setup([KEY_A, KEY_B])
  try {
    const single = await svc.enqueue(KEY_A)
    assert.equal(single.duplicate, false)

    const outcome = await svc.enqueueMany([KEY_A, KEY_A, KEY_B])
    /* KEYS 去重之后 [KEY_A, KEY_B]：A 复用，B 新排。 */
    assert.equal(outcome.total, 2)
    assert.deepEqual([...outcome.skipped].sort(), [KEY_A].sort(), '已在队列的 key 应记为 skipped')
    assert.equal(new Set(outcome.jobIds).size, 2, '同一批里同一个 key 只排一次')
    assert.equal(outcome.jobIds.includes(single.jobId), true, '复用的是原来那个 job')

    /* 单点再排一次仍要返回 duplicate=true（这是 `/render` 的约定）。 */
    const again = await svc.enqueue(KEY_A)
    assert.equal(again.duplicate, true)
    assert.equal(again.jobId, single.jobId)

    await drain(svc)
  } finally {
    svc.dispose()
    await cleanup()
  }
})

test('一批里某个失败不会中断整批，失败的在 job 里标 error', async () => {
  /* 假 CLI 对每个 render 都返回 success=false，于是三个都会失败。
     关键是有**三个** error 的 job 记录、而不是停在第一个。 */
  const { svc, cleanup } = await setup([KEY_A, KEY_B, KEY_C])
  try {
    await svc.enqueueMany([KEY_A, KEY_B, KEY_C])
    await drain(svc)

    const jobs = svc.jobList()
    assert.equal(jobs.length, 3, '三个 job 都要留下记录')
    for (const job of jobs) {
      assert.equal(job.status, 'error', `${job.key} 应该是 error`)
      assert.equal(typeof job.error, 'string')
      assert.equal(job.error.length > 0, true)
      assert.equal(typeof job.finishedAt, 'number')
    }

    const [batch] = svc.batchList()
    assert.equal(batch.active, false)
    assert.equal(batch.failed, 3, '批次摘要要数得出 3 个失败')
    assert.equal(batch.percent, 100)
  } finally {
    svc.dispose()
    await cleanup()
  }
})

test('索引里没有的 key 记为 unknown，不影响同批其他 key', async () => {
  const { svc, cleanup } = await setup([KEY_A])
  try {
    const outcome = await svc.enqueueMany([KEY_A, 'feature/a::com.demo.GhostKt.GhostPreview'])
    assert.equal(outcome.unknown.length, 1)
    assert.equal(outcome.unknown[0].includes('GhostPreview'), true)
    assert.equal(outcome.total, 1, '只排进去一个')
    await drain(svc)
    /* 单点路径对未知 key 仍然抛错——那是 `/render` 的既有契约。 */
    await assert.rejects(() => svc.enqueue('feature/a::com.demo.GhostKt.GhostPreview'), /索引里没有/)
  } finally {
    svc.dispose()
    await cleanup()
  }
})

test('enqueueModule 只排该模块下的 preview，onlyOutdated 跳过 fresh 的', async () => {
  /* 三个 key 分属两个模块：`module` 参数必须精确筛出 `feature/a` 那两个。 */
  const { svc, cleanup } = await setup([KEY_A, KEY_B, KEY_C])
  try {
    const outcome = await svc.enqueueModule('feature/a')
    assert.equal(outcome.total, 2)
    const jobs = svc.jobList()
    assert.deepEqual([...new Set(jobs.map((job) => job.module))], ['feature/a'])
    await drain(svc)

    /* 再排一次 `onlyOutdated`：上一轮全失败了，状态是 error 而不是 fresh，
       所以仍然会被排进去——这符合「失败的要能重试」的直觉。 */
    const retry = await svc.enqueueModule('feature/a', { onlyOutdated: true })
    assert.equal(retry.total, 2, 'error 的条目仍算「需要更新」')
    await drain(svc)

    /* 空模块：什么都不排，也不报错。 */
    const empty = await svc.enqueueModule('feature/does-not-exist')
    assert.equal(empty.total, 0)
    assert.deepEqual(empty.jobIds, [])
  } finally {
    svc.dispose()
    await cleanup()
  }
})

test('批量期间 job 历史裁剪不会挤掉还在排队的任务', async () => {
  /* 旧实现是「总数超 20 就裁」，一次 30 个的批量会边跑边把 queued 的挤掉，
     前端看到进度倒退、卡片也不再显示「排队中」。这里排 25 个验证一下。 */
  const keys = Array.from({ length: 25 }, (_, index) => `feature/a::com.demo.P${index}ScreenKt.P${index}Preview`)
  const { svc, cleanup } = await setup(keys, { cliMode: 'slow-fail' })
  try {
    await svc.enqueueMany(keys)
    await drain(svc)

    /* 25 个全跑完，全都留下记录（上限是 max(20, 活跃数)，跑完时活跃数归零，
       但已经完成的记录靠 `#trimJobs` 在每次渲染结束时裁——所以这里只能
       要求「活跃的一个都没丢」，不能要求历史全留。 */
    const jobs = svc.jobList()
    assert.equal(jobs.some((job) => job.status === 'queued' || job.status === 'running'), false)
    assert.equal(jobs.every((job) => job.status === 'error'), true, '每个都该有终态')

    const [batch] = svc.batchList()
    assert.equal(batch.total, 25, '批次总数必须是 25，不能因为历史裁剪缩水')
    assert.equal(batch.failed, 25, '失败计数也得是 25')
    assert.equal(batch.percent, 100)
  } finally {
    svc.dispose()
    await cleanup()
  }
})

test('dispose 之后不再起子进程：后续渲染不会真的去拉 CLI', async () => {
  /* 用「假 CLI 每次被调用就记一行日志」来证明，而不是只看 job 状态——
     状态可能是 cancelled 也可能是 error，但真正要保证的是**没有新进程**。 */
  const { root, svc, cli, cleanup } = await setup([KEY_A, KEY_B], { cliMode: 'slow-fail' })
  const calls = join(root, 'calls.log')
  /* 换一个会记账的 CLI：每次执行都在 calls.log 里追加一行。 */
  await writeFile(cli, [
    '#!/bin/sh',
    `echo "$1" >> ${JSON.stringify(calls)}`.replace(/"/g, ''),
    'case "$1" in',
    '  studio) exit 1 ;;',
    '  preview) sleep 0.06; echo \'{"success":false,"globalError":"假 CLI"}\' ; exit 0 ;;',
    'esac',
    'exit 0',
  ].join('\n'), 'utf8')
  await chmod(cli, 0o755)
  try {
    await svc.enqueueMany([KEY_A, KEY_B])
    await new Promise((done) => setTimeout(done, 120))
    svc.dispose()

    const before = Number((await readFile(calls, 'utf8').catch(() => '')).split('\n').filter(Boolean).length)
    /* dispose 之后再排一个：它不会真的去跑，所以 calls.log 不该再增长。 */
    const outcome = await svc.enqueueMany([KEY_A])
    assert.equal(outcome.jobIds.length, 1)
    await new Promise((done) => setTimeout(done, 300))
    const after = Number((await readFile(calls, 'utf8').catch(() => '')).split('\n').filter(Boolean).length)
    assert.equal(after, before, 'dispose 之后一次 CLI 都不该被调用')

    const job = svc.jobList().find((item) => item.id === outcome.jobIds[0])
    assert.notEqual(job, undefined)
    assert.equal(job.status === 'cancelled' || job.status === 'error', true, `不该还在跑：${job.status}`)
  } finally {
    svc.dispose()
    await cleanup()
  }
})

test('summarizeJobs 的计数自洽，percent 只按已落定的算', async () => {
  /* 抽出来的纯函数：total / done / failed 必须能直接拿去画进度条。 */
  const jobs = [
    { status: 'done' },
    { status: 'error' },
    { status: 'running' },
    { status: 'queued' },
  ]
  const summary = summarizeJobs(jobs)
  assert.equal(summary.total, 4)
  assert.equal(summary.done, 1)
  assert.equal(summary.failed, 1)
  assert.equal(summary.running, 1)
  assert.equal(summary.queued, 1)
  assert.equal(summary.finished, 2)
  assert.equal(summary.percent, 50)

  const empty = summarizeJobs([])
  assert.equal(empty.total, 0)
  assert.equal(empty.percent, 0, '空队列不该是 100%')
})
