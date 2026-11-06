/**
 * Host half of quick-explain.
 *
 * The browser cannot reach a model provider directly, so this half owns the
 * routes the explanation panel talks to. It resolves the deployment's default
 * model, streams one short call, relays token deltas as Server-Sent Events, and
 * records each finished explanation so the reader can revisit it.
 *
 * Nothing here touches the session log: an explanation is a reading aid, not
 * conversation history. The record file is plugin-owned and never reaches a
 * model.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Route the browser posts an explanation request to. */
export const EXPLAIN_PATH = '/quick-explain/explain'

/** Route serving the recorded explanations, newest first. */
export const HISTORY_PATH = '/quick-explain/history'

/** Route clearing every recorded explanation. */
export const HISTORY_CLEAR_PATH = '/quick-explain/history/clear'

/** Cordis function-plugin name. */
export const name = 'quick-explain'

/** Route carrier and the trust fence guarding it. */
export const inject = ['webServer']

/** Request bodies are a few paragraphs of text; anything larger is hostile. */
const MAX_BODY_BYTES = 128 * 1024

/** Hard ceiling on one explanation, so a stuck provider cannot pin a request. */
const REQUEST_TIMEOUT_MS = 120 * 1000

/** Output budget: an explanation is meant to be read at a glance. */
const MAX_OUTPUT_TOKENS = 900

/** Records kept on disk; the oldest fall off. */
const MAX_RECORDS = 500

/**
 * The instruction that makes an explanation an explanation rather than an essay.
 * Deliberately written to suppress preamble, hedging, and restatement.
 */
const SYSTEM_PROMPT = `你是一个术语解释器。用户会给你一段从 AI 回复中选中的文本，以及它所在的上下文。

你的任务是让用户快速看懂这段文字在这里到底是什么意思，尤其是其中的黑话、行话、缩写、专有名词或陌生概念。

严格遵守：
- 先用一句话直说它在这里的含义，不要复述原文、不要开场客套、不要"好的""当然"。
- 优先解释用户可能不懂的那个概念，而不是把整段重讲一遍。
- 用日常语言和具体类比；必须保留的专业术语立刻用大白话跟一句。
- 篇幅控制在 150 字以内，除非用户选中的内容确实需要更多。
- 只输出解释本身。不要用一级标题，不要加"以下是解释"之类的引导语。`

/**
 * Resolve the record file path.
 *
 * The Host does not always export `DSH_HOME` (a desktop launch sets only
 * `DSH_CLIENT_VERSION`), so the home cannot be assumed. The Host process runs
 * with the profile directory as its working directory, which is the next best
 * anchor, and the user's own home is the last resort. Whichever answers first
 * is used, so a record still lands somewhere stable across launches.
 *
 * @returns {string} absolute path to the history file.
 */
function historyFile() {
  const explicit = process.env.DSH_HOME
  if (explicit !== undefined && explicit !== '') {
    return join(explicit, 'quick-explain', 'history.json')
  }
  // The working directory is `<home>/profiles/<profile>`; keep the record beside
  // its profile so two profiles never share one list.
  const profile = process.env.DSH_PROFILE_DIR
  if (profile !== undefined && profile !== '') {
    return join(profile, '.quick-explain', 'history.json')
  }
  const cwd = process.cwd()
  if (cwd !== '') return join(cwd, '.quick-explain', 'history.json')
  const home = process.env.HOME ?? process.env.USERPROFILE
  if (home !== undefined && home !== '') {
    return join(home, '.dsh', 'quick-explain', 'history.json')
  }
  throw new Error('no writable location is known, so explanations cannot be recorded')
}

/**
 * Reject a request whose body exceeds the wire ceiling.
 *
 * A missing or unparsable length is not itself a rejection: the caller may
 * stream a body without declaring it, so the read loop enforces the same
 * ceiling on the bytes actually received.
 *
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @returns {string | undefined} a rejection reason, or undefined to proceed.
 */
function rejectOversized(request) {
  const declared = request.headers['content-length']
  if (declared === undefined) return undefined
  const bytes = Number(declared)
  if (!Number.isFinite(bytes) || bytes < 0) return 'content-length is not a byte count'
  if (bytes > MAX_BODY_BYTES) return 'request body exceeds the size limit'
  return undefined
}

/**
 * Read a request body as UTF-8 text, enforcing the ceiling as bytes arrive.
 *
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @returns {Promise<string>} the decoded body.
 * @throws when the body exceeds {@link MAX_BODY_BYTES}.
 */
