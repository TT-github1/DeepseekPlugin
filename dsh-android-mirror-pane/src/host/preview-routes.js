/**
 * Preview 面板的 HTTP 面。
 *
 * 与 routes.js（投屏）完全独立：preview 不需要设备，也不和设备选择共享状态，
 * 所以单独一个类挂在自己的前缀下，卸载时互不影响。
 *
 * 路由一览：
 *
 * - `POST /preview/list`      读索引 + 现状，**不渲染**
 * - `POST /preview/reconcile` 重扫模块，发现有/无的 @Preview
 * - `POST /preview/render`    `{key}` → `{jobId}`，异步入队
 * - `POST /preview/render-batch` `{keys?}` 或 `{module?}` → 一批 jobId，异步入队
 * - `POST /preview/status`    队列状态（可带 jobId 只问一条）
 * - `POST /preview/forget`    丢掉一条缓存
 * - `GET  /preview/image?key=`  PNG 字节
 * - `GET  /preview/tree?key=`   归一化语义树
 *
 * 安全姿态与投屏一致：只接受 loopback 对端 + loopback Host。
 *
 * @module dsh-android-mirror-pane/preview-routes
 */

import { readFile } from 'node:fs/promises'
import { isTrustedRequest } from './routes.js'
import { diffTrees } from './preview-diff.js'
import { summarizeJobs } from './preview.js'

/** preview 路由前缀，跟投屏的 `/stream` 等分开。 */
export const PREVIEW_PREFIX = '/_dsh/dsh-android-mirror-pane/preview'

/**
 * 读并解析 JSON 请求体。
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [maxBytes]
 * @returns {Promise<any>}
 */
