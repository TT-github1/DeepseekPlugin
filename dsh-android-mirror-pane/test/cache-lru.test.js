/**
 * preview 缓存的 LRU 清理测试。
 *
 * 全部在临时目录里跑：`cacheDir` 指向 mkdtemp 的结果，**绝不碰**
 * `~/.dsh/android-mirror-pane/` 下的真实缓存——那里是用户正在用的图，
 * 单测误删一次就要等十几分钟重新渲染。
 *
 * 做法是直接铺一个「像真的」的缓存目录：写 index.json（服务读的那个格式）
 * 加上 img-/tree- 文件，再调 `trimCache()` 看它删了谁、索引怎么变。
 * 这样不必起 Gradle，也不会真的渲染。
 *
 *   node --test test/cache-lru.test.js
 */

import assert from 'node:assert/strict'
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { PreviewService, shortHash } from '../src/host/preview.js'

/** 与 preview.js 里的 INDEX_VERSION 一致；版本不符时服务会当空索引。 */
const INDEX_VERSION = 1

/** 静默 logger：这些测试会触发正常的 info 日志，不该刷屏。 */
const quietLogger = { info() {}, warn() {} }

/**
 * 造一条索引记录，字段形状与 `reconcile()` 写进去的一致。
 * @param {object} over - 覆盖字段；`key` 必须给。
 * @returns {object}
 */
function makeEntry(over) {
  const [module, fqn] = String(over.key).split('::')
  const parts = String(fqn).split('.')
  return {
    key: over.key,
    module,
    fqn,
    previewId: parts.at(-1),
    title: parts.at(-2) ?? '',
    ...over,
  }
}

/**
 * 搭一个临时缓存目录，可选地写入 index.json 与缓存文件。
 *
 * @param {{ entries?: object[], files?: { name: string, size: number, mtime?: number }[] }} [input]
 * @returns {Promise<{ root: string, cacheDir: string, cleanup: () => Promise<void> }>}
 */
async function setup(input = {}) {
  const root = await mkdtemp(join(tmpdir(), 'damp-lru-'))
  const cacheDir = join(root, 'cache')
  await mkdir(cacheDir, { recursive: true })
  if (input.entries !== undefined) {
    const entries = {}
    for (const item of input.entries) entries[item.key] = item
    await writeFile(join(cacheDir, 'index.json'), JSON.stringify({
      version: INDEX_VERSION,
      updatedAt: Date.now(),
      projectRoot: root,
      entries,
    }), 'utf8')
  }
  for (const file of input.files ?? []) {
    const path = join(cacheDir, file.name)
    /* 内容长度就是 size：清理按 stat().size 累加，这样最直观。 */
    await writeFile(path, Buffer.alloc(file.size, 0x61))
    if (file.mtime !== undefined) {
      const at = new Date(file.mtime)
      await utimes(path, at, at)
    }
  }
  return { root, cacheDir, cleanup: () => rm(root, { recursive: true, force: true }) }
}

/**
 * 建一个指向临时目录的服务。项目根就是临时目录本身（里面没有 gradlew），
 * 于是所有模块的指纹都是「空目录」那个固定值。
 * @param {string} root
 * @param {string} cacheDir
 * @param {object} [options]
 * @returns {PreviewService}
 */
function makeService(root, cacheDir, options = {}) {
  return new PreviewService({
    projectRoot: root,
    cacheDir,
    renderer: 'headless',
    androidCli: '/nonexistent/android',
    logger: quietLogger,
    ...options,
  })
}