async function readBody(request) {
  const chunks = []
  let received = 0
  for await (const chunk of request) {
    received += chunk.length
    if (received > MAX_BODY_BYTES) throw new Error('request body exceeds the size limit')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Extract a bounded, non-empty string field.
 *
 * @param {unknown} value - candidate field.
 * @param {number} limit - maximum accepted length in characters.
 * @returns {string} the trimmed field.
 * @throws when the field is missing, not a string, blank, or too long.
 */
function requiredText(value, limit) {
  if (typeof value !== 'string') throw new Error('expected a text field')
  const text = value.trim()
  if (text === '') throw new Error('text field must not be blank')
  if (text.length > limit) throw new Error('text field is too long')
  return text
}

/**
 * Compose the user turn: the selection, its surrounding context, and the ask.
 *
 * Context is optional. When the browser could not determine the message the
 * selection came from, the model still explains the text on its own terms.
 *
 * @param {{ selection: string, context?: string }} input - validated request.
 * @returns {string} the user message text.
 */
function userPrompt({ selection, context }) {
  const parts = [`【选中的文本】\n${selection}`]
  if (context !== undefined) parts.push(`【所在上下文】\n${context}`)
  parts.push('请解释上面选中的文本在给定上下文中的含义。')
  return parts.join('\n\n')
}

/**
 * Write one Server-Sent Events frame.
 *
 * @param {import('node:http').ServerResponse} response - the open response.
 * @param {string} event - event name.
 * @param {unknown} data - JSON-serializable payload.
 */
function sendEvent(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/**
 * Read the recorded explanations.
 *
 * A missing or unreadable file yields an empty list: history is a convenience,
 * never a reason the settings page fails to open.
 *
 * @returns {Promise<object[]>} records, newest first.
 */
async function readHistory() {
  try {
    const raw = await readFile(historyFile(), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Serialize writes so concurrent explanations cannot interleave and lose a record.
 *
 * @type {Promise<void>}
 */
let writeChain = Promise.resolve()

/**
 * Append one explanation to the record file.
 *
 * The write is atomic (temp file plus rename) and bounded, so a crash mid-write
 * cannot leave a truncated file and the log cannot grow without limit.
 *
 * A failed write must not poison later ones: the chain continues from a settled
 * state, and this caller still sees its own rejection.
 *
 * @param {object} record - the finished explanation.
 * @returns {Promise<void>} completion after the record is durable.
 */
function appendHistory(record) {
  const write = writeChain.then(async () => {
    const path = historyFile()
    const records = await readHistory()
    records.unshift(record)
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(records.slice(0, MAX_RECORDS)), 'utf8')
    await rename(temporary, path)
  })
  // Keep the chain alive whatever this write does; the caller still observes it.
  writeChain = write.catch(() => {})
  return write
}

/**
 * Stream one explanation for one selection.
 *
 * @param {object} deps - resolved services.
 * @param {object} deps.llm - the model-call service.
 * @param {object} deps.agentDefaultModel - default selection owner.
 * @param {{ selection: string, context?: string }} input - validated request.
 * @param {AbortSignal} signal - cancellation for the model call.
 * @param {(delta: string) => void} onDelta - receives each text delta.
 * @returns {Promise<object>} the finished call's route, reasoning, and answer.
 */
async function streamExplanation({ llm, agentDefaultModel }, input, signal, onDelta) {
  const selection = agentDefaultModel.currentSelection()
  // A prepared call validates that dispatch restates its exact controls, and it
  // materializes any adapter default (such as a model's default reasoning
  // effort). Reusing its resolved config is the only way to guarantee that.
  const call = await llm.prepareCall(
    {
      provider: selection.provider,
      model: selection.model,
      maxTokens: MAX_OUTPUT_TOKENS
    },
    signal
  )

  const options = {
    ...call.config,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt(input) }] }],
    signal
  }

  let reasoning = ''
  let answer = ''

  for await (const chunk of call.stream(options)) {
    switch (chunk.type) {
      case 'text-delta':
        answer += chunk.text
        onDelta(chunk.text)
        break
      case 'reasoning-delta':
        reasoning += chunk.text
        break
      case 'finish':
        if (chunk.reason.kind === 'error') {
          throw new Error(chunk.reason.failure.message)
        }
        if (chunk.reason.kind === 'aborted') {
          throw new Error('the explanation was cancelled')
        }
        return { config: call.config, reasoning, answer }
      default:
        // Tool-call and usage chunks carry nothing this feature shows.
        break
    }
  }
  return { config: call.config, reasoning, answer }
}

/**
 * Answer one explanation request as an event stream.
 *
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @param {import('node:http').ServerResponse} response - the response to write.
 * @param {object} deps - resolved services.
 */
async function handleExplain(request, response, deps) {
  // This route spends money on a model call, so it accepts only the JSON body
  // the panel sends. A cross-site form post cannot set that type without a
  // preflight, which the trust fence in apply() refuses.
  const mediaType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    response.statusCode = 415
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ error: 'expected an application/json body' }))
    return
  }

  const rejection = rejectOversized(request)
  if (rejection !== undefined) {
    response.statusCode = 413
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ error: rejection }))
    return
  }

  let input
  try {
    const parsed = JSON.parse(await readBody(request))
    input = {
      selection: requiredText(parsed?.selection, 8000),
      context: parsed?.context === undefined ? undefined : requiredText(parsed.context, 24000)
    }
  } catch (error) {
    response.statusCode = 400
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid request' }))
    return
  }

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
  const cancel = () => abort.abort()
  request.on('close', cancel)

  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.setHeader('connection', 'keep-alive')

  const startedAt = Date.now()
  try {
    const result = await streamExplanation(deps, input, abort.signal, delta =>
      sendEvent(response, 'delta', { text: delta })
    )
    sendEvent(response, 'done', {})
    // Recorded after the reader already has the answer, so a slow disk never
    // delays the panel. A failed record is a log line, not a response failure.
    if (result.answer.trim() !== '') {
      try {
        await appendHistory({
          id: `${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
          time: startedAt,
          provider: result.config.provider,
          model: result.config.model,
          reasoningEffort: result.config.reasoningEffort,
          systemPrompt: SYSTEM_PROMPT,
          selection: input.selection,
          context: input.context,
          userPrompt: userPrompt(input),
          reasoning: result.reasoning,
          answer: result.answer
        })
      } catch (error) {
        deps.log?.('quick-explain: could not record the explanation', error)
      }
    }
  } catch (error) {
    sendEvent(response, 'failed', { message: error instanceof Error ? error.message : 'explanation failed' })
  } finally {
    clearTimeout(timer)
    request.off('close', cancel)
    response.end()
  }
}

/**
 * Answer one history read.
 *
 * @param {import('node:http').ServerResponse} response - the response to write.
 */
async function handleHistory(response) {
  const records = await readHistory()
  response.statusCode = 200
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify({ records }))
}

/**
 * Clear every recorded explanation.
 *
 * @param {import('node:http').ServerResponse} response - the response to write.
 */
async function handleClear(response) {
  try {
    writeChain = writeChain.then(async () => {
      const path = historyFile()
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.${process.pid}.tmp`
      await writeFile(temporary, '[]', 'utf8')
      await rename(temporary, path)
    })
    await writeChain
    response.statusCode = 200
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ cleared: true }))
  } catch (error) {
    response.statusCode = 500
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'clear failed' }))
  }
}