function readJson(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 发一个 JSON 响应。
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/**
 * 从查询串里取一个参数。
 * @param {URL} url
 * @param {string} name
 * @returns {string | undefined}
 */
function queryValue(url, name) {
  const value = url.searchParams.get(name)
  return value === null || value.length === 0 ? undefined : value
}

/**
 * 从请求里取会话 id。
 *
 * 面板是挂在会话上的，同一个 DSH 可能开着两个安卓仓库，所以每个请求都要
 * 说清「我是哪个会话的面板」。取不到就退回插件默认项目，不报错——
 * 独立打开的面板（比如没有 sessionId 的旧调用）仍然可用。
 *
 * @param {URL} url
 * @param {any} body
 * @returns {string | undefined}
 */
function sessionFrom(url, body) {
  const fromQuery = queryValue(url, 'sessionId')
  if (fromQuery !== undefined) return fromQuery
  const fromBody = typeof body?.sessionId === 'string' ? body.sessionId : undefined
  return fromBody
}

/**
 * preview 路由处理器集合。
 *
 * 每个 handler 都用 `hub.serviceFor(sessionId)` 拿服务：会话决定项目根，
 * 于是同一个 DSH 里开两个安卓仓库时，两边的面板各看各的索引。
 *
 * @param {import('./preview.js').PreviewHub} hub
 */
export function createPreviewHandlers(hub) {
  /**
   * 读请求体并返回 `{ body, sessionId }`。
   * @param {import('node:http').IncomingMessage} req
   * @param {URL} url
   * @returns {Promise<{ body: any, sessionId: string | undefined }>}
   */
  const readBody = async (req, url) => {
    let body = {}
    try {
      body = await readJson(req)
    } catch {
      /* 空体或不合法 JSON 都当空对象：这些接口的参数都是可选的。 */
    }
    return { body, sessionId: sessionFrom(url, body) }
  }

  return {
    /**
     * `POST /preview/list` —— 首屏用。只读索引与指纹，绝不渲染。
     * 每次都重算指纹（毫秒级），所以「源码已变」标记是实时的，
     * 不需要用户手动点刷新。
     */
    async list(req, res, url) {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      const { sessionId } = await readBody(req, url)
      const service = hub.serviceFor(sessionId)
      const payload = await service.list()
      const studio = await service.studioStatus()
      sendJson(res, 200, { ...payload, studio })
    },

    /** `POST /preview/reconcile` —— 重扫模块的 @Preview 清单，然后返回新的列表。 */
    async reconcile(req, res, url) {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      const { sessionId } = await readBody(req, url)
      const service = hub.serviceFor(sessionId)
      const payload = await service.reconcile()
      const studio = await service.studioStatus()
      sendJson(res, 200, { ...payload, studio })
    },

    /** `POST /preview/render` —— `{key}` 入队，立刻返回 jobId。 */
    async render(req, res, url) {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        sendJson(res, 400, { error: 'bad-request', message: String(error?.message ?? error) })
        return
      }
      const key = typeof body?.key === 'string' ? body.key : ''
      if (key.length === 0) {
        sendJson(res, 400, { error: 'invalid-key', message: '缺少 key' })
        return
      }
      const service = hub.serviceFor(sessionFrom(url, body))
      try {
        const outcome = await service.enqueue(key)
        sendJson(res, 202, outcome)
      } catch (error) {
        sendJson(res, 404, { error: 'unknown-preview', message: String(error?.message ?? error) })
      }
    },

    /**
     * `POST /preview/render-batch` —— 一批 preview 一次性入队。
     *
     * body：`{ sessionId?, keys?: string[], module?: string }`
     * - `keys` 与 `module` 二选一：给了 `keys` 就按它排；只给 `module` 就是
     *   「这个模块下的全部 preview」。
     * - 两者都给时以 `keys` 为准并忽略 `module`（更明确的那个赢），
     *   响应里会说明。
     * - 可选 `onlyOutdated: true`：跳过已经是最新（fresh）的，只补要更新的。
     *
     * 与 `/render` 一样立刻返回，不等渲染完成；进度看 `/status` 或 `/list`
     * 回带的 `jobs` + `jobSummary`。
     */
    async renderBatch(req, res, url) {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        sendJson(res, 400, { error: 'bad-request', message: String(error?.message ?? error) })
        return
      }
      const keys = Array.isArray(body?.keys)
        ? body.keys.filter((key) => typeof key === 'string' && key.length > 0)
        : undefined
      const module = typeof body?.module === 'string' && body.module.length > 0 ? body.module : undefined
      const onlyOutdated = body?.onlyOutdated === true
      if ((keys === undefined || keys.length === 0) && module === undefined) {
        sendJson(res, 400, { error: 'invalid-batch', message: '需要 keys 或 module 之一' })
        return
      }
      const service = hub.serviceFor(sessionFrom(url, body))
      try {
        let outcome
        if (keys !== undefined && keys.length > 0) {
          outcome = await service.enqueueMany(keys)
          if (module !== undefined) outcome.ignoredModule = module
        } else {
          outcome = await service.enqueueModule(module, { onlyOutdated })
        }
        /* 202：已经接受、正在异步跑。一个都没排进去时用 200 说明「无事可做」——
           比如模块里的 preview 全都 fresh，或者 keys 全在队列里。 */
        const accepted = Array.isArray(outcome?.jobIds) && outcome.jobIds.length > 0
        sendJson(res, accepted ? 202 : 200, { ...outcome, accepted })
      } catch (error) {
        sendJson(res, 400, { error: 'batch-failed', message: String(error?.message ?? error) })
      }
    },

    /** `POST /preview/status` —— 队列；带 `{jobId}` 时只回那一条加全量。 */
    async status(req, res, url) {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      const { body, sessionId } = await readBody(req, url)
      const service = hub.serviceFor(sessionId)
      const jobs = service.jobList()
      const wanted = typeof body?.jobId === 'string' ? jobs.find((job) => job.id === body.jobId) : undefined
      /* `jobs` 的字段与含义保持不变（前端在用）；进度聚合是**新增**字段：
         total / done / failed 等，前端算进度不必自己数数组。 */
      sendJson(res, 200, {
        jobs,
        summary: summarizeJobs(jobs),
        /* 批次快照也带上：`summary` 是**全局队列**口径，分母含历史 job，
           用它做「本次批量」的进度会让百分比偏小（跑完 3 个、队列里还有
           20 条旧记录时显示 13%）。前端要显示批次进度就需要这条，
           否则只能等 `/list` 那一次快照，轮询期间进度是静止的。 */
        batches: service.batchList(),
        ...(wanted === undefined ? {} : { job: wanted }),
      })
    },

    /** `POST /preview/forget` —— `{key}` 丢掉一条缓存。 */
    async forget(req, res, url) {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        sendJson(res, 400, { error: 'bad-request', message: String(error?.message ?? error) })
        return
      }
      const key = typeof body?.key === 'string' ? body.key : ''
      const removed = await hub.serviceFor(sessionFrom(url, body)).forget(key)
      sendJson(res, 200, { ok: removed })
    },

    /** `GET /preview/image?key=` —— PNG 字节。带 `v` 只是为了让浏览器缓存分版。 */
    async image(req, res, url) {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      const key = queryValue(url, 'key')
      if (key === undefined) {
        sendJson(res, 400, { error: 'missing-key' })
        return
      }
      let bytes
      try {
        bytes = await readFile(hub.serviceFor(sessionFrom(url, undefined)).imagePath(key))
      } catch {
        sendJson(res, 404, { error: 'no-image', message: '这个 preview 还没有渲染过' })
        return
      }
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(bytes.length),
        /* 图片本身不变（改了源码会重新渲染并换 v），所以允许缓存，减少重复拉取。 */
        'cache-control': 'private, max-age=60',
      })
      res.end(bytes)
    },

    /** `GET /preview/tree?key=` —— 归一化语义树。 */
    /**
     * `GET /preview/diff?key=&base=` —— 当前语义树与某个历史版本的差异。
     *
     * `base` 是要对比的历史快照键（可省略，省略时用「上一次渲染」）。
     * 对比结果只读、不落盘：语义 diff 是纯计算，算完就丢，
     * 不需要把 diff 本身也缓存起来。
     */
    async diff(req, res, url) {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      const key = queryValue(url, 'key')
      if (key === undefined) {
        sendJson(res, 400, { error: 'missing-key' })
        return
      }
      const service = hub.serviceFor(sessionFrom(url, undefined))
      const current = await service.readTree(key)
      if (current === undefined) {
        sendJson(res, 404, { error: 'no-tree', message: '这个 preview 还没有语义树' })
        return
      }
      /* 基线取「上一次渲染」：Service 侧统一给出，没有历史就返回 undefined，
         前端据此显示「首次渲染，无可对比基线」而不是报错。 */
      const base = await service.readBaselineTree?.(key)
      const result = diffTrees(base ?? null, current)
      sendJson(res, 200, {
        ...result,
        hasBaseline: base !== undefined,
      })
    },

    async tree(req, res, url) {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      const key = queryValue(url, 'key')
      if (key === undefined) {
        sendJson(res, 400, { error: 'missing-key' })
        return
      }
      const tree = await hub.serviceFor(sessionFrom(url, undefined)).readTree(key)
      if (tree === undefined) {
        sendJson(res, 404, { error: 'no-tree', message: '这个 preview 还没有语义树' })
        return
      }
      sendJson(res, 200, tree)
    },
  }
}