/**
 * 文件存在吗。
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

test('超过上限时按 mtime 从旧到新删，删到上限以内就停', async () => {
  /* 三个 preview，每个 img 4 MB + tree 1 MB，共 15 MB，上限 10 MB。
     最旧的那个（两张都最旧）先被删，腾出 5 MB 后正好落在 10 MB 以内，
     于是最新的那个必须还在。 */
  const old = 'feature/a::com.demo.AScreenKt.APreview'
  const mid = 'feature/a::com.demo.BScreenKt.BPreview'
  const latest = 'feature/a::com.demo.CScreenKt.CPreview'
  const base = 1_700_000_000_000
  const mb = (n) => n * 1024 * 1024
  const { root, cacheDir, cleanup } = await setup({
    entries: [makeEntry({ key: old }), makeEntry({ key: mid }), makeEntry({ key: latest })],
    files: [
      { name: `img-${shortHash(old)}.png`, size: mb(4), mtime: base },
      { name: `tree-${shortHash(old)}.json`, size: mb(1), mtime: base + 1 },
      { name: `img-${shortHash(mid)}.png`, size: mb(4), mtime: base + 2000 },
      { name: `tree-${shortHash(mid)}.json`, size: mb(1), mtime: base + 2001 },
      { name: `img-${shortHash(latest)}.png`, size: mb(4), mtime: base + 4000 },
      { name: `tree-${shortHash(latest)}.json`, size: mb(1), mtime: base + 4001 },
    ],
  })
  const svc = makeService(root, cacheDir, { maxCacheMb: 10 })
  try {
    /* 三条都是 `renderedAt === undefined` → 状态 never → 不 pin，可淘汰。 */
    const result = await svc.trimCache({ force: true })
    assert.equal(result.removed, 2, '只该删掉最旧那两个文件')
    assert.equal(result.total <= mb(10), true, `删完必须回到上限以内，实际 ${result.total}`)
    assert.equal(await exists(svc.imagePath(old)), false, '最旧的 img 必须被删')
    assert.equal(await exists(svc.treePath(old)), false, '最旧的 tree 必须被删')
    assert.equal(await exists(svc.imagePath(mid)), true, '还没轮到的不能删')
    assert.equal(await exists(svc.imagePath(latest)), true, '最新的不能被删')
    assert.equal(await exists(svc.treePath(latest)), true, '最新那个的 tree 也不能删')
  } finally {
    svc.dispose()
    await cleanup()
  }
})