/**
 * Register this feature's routes for the life of the plugin.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 */
export function apply(ctx) {
  const connection = ctx.get('connection')

  /**
   * Apply the trust fence and the method gate shared by every route here.
   *
   * @param {import('node:http').IncomingMessage} request - the incoming request.
   * @param {import('node:http').ServerResponse} response - the response to write.
   * @param {string} method - the only accepted method.
   * @returns {boolean} true when the request was answered and must not proceed.
   */
  const refused = (request, response, method) => {
    // The trust fence first: its Host/Origin check defeats DNS rebinding and its
    // browser authentication gates every caller before any work is spent.
    const rejection = connection?.requestRejection(request)
    if (rejection !== undefined) {
      response.statusCode = rejection
      response.end()
      return true
    }
    if (request.method !== method) {
      response.statusCode = 405
      response.setHeader('allow', method)
      response.end()
      return true
    }
    return false
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: HISTORY_PATH,
        handler: (request, response) => {
          if (refused(request, response, 'GET')) return Promise.resolve()
          return handleHistory(response)
        }
      }),
    'quick-explain: history route'
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: HISTORY_CLEAR_PATH,
        handler: (request, response) => {
          if (refused(request, response, 'POST')) return Promise.resolve()
          return handleClear(response)
        }
      }),
    'quick-explain: history clear route'
  )

  ctx.inject(['llm', 'agentDefaultModel'], child => {
    child.effect(
      () =>
        child.webServer.register({
          kind: 'exact',
          path: EXPLAIN_PATH,
          handler: (request, response) => {
            if (refused(request, response, 'POST')) return Promise.resolve()
            return handleExplain(request, response, {
              llm: child.llm,
              agentDefaultModel: child.agentDefaultModel,
              log: (message, error) => child.logger.warn(`${message}: ${String(error)}`)
            })
          }
        }),
      'quick-explain: explanation route'
    )
  })
}