/**
 * 把 preview 路由挂到 DSH webserver 上。
 *
 * @param {{ register: (route: { kind: 'exact' | 'prefix', path: string, handler: (req: any, res: any) => void | Promise<void> }) => () => void }} webServer
 * @param {import('./preview.js').PreviewHub} hub
 * @returns {() => void} 卸载函数
 */
export function mountPreviewRoutes(webServer, hub) {
  const handlers = createPreviewHandlers(hub)
  /** 统一包一层：错误变成 500 JSON，不把异常抛进 webserver。 */
  const guard = (handler) => (req, res) => {
    /* GET 路由需要查询串，这里就地解析，避免每个 handler 重复写。 */
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    Promise.resolve(handler(req, res, url)).catch((error) => {
      if (res.writableEnded) return
      sendJson(res, 500, { error: 'internal', message: String(error?.message ?? error) })
    })
  }
  const routes = [
    ['/list', handlers.list],
    ['/reconcile', handlers.reconcile],
    ['/render', handlers.render],
    ['/render-batch', handlers.renderBatch],
    ['/status', handlers.status],
    ['/forget', handlers.forget],
    ['/image', handlers.image],
    ['/tree', handlers.tree],
    ['/diff', handlers.diff],
  ]
  const disposers = routes.map(([suffix, handler]) =>
    webServer.register({ kind: 'exact', path: `${PREVIEW_PREFIX}${suffix}`, handler: guard(handler) }),
  )
  return () => {
    for (const dispose of disposers.reverse()) dispose()
    hub.dispose()
  }
}