test('被引用的不删：fresh 条目与排队中的 job', async () => {
  /* 关键回归：清理必须放过两类文件——
     fresh 的（现在看到的就是最新）和 queued/running 的（正在写）。
     删了前者用户看到卡片变灰，删了后者渲染出来是空白。 */
  const freshKey = 'feature/a::com.demo.FreshScreenKt.FreshPreview'
  const queuedKey = 'feature/a::com.demo.QueuedScreenKt.QueuedPreview'
  const root = await mkdtemp(join(tmpdir(), 'damp-lru-pin-'))
  const cacheDir = join(root, 'cache')
  await mkdir(cacheDir, { recursive: true })
  const mb = (n) => n * 1024 * 1024
  /* 模块目录不存在时指纹是这个固定值（见 preview.test.js 里的同名断言），
     拿它当 sourceHash 就能让条目判成 fresh。 */
  const emptyFingerprint = '0:e3b0c44298fc1c149afbf4c8'
  try {
    await writeFile(join(cacheDir, 'index.json'), JSON.stringify({
      version: INDEX_VERSION,
      updatedAt: Date.now(),
      projectRoot: root,
      entries: {
        [freshKey]: makeEntry({ key: freshKey, renderedAt: 1, sourceHash: emptyFingerprint, renderer: 'headless' }),
        [queuedKey]: makeEntry({ key: queuedKey }),
      },
    }), 'utf8')

    const svc = makeService(root, cacheDir, { maxCacheMb: 1 })
    try {
      const base = 1_700_000_000_000
      const put = async (path, size, mtime) => {
        await writeFile(path, Buffer.alloc(size, 0x62))
        await utimes(path, new Date(mtime), new Date(mtime))
      }
      /* fresh 的两张最旧：如果 pin 失效，它们会第一个被删。 */
      await put(svc.imagePath(freshKey), mb(4), base)
      await put(svc.treePath(freshKey), mb(1), base + 1)
      /* 另一条只是 `never`，拿来当「可淘汰」的对照组。 */
      await put(svc.imagePath(queuedKey), mb(4), base + 2)
      await put(svc.treePath(queuedKey), mb(1), base + 3)

      /* list() 会把指纹填上，fresh 判定才成立；trimCache 用的是这份结果。 */
      const payload = await svc.list()
      const freshRow = payload.entries.find((item) => item.key === freshKey)
      assert.equal(freshRow.status, 'fresh', '前置条件：这条必须是 fresh')

      const result = await svc.trimCache({ force: true })
      assert.equal(await exists(svc.imagePath(freshKey)), true, 'fresh 条目的图不能删')
      assert.equal(await exists(svc.treePath(freshKey)), true, 'fresh 条目的 tree 不能删')
      /* 只删得动对照组那两张，说明 pin 只挡了该挡的。 */
      assert.equal(result.removed, 2)
      assert.equal(await exists(svc.imagePath(queuedKey)), false)
    } finally {
      svc.dispose()
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('队列里 queued / running 的 job 对应的文件不能删', async () => {
  /* 这一条必须真的把 job 停在 queued/running 上才测得到。用假 CLI：
     `preview render` 睡 600 ms 再失败，于是第一个 job 是 running、
     第二个还是 queued；那一刻调 trimCache，两个 key 的文件都得留着。
     假脚本同时让 `studio check` 立刻返回空，避免多等。 */
  const root = await mkdtemp(join(tmpdir(), 'damp-lru-jobpin-'))
  const cacheDir = join(root, 'cache')
  await mkdir(cacheDir, { recursive: true })
  const keyA = 'feature/a::com.demo.AsScreenKt.AsPreview'
  const keyB = 'feature/a::com.demo.BsScreenKt.BsPreview'
  const mb = (n) => n * 1024 * 1024
  const cli = join(root, 'fake-android.sh')
  try {
    await writeFile(cli, [
      '#!/bin/sh',
      'case "$1" in',
      '  studio) exit 1 ;;',
      '  preview) sleep 0.6; echo "{\\"success\\":false,\\"globalError\\":\\"假 CLI\\"}" ; exit 0 ;;',
      'esac',
      'exit 0',
    ].join('\n'), 'utf8')
    await chmod(cli, 0o755)

    await writeFile(join(cacheDir, 'index.json'), JSON.stringify({
      version: INDEX_VERSION,
      updatedAt: Date.now(),
      projectRoot: root,
      entries: {
        [keyA]: makeEntry({ key: keyA }),
        [keyB]: makeEntry({ key: keyB }),
      },
    }), 'utf8')

    const svc = makeService(root, cacheDir, { maxCacheMb: 0.5, androidCli: cli })
    try {
      /* 两个 key 的文件都是 3 MB，远超 0.5 MB 的上限：如果 pin 失效，
         它们会在第一次清理里就被删光。 */
      for (const key of [keyA, keyB]) {
        await writeFile(svc.imagePath(key), Buffer.alloc(mb(3), 0x68))
      }

      const batch = await svc.enqueueMany([keyA, keyB])
      assert.deepEqual(batch.jobIds.length, 2)
      /* 等第一个 job 真的进入运行状态，第二个自然还在排队。 */
      await new Promise((done) => setTimeout(done, 200))
      const states = svc.jobList().map((job) => job.status)
      assert.equal(states.includes('running'), true, `应该有一个在跑：${states.join(',')}`)
      assert.equal(states.includes('queued'), true, `应该有一个在排队：${states.join(',')}`)

      const result = await svc.trimCache({ force: true })
      assert.equal(result.removed, 0, '在跑和在排队的文件都不能删')
      assert.equal(await exists(svc.imagePath(keyA)), true)
      assert.equal(await exists(svc.imagePath(keyB)), true)

      /* 批次摘要也该报得出来：总数 2、至少有一个还在跑。 */
      const snapshot = svc.batchList()
      assert.equal(snapshot.length, 1)
      assert.equal(snapshot[0].total, 2)
      assert.equal(snapshot[0].active, true)
    } finally {
      svc.dispose()
      /* dispose() 只是发 SIGTERM，子进程退出是异步的（假 CLI 里 sleep 0.6）。
         不等它真的死透就 rm，会撞上仍在写的缓存目录，报 ENOTEMPTY——
         实测 1/5 概率偶发失败。等到没有 job 停在 running 再补一段收尾时间。 */
      const deadline = Date.now() + 3000
      while (Date.now() < deadline && svc.jobList().some((job) => job.status === 'running')) {
        await new Promise((done) => setTimeout(done, 25))
      }
      await new Promise((done) => setTimeout(done, 150))
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('删掉文件后索引同步：hasImage 为 false、状态回到 never、条目仍在', async () => {
  /* 锁一个历史 bug：清理时把 entry 整个删掉，卡片会从面板上凭空消失。
     正确行为是清缓存、保留 entry，状态回到 `never`。 */
  const key = 'feature/a::com.demo.StaleScreenKt.StalePreview'
  const root = await mkdtemp(join(tmpdir(), 'damp-lru-index-'))
  const cacheDir = join(root, 'cache')
  await mkdir(cacheDir, { recursive: true })
  const mb = (n) => n * 1024 * 1024
  try {
    await writeFile(join(cacheDir, 'index.json'), JSON.stringify({
      version: INDEX_VERSION,
      updatedAt: Date.now(),
      projectRoot: root,
      entries: {
        [key]: makeEntry({
          key,
          renderedAt: Date.now() - 1000,
          /* 永远不等于当前指纹 → stale → 不 pin，可以删。 */
          sourceHash: '1:deadbeef',
          renderer: 'headless',
          width: 1080,
          height: 1920,
          treeNodes: 7,
        }),
      },
    }), 'utf8')

    /* 上限设成 0.5 MB：5 MB 的缓存必须把 img 和 tree 都删掉才够。 */
    const svc = makeService(root, cacheDir, { maxCacheMb: 0.5 })
    try {
      await svc.list()
      await writeFile(svc.imagePath(key), Buffer.alloc(mb(4), 0x63))
      await writeFile(svc.treePath(key), Buffer.alloc(mb(1), 0x64))

      const result = await svc.trimCache({ force: true })
      assert.equal(result.removed, 2, 'img 与 tree 都该被删')

      /* 从磁盘重新读，确认**写进了索引文件**而不是只改内存。 */
      const saved = JSON.parse(await readFile(join(cacheDir, 'index.json'), 'utf8'))
      assert.notEqual(saved.entries[key], undefined, '条目不能从索引里消失')
      assert.equal(saved.entries[key].renderedAt, undefined, 'renderedAt 要清空')
      assert.equal(saved.entries[key].width, undefined, '尺寸元数据也要清')
      assert.equal(saved.entries[key].sourceHash, undefined)
      assert.equal(saved.entries[key].lastError, undefined)
      assert.equal(saved.entries[key].title, makeEntry({ key }).title, '识别用的字段要留着')

      /* hasImage 是 list() 现场 existsSync 算的，文件没了必须是 false。 */
      const payload = await svc.list()
      const found = payload.entries.find((item) => item.key === key)
      assert.notEqual(found, undefined, '卡片仍要在列表里')
      assert.equal(found.hasImage, false)
      assert.equal(found.status, 'never', '清完之后状态回到 never')
      assert.equal(found.renderedAt, undefined)
      assert.equal(payload.counts.total, 1, '条目总数不变')
      assert.equal(payload.counts.never, 1)
    } finally {
      svc.dispose()
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('索引里有、但不在配置模块列表里的条目也能正确判 stale', async () => {
  /* 这条锁一个会让 LRU 失效的坑：`#refreshFingerprints` 原来只算
     `#modules`（配置或内置的五个模块），而自动发现之后索引里可能出现
     别的模块。那些模块的指纹永远缺失，`#statusOf` 把「查不到」当成 fresh，
     于是它们的图永远删不掉、也永远不显示「源码已变」。 */
  const key = 'feature/zzz::com.demo.UnknownScreenKt.UnknownPreview'
  const root = await mkdtemp(join(tmpdir(), 'damp-lru-unknown-module-'))
  const cacheDir = join(root, 'cache')
  await mkdir(cacheDir, { recursive: true })
  try {
    await writeFile(join(cacheDir, 'index.json'), JSON.stringify({
      version: INDEX_VERSION,
      updatedAt: Date.now(),
      projectRoot: root,
      entries: {
        [key]: makeEntry({
          key,
          renderedAt: Date.now() - 1000,
          /* 一个不可能等于当前指纹的值：这个模块的指纹应该是「空目录」那个。 */
          sourceHash: '1:deadbeef',
        }),
      },
    }), 'utf8')
    /* 服务只配了一个模块，索引里的 `feature/zzz` 不在其中。 */
    const svc = makeService(root, cacheDir, { modules: ['feature/builtin'] })
    try {
      const payload = await svc.list()
      const row = payload.entries.find((item) => item.key === key)
      assert.notEqual(row, undefined)
      assert.equal(row.status, 'stale', '指纹必须对索引里的模块也能算出来')
      assert.equal(payload.counts.stale, 1)
    } finally {
      svc.dispose()
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('不认识的缓存文件名一律不碰，也不算进占用', async () => {
  /* 目录里混着索引、临时文件、render-* 中间目录和用户自己放的东西。
     清理只能动 img-*.png 与 tree-*.json；其余连大小都不该参与统计，
     否则它们会逼着清理删掉正常缓存。 */
  const root = await mkdtemp(join(tmpdir(), 'damp-lru-keep-'))
  const cacheDir = join(root, 'cache')
  await mkdir(cacheDir, { recursive: true })
  const mb = (n) => n * 1024 * 1024
  const strangers = ['notes.txt', 'img-notahash.png', 'tree-XYZ.json', 'img-abcdef.json']
  try {
    for (const name of strangers) await writeFile(join(cacheDir, name), Buffer.alloc(mb(2), 0x65))
    await mkdir(join(cacheDir, 'render-dir'), { recursive: true })
    await writeFile(join(cacheDir, 'index.json'), JSON.stringify({
      version: INDEX_VERSION, updatedAt: Date.now(), projectRoot: root, entries: {},
    }), 'utf8')

    const svc = makeService(root, cacheDir, { maxCacheMb: 1 })
    try {
      const result = await svc.trimCache({ force: true })
      assert.equal(result.removed, 0, '一个都不该删')
      assert.equal(result.total, 0, '无法识别的文件不该算进缓存占用')
      for (const name of strangers) {
        assert.equal(await exists(join(cacheDir, name)), true, `${name} 不该被删`)
      }
      assert.equal(await exists(join(cacheDir, 'render-dir')), true, 'render-* 目录不该被删')
    } finally {
      svc.dispose()
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('maxCacheMb 为 0 时完全不清理', async () => {
  /* 留一条排障后路：有人可能想靠关掉上限来保住所有渲染结果。 */
  const key = 'feature/a::com.demo.KeepScreenKt.KeepPreview'
  const root = await mkdtemp(join(tmpdir(), 'damp-lru-off-'))
  const cacheDir = join(root, 'cache')
  await mkdir(cacheDir, { recursive: true })
  try {
    await writeFile(join(cacheDir, 'index.json'), JSON.stringify({
      version: INDEX_VERSION, updatedAt: Date.now(), projectRoot: root, entries: { [key]: makeEntry({ key }) },
    }), 'utf8')
    const svc = makeService(root, cacheDir, { maxCacheMb: 0 })
    try {
      assert.equal(svc.maxCacheMb, 0)
      await writeFile(svc.imagePath(key), Buffer.alloc(3 * 1024 * 1024, 0x66))
      const result = await svc.trimCache({ force: true })
      assert.equal(result.removed, 0)
      assert.equal(await exists(svc.imagePath(key)), true)
    } finally {
      svc.dispose()
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('不超限时一个文件都不删，也不重写索引', async () => {
  /* 默认 300 MB 远大于测试铺的量：清理不该有任何副作用，
     尤其不能因为「算了一下」就把索引重写一遍（那是无谓的磁盘写）。 */
  const key = 'feature/a::com.demo.SmallScreenKt.SmallPreview'
  const root = await mkdtemp(join(tmpdir(), 'damp-lru-under-'))
  const cacheDir = join(root, 'cache')
  await mkdir(cacheDir, { recursive: true })
  try {
    await writeFile(join(cacheDir, 'index.json'), JSON.stringify({
      version: INDEX_VERSION, updatedAt: Date.now(), projectRoot: root, entries: { [key]: makeEntry({ key }) },
    }), 'utf8')
    const svc = makeService(root, cacheDir)
    try {
      assert.equal(svc.maxCacheMb, 300, '默认上限就是 300 MB')
      await writeFile(svc.imagePath(key), Buffer.alloc(1024 * 1024, 0x67))
      const before = await stat(join(cacheDir, 'index.json'))
      const result = await svc.trimCache({ force: true })
      assert.equal(result.removed, 0)
      assert.equal(result.total, 1024 * 1024)
      const after = await stat(join(cacheDir, 'index.json'))
      assert.equal(after.mtimeMs, before.mtimeMs, '没删东西就不该重写索引')
      assert.equal(await exists(svc.imagePath(key)), true)
    } finally {
      svc.dispose()
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})
