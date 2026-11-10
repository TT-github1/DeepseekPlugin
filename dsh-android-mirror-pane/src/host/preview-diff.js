/**
 * 语义树 diff：比较两次渲染的 Compose 语义树，回答「到底哪里变了」。
 *
 * 为什么不能用节点的 `id`：它是渲染时的遍历序号（`n0`、`n1`…）。源码里加删
 * 一个元素，后面所有节点的 id 都会整体错位，按 id 比对会把一次「插入一行」
 * 放大成满屏「新增 + 消失」——那正是这个模块要消灭的噪音。
 *
 * ## 匹配策略：先内容，后几何
 *
 * 语义树是 DFS 前序拍平的数组，**节点顺序本身就是结构信息**。所以分两段配对：
 *
 * 1. **按内容做序列对齐（主）**。以「`type` + `text` + `contentDescription` +
 *    `role` 全等」作为等价判据，对两边数组求最长公共子序列（LCS）。插入或删除
 *    一个节点后，其余节点在两边序列里仍按同样顺序出现，LCS 会把它们逐个配上，
 *    于是只有真正新增/消失的那一个被报出来。这一段**刻意不看 bounds**：
 *    插入/删除会让下方节点整体平移，坐标本来就会变，拿坐标当身份会立刻崩掉。
 *
 * 2. **残段内按几何配对（辅）**。LCS 配不上的部分，按相邻匹配点切成一截一截，
 *    只在同一截里配对：`type` 相同，且四边的最大差值在阈值内（阈值随节点尺寸
 *    放大，取 `max(96, 2 × 较长边)`）。这一段专门用来认出「同一个控件的文字
 *    改了」：文字一变 key 就不同、LCS 必然放弃它，但它的位置几乎没动，几何能
 *    把它捞回来，于是报成「文字变化」，而不是「消失 + 新增」。
 *
 * 段内还有一次兜底：某一侧缺 `bounds`（畸形数据）时，「同 `type` 且两边各只剩
 * 一个」的节点直接配上，标记 `matchedBy: 'fallback'`，让调用方知道这条不可靠。
 *
 * ## 已知的误判情形（整合方需要知道）
 *
 * - **节点换了位置**：LCS 只认同序，把列表里一项拖到另一处会报成「消失 + 新增」，
 *   而不是「位移」。语义树里顺序≈布局顺序，通常可接受。
 * - **控件类型变了**：几何配对要求 `type` 相同。`Button` 换成 `TextView` 时宁可报
 *   消失 + 新增，也不猜成同一个节点。
 * - **文字大改且位置大幅变化**：超出几何阈值时同样报成消失 + 新增。阈值是
 *   `max(96, 2 × 较长边)`，宽度翻几倍的极端长文案可能越过。
 * - **大量重复节点**：同一段里多个 `type` 与文字都相同的节点只能按顺序配，
 *   配错顺序时 diff 会在这些节点之间轮转，出现少量错位。
 * - **depth 变化不单独报**：包一层容器会让所有节点 depth 整体 +1，但语义和位置
 *   没动；这种改动不计入变更（`depth` 只在条目里回显，不参与判定）。
 *
 * @module dsh-android-mirror-pane/preview-diff
 */

/** 默认的 bounds 变化阈值（像素）：变化量小于它就算没动，用来吃掉亚像素抖动。 */
const DEFAULT_MIN_DELTA = 1

/** 几何配对的保底阈值（像素）：再小的改动也要给它配对的机会。 */
const MIN_PAIR_DISTANCE = 96

/** 几何阈值相对节点尺寸的倍数：文字变长会让整行变宽，阈值必须跟着放大。 */
const PAIR_DISTANCE_SCALE = 2

/** 深度差在配对打分里的权重：同深度优先，但不否决（包一层容器会让深度整体 +1）。 */
const DEPTH_PENALTY = 8

/** LCS 表的格子上限：超过就走保序贪心，别让畸形输入把主线程卡死。 */
const MAX_LCS_CELLS = 4_000_000

/** `Uint16Array` 能存的 LCS 长度上限。 */
const MAX_LCS_LENGTH = 65_535

/** 参与文字比对与输出的字段，顺序即 `changes` 里的顺序。 */
const TEXT_FIELDS = ['text', 'contentDescription', 'role']

/**
 * 比较两棵语义树。
 *
 * `before` / `after` 可以是 `null`（从未渲染过 / 缓存被删），也可以直接传节点
 * 数组（省掉一层 `.nodes`）。函数不改入参、不读文件、不碰网络。
 *
 * 返回结构：
 *
 * ```js
 * {
 *   added:     NodeSummary[],  // after 有、before 没有
 *   removed:   NodeSummary[],  // before 有、after 没有
 *   changed:   Change[],       // 配上但有差异，按 after 里的顺序
 *   unchanged: { count: number }, // 本次没动，只给数量
 *   frame: {
 *     before: Frame | null,    // { width?, height?, renderer? }
 *     after:  Frame | null,
 *     sizeChanged: boolean,    // 画布尺寸变了：整棵树坐标不可比
 *     rendererChanged: boolean,// studio / headless 换了，节点类型来源也变了
 *     changed: boolean,
 *   },
 *   summary: {
 *     beforeNodes: number,     // 过滤后参与比对的节点数
 *     afterNodes: number,
 *     added: number,
 *     removed: number,
 *     changed: number,         // 有文字或几何差异的节点数
 *     unchanged: number,
 *     textChanged: number,     // kind 含 text 的条数
 *     geometryChanged: number, // kind 含 geometry 的条数
 *     hasChanges: boolean,     // 含 frame 的变化
 *   },
 *   options: { minDelta: number, semanticOnly: boolean }, // 归一化后的选项
 * }
 * ```
 *
 * `NodeSummary = { id, type, depth, hasSemantics, text?, contentDescription?,
 * role?, bounds? }`——字段是从原节点归一化来的，缺失的可选字段不出现。
 *
 * `Change = { id, beforeId, afterId, type, depth, kind, matchedBy, changes?,
 * boundsChange? }`：
 *
 * - `kind`：`'text'`（只改了文字/语义）、`'geometry'`（只动了位置或尺寸）、
 *   `'both'`（两样都改）。
 * - `matchedBy`：`'key'`（内容对齐配上，最可信）、`'geometry'`（靠位置捞回来，
 *   通常意味着文字改过）、`'fallback'`（缺 bounds 的兜底配对，最不可信）。
 * - `changes`：`[{ field, before, after }]`，`field` 是 `text` /
 *   `contentDescription` / `role`，缺失值用 `null` 表示。
 * - `boundsChange`：`{ before, after, delta, maxDelta }`，`delta` 含
 *   `left/top/right/bottom/width/height` 六个差值；某一侧缺 bounds 时
 *   `delta` 与 `maxDelta` 为 `null`。
 *
 * **怎么区分「文字变了」和「节点没了 + 新节点来了」**：`changed` 里带
 * `changes` 的是文字变化（同一个节点还在，`beforeId` 与 `afterId` 都指向它）；
 * 只有 `added` 没有对应 `removed`（或反过来）才表示节点真的进出。整合方要
 * 优先看 `matchedBy`：`'key'` 是可信任的同一节点，`'geometry'` 是「位置没动
 * 但内容变了」的推断。
 *
 * @param {any} before - 上一次渲染的语义树，`null` 表示从未渲染过。
 * @param {any} after - 本次渲染的语义树，`null` 表示结果已不存在。
 * @param {{ minDelta?: number, semanticOnly?: boolean }} [options]
 *   `minDelta`：四边变化量的最大值小于它就算没变，默认 1；
 *   `semanticOnly`：只比对语义节点，显式传 `false` 才关闭，默认 true。
 * @returns {{
 *   added: object[],
 *   removed: object[],
 *   changed: object[],
 *   unchanged: { count: number },
 *   frame: object,
 *   summary: object,
 *   options: { minDelta: number, semanticOnly: boolean },
 * }}
 */
export function diffTrees(before, after, options = {}) {
  const settings = options !== null && typeof options === 'object' ? options : {}
  const minDelta = readMinDelta(settings)
  const semanticOnly = settings.semanticOnly !== false

  const beforeNodes = collectNodes(before, semanticOnly)
  const afterNodes = collectNodes(after, semanticOnly)
  const matches = alignNodes(beforeNodes, afterNodes)

  const matchedBefore = new Uint8Array(beforeNodes.length)
  const matchedAfter = new Uint8Array(afterNodes.length)
  for (const match of matches) {
    matchedBefore[match.before] = 1
    matchedAfter[match.after] = 1
  }

  const added = []
  for (let index = 0; index < afterNodes.length; index++) {
    if (matchedAfter[index] === 1) continue
    added.push(summarizeNode(afterNodes[index]))
  }

  const removed = []
  for (let index = 0; index < beforeNodes.length; index++) {
    if (matchedBefore[index] === 1) continue
    removed.push(summarizeNode(beforeNodes[index]))
  }

  let unchanged = 0
  let textChanged = 0
  let geometryChanged = 0
  const detailed = []
  for (const match of matches) {
    const entry = describeChange(beforeNodes[match.before], afterNodes[match.after], minDelta, match.by)
    if (entry === undefined) {
      unchanged++
      continue
    }
    if (entry.kind === 'text' || entry.kind === 'both') textChanged++
    if (entry.kind === 'geometry' || entry.kind === 'both') geometryChanged++
    detailed.push({ order: match.after, entry })
  }
  /* 几何配对是分段追加的，按 after 里的顺序重排一次，调用方拿到的就是稳定顺序。 */
  detailed.sort((left, right) => left.order - right.order)
  const changed = detailed.map((item) => item.entry)

  const frame = describeFrame(before, after)
  return {
    added,
    removed,
    changed,
    unchanged: { count: unchanged },
    frame,
    summary: {
      beforeNodes: beforeNodes.length,
      afterNodes: afterNodes.length,
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      unchanged,
      textChanged,
      geometryChanged,
      hasChanges: added.length + removed.length + changed.length > 0 || frame.changed,
    },
    options: { minDelta, semanticOnly },
  }
}

/**
 * 读 `minDelta`：非有限数或负数一律退回默认值，别把 NaN 传进比较。
 *
 * 必须用 `Number.isFinite` 兜一遍：`typeof NaN === 'number'` 为真，而
 * `NaN < 0` 与 `NaN === undefined` 都为假，漏掉它会让 `maxDelta < minDelta`
 * 永远不成立，所有位移都被当成真实变化。
 *
 * @param {any} options
 * @returns {number}
 */
function readMinDelta(options) {
  const value = options.minDelta
  const numeric = typeof value === 'number' ? value : toFinite(value)
  if (numeric === undefined || !Number.isFinite(numeric) || numeric < 0) return DEFAULT_MIN_DELTA
  return numeric
}

/**
 * 把树或节点数组摊平成归一化节点列表。
 *
 * `nodes` 不是数组、整棵树是 `null`、节点是数字或 `null`，都退化成「空列表」或
 * 一个 `Unknown` 节点，绝不抛异常——diff 是展示路径上的功能，不能因为一次
 * 畸形渲染结果把整个面板带崩。
 *
 * @param {any} tree
 * @param {boolean} semanticOnly
 * @returns {object[]}
 */
function collectNodes(tree, semanticOnly) {
  const source = Array.isArray(tree)
    ? tree
    : tree !== null && typeof tree === 'object' && Array.isArray(tree.nodes)
      ? tree.nodes
      : []
  const nodes = []
  for (let index = 0; index < source.length; index++) {
    const node = normalizeNode(source[index], index)
    if (semanticOnly && !isSemantic(node)) continue
    nodes.push(node)
  }
  return nodes
}

/**
 * 判断一个节点算不算「语义节点」。
 *
 * 严格按 `hasSemantics === true` 会误伤两种情况：headless 路径偶尔漏写这个字段，
 * 以及测试 / 手工构造的树根本没带它。所以带文字、无障碍描述或角色的节点也一起
 * 留下——它们本来就是用户能感知的语义。真正被筛掉的是 `Box`、`Column` 这类
 * 没有文字、`hasSemantics: false` 的容器，这正是 `semanticOnly` 想做的事。
 *
 * @param {object} node
 * @returns {boolean}
 */
function isSemantic(node) {
  return node.hasSemantics
    || node.text !== undefined
    || node.contentDescription !== undefined
    || node.role !== undefined
}

/**
 * 归一化单个节点：所有字段都读成确定的值，读不出来就用默认值。
 *
 * @param {any} raw
 * @param {number} index - 在数组里的下标，用来给缺 id 的节点编一个稳定兜底 id。
 * @returns {object}
 */
function normalizeNode(raw, index) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const text = normalizeText(source.text)
  const contentDescription = normalizeText(source.contentDescription)
  const role = normalizeText(source.role)
  return {
    id: typeof source.id === 'string' && source.id.length > 0 ? source.id : `#${index}`,
    type: typeof source.type === 'string' && source.type.length > 0 ? source.type : 'Unknown',
    ...(text === undefined ? {} : { text }),
    ...(contentDescription === undefined ? {} : { contentDescription }),
    ...(role === undefined ? {} : { role }),
    bounds: readBounds(source.bounds),
    depth: toFinite(source.depth) ?? 0,
    hasSemantics: source.hasSemantics === true,
    index,
  }
}

/**
 * 归一化文字类字段：非字符串、或去掉空白后为空，一律视为「没有」。
 *
 * 空串与缺失必须等同，否则渲染端一次「写了空字符串」就会被报成文字变化。
 * 非空字符串保留原样（含首尾空格），因为那是用户按下的真实内容。
 *
 * @param {any} value
 * @returns {string | undefined}
 */
function normalizeText(value) {
  if (typeof value !== 'string') return undefined
  return value.trim().length === 0 ? undefined : value
}

/**
 * 把任意值读成有限数，读不出来返回 undefined。
 * @param {any} value
 * @returns {number | undefined}
 */
function toFinite(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : undefined
  }
  return undefined
}

/**
 * 读 bounds。
 *
 * 缺任何一条边就返回 undefined，**不补 0**：补出来的 `(0,0,0,0)` 会被当成一个
 * 真实存在的左上角零尺寸矩形，几何配对会拿它去和左上角节点乱配。缺就是缺，
 * 交给兜底路径处理。
 *
 * @param {any} value
 * @returns {{ left: number, top: number, right: number, bottom: number } | undefined}
 */
function readBounds(value) {
  if (value === null || typeof value !== 'object') return undefined
  const left = toFinite(value.left)
  const top = toFinite(value.top)
  const right = toFinite(value.right)
  const bottom = toFinite(value.bottom)
  if (left === undefined || top === undefined || right === undefined || bottom === undefined) return undefined
  return { left, top, right, bottom }
}

/**
 * 画布宽。
 * @param {{ left: number, right: number }} bounds
 * @returns {number}
 */
function widthOf(bounds) {
  return bounds.right - bounds.left
}

/**
 * 画布高。
 * @param {{ top: number, bottom: number }} bounds
 * @returns {number}
 */
function heightOf(bounds) {
  return bounds.bottom - bounds.top
}

/**
 * 一个节点的匹配键：类型 + 全部文字类语义。
 *
 * 不含 `bounds`，因为插入/删除会让下方节点整体平移；不含 `depth`，因为包一层
 * 容器会让深度整体 +1。这两样都是「结构位移」而不是「换了节点」，拿来当身份
 * 会把正常改动放大成大片假 diff。
 *
 * @param {object} node
 * @returns {string}
 */
function matchKey(node) {
  return JSON.stringify([node.type, node.text ?? null, node.contentDescription ?? null, node.role ?? null])
}

/**
 * 两段式对齐：先按内容求 LCS，再在残段里按几何补。
 *
 * @param {object[]} beforeNodes
 * @param {object[]} afterNodes
 * @returns {{ before: number, after: number, by: string }[]}
 */
function alignNodes(beforeNodes, afterNodes) {
  const beforeKeys = beforeNodes.map(matchKey)
  const afterKeys = afterNodes.map(matchKey)
  const anchors = longestCommonSubsequence(beforeKeys, afterKeys)

  const beforeUsed = new Uint8Array(beforeNodes.length)
  const afterUsed = new Uint8Array(afterNodes.length)
  const matches = []
  for (const [beforeIndex, afterIndex] of anchors) {
    beforeUsed[beforeIndex] = 1
    afterUsed[afterIndex] = 1
    matches.push({ before: beforeIndex, after: afterIndex, by: 'key' })
  }

  let previousBefore = -1
  let previousAfter = -1
  for (const [beforeIndex, afterIndex] of anchors) {
    collectGapMatches(
      beforeNodes, afterNodes,
      previousBefore + 1, beforeIndex, previousAfter + 1, afterIndex,
      beforeUsed, afterUsed, matches,
    )
    previousBefore = beforeIndex
    previousAfter = afterIndex
  }
  collectGapMatches(
    beforeNodes, afterNodes,
    previousBefore + 1, beforeNodes.length, previousAfter + 1, afterNodes.length,
    beforeUsed, afterUsed, matches,
  )
  return matches
}

/**
 * 在一个「残段」里按几何配对：LCS 两个匹配点之间的区间即一段。
 *
 * 只在同一段里配，是为了防止「删掉第 2 行」时把第 2 行错配给远处的某个同类节点。
 * 段内先按打分贪心（距离近的优先），再对缺 bounds 的情况做同 type 唯一兜底。
 *
 * @param {object[]} beforeNodes
 * @param {object[]} afterNodes
 * @param {number} beforeStart
 * @param {number} beforeEnd
 * @param {number} afterStart
 * @param {number} afterEnd
 * @param {Uint8Array} beforeUsed
 * @param {Uint8Array} afterUsed
 * @param {{ before: number, after: number, by: string }[]} matches - 就地追加。
 * @returns {void}
 */
function collectGapMatches(beforeNodes, afterNodes, beforeStart, beforeEnd, afterStart, afterEnd, beforeUsed, afterUsed, matches) {
  if (beforeStart >= beforeEnd || afterStart >= afterEnd) return

  const candidates = []
  for (let beforeIndex = beforeStart; beforeIndex < beforeEnd; beforeIndex++) {
    if (beforeUsed[beforeIndex] === 1) continue
    for (let afterIndex = afterStart; afterIndex < afterEnd; afterIndex++) {
      if (afterUsed[afterIndex] === 1) continue
      /* 类型都换了就不是同一个控件，宁可报消失 + 新增，也不猜。 */
      if (beforeNodes[beforeIndex].type !== afterNodes[afterIndex].type) continue
      const score = pairScore(beforeNodes[beforeIndex], afterNodes[afterIndex])
      if (score === undefined) continue
      candidates.push({ score, before: beforeIndex, after: afterIndex })
    }
  }

  candidates.sort((left, right) => left.score - right.score || left.before - right.before || left.after - right.after)
  for (const candidate of candidates) {
    if (beforeUsed[candidate.before] === 1 || afterUsed[candidate.after] === 1) continue
    beforeUsed[candidate.before] = 1
    afterUsed[candidate.after] = 1
    matches.push({ before: candidate.before, after: candidate.after, by: 'geometry' })
  }

  /*
   * 兜底只给「缺 bounds」的数据用：段内同 type 且两边各只剩一个时直接配上。
   * 有坐标却超出阈值的不走这里——那就该老实报成消失 + 新增。
   */
  const remainingBefore = groupByType(beforeNodes, beforeStart, beforeEnd, beforeUsed)
  const remainingAfter = groupByType(afterNodes, afterStart, afterEnd, afterUsed)
  for (const [type, beforeList] of remainingBefore) {
    if (beforeList.length !== 1) continue
    const afterList = remainingAfter.get(type)
    if (afterList === undefined || afterList.length !== 1) continue
    const beforeIndex = beforeList[0]
    const afterIndex = afterList[0]
    if (beforeNodes[beforeIndex].bounds !== undefined && afterNodes[afterIndex].bounds !== undefined) continue
    beforeUsed[beforeIndex] = 1
    afterUsed[afterIndex] = 1
    matches.push({ before: beforeIndex, after: afterIndex, by: 'fallback' })
  }
}

/**
 * 段内未匹配节点按 `type` 分组。
 * @param {object[]} nodes
 * @param {number} start
 * @param {number} end
 * @param {Uint8Array} used
 * @returns {Map<string, number[]>}
 */
function groupByType(nodes, start, end, used) {
  const groups = new Map()
  for (let index = start; index < end; index++) {
    if (used[index] === 1) continue
    const type = nodes[index].type
    const list = groups.get(type)
    if (list === undefined) groups.set(type, [index])
    else list.push(index)
  }
  return groups
}

/**
 * 给一对候选节点打分，算不了配对就返回 undefined。
 *
 * 打分 = 四边最大差值 + 深度差惩罚。四边一起看是因为它同时覆盖「位移」（四条边
 * 同向平移）和「尺寸变化」（左右或上下反向），比只看中心点或只看宽高都稳。
 * 阈值按最大边长放大，否则「登录」改成「立即登录」这种把整行撑宽的文字变化会
 * 因为超出固定阈值而被误报成消失 + 新增。
 *
 * @param {object} beforeNode
 * @param {object} afterNode
 * @returns {number | undefined}
 */
function pairScore(beforeNode, afterNode) {
  const left = beforeNode.bounds
  const right = afterNode.bounds
  if (left === undefined || right === undefined) return undefined
  const distance = Math.max(
    Math.abs(left.left - right.left),
    Math.abs(left.top - right.top),
    Math.abs(left.right - right.right),
    Math.abs(left.bottom - right.bottom),
  )
  if (!Number.isFinite(distance)) return undefined
  const size = Math.max(
    widthOf(left), heightOf(left), widthOf(right), heightOf(right), 1,
  )
  const limit = Math.max(MIN_PAIR_DISTANCE, size * PAIR_DISTANCE_SCALE)
  if (distance > limit) return undefined
  return distance + Math.abs(beforeNode.depth - afterNode.depth) * DEPTH_PENALTY
}

/**
 * 求最长公共子序列，返回成对的索引。
 *
 * 用后缀长度的 DP 表回溯：`table[i][j]` 是 `left[i..]` 与 `right[j..]` 的 LCS
 * 长度，回溯时能配就配，不能配就往长度更大的那一侧走一格。格子数超过上限
 * （畸形输入或超大树）时退回保序贪心，结果略差但不会卡住。
 *
 * 这里用 `Uint16Array` 存长度：`Uint16` 上限 65535，而 LCS 长度不可能超过
 * `min(rows, columns)`；又因为格子总数受限，真正能到上限的组合走的是退化路径，
 * 所以不会溢出。
 *
 * @param {string[]} left
 * @param {string[]} right
 * @returns {[number, number][]}
 */
function longestCommonSubsequence(left, right) {
  const rows = left.length
  const columns = right.length
  if (rows === 0 || columns === 0) return []
  if (rows > MAX_LCS_LENGTH || columns > MAX_LCS_LENGTH || (rows + 1) * (columns + 1) > MAX_LCS_CELLS) {
    return pairByOrder(left, right)
  }

  const stride = columns + 1
  const table = new Uint16Array((rows + 1) * stride)
  for (let row = rows - 1; row >= 0; row--) {
    const rowBase = row * stride
    const nextBase = rowBase + stride
    for (let column = columns - 1; column >= 0; column--) {
      table[rowBase + column] = left[row] === right[column]
        ? table[nextBase + column + 1] + 1
        : Math.max(table[nextBase + column], table[rowBase + column + 1])
    }
  }

  const pairs = []
  let row = 0
  let column = 0
  while (row < rows && column < columns) {
    if (left[row] === right[column] && table[(row + 1) * stride + column + 1] + 1 === table[row * stride + column]) {
      pairs.push([row, column])
      row++
      column++
      continue
    }
    if (table[(row + 1) * stride + column] >= table[row * stride + column + 1]) row++
    else column++
  }
  return pairs
}

/**
 * 退化路径：按 key 分组，各自按出现顺序保序配对。
 *
 * 不是最长公共子序列（重复 key 多时会少配几对），但它是 O(n log n) 的，只在
 * LCS 表超限时才会走到。
 *
 * @param {string[]} left
 * @param {string[]} right
 * @returns {[number, number][]}
 */
function pairByOrder(left, right) {
  const pools = new Map()
  for (let index = 0; index < left.length; index++) {
    const pool = pools.get(left[index])
    if (pool === undefined) pools.set(left[index], [index])
    else pool.push(index)
  }
  const cursors = new Map()
  const pairs = []
  let floor = -1
  for (let column = 0; column < right.length; column++) {
    const key = right[column]
    const pool = pools.get(key)
    if (pool === undefined) continue
    let cursor = cursors.get(key) ?? 0
    /* 为了保证左右顺序一致，已经落在上一个匹配之前的位置全部作废。 */
    while (cursor < pool.length && pool[cursor] <= floor) cursor++
    if (cursor >= pool.length) {
      cursors.set(key, cursor)
      continue
    }
    pairs.push([pool[cursor], column])
    floor = pool[cursor]
    cursors.set(key, cursor + 1)
  }
  return pairs
}

/**
 * 给一对已经配上的节点描述差异；完全一样时返回 undefined。
 *
 * @param {object} beforeNode
 * @param {object} afterNode
 * @param {number} minDelta
 * @param {string} matchedBy
 * @returns {object | undefined}
 */
function describeChange(beforeNode, afterNode, minDelta, matchedBy) {
  const changes = []
  for (const field of TEXT_FIELDS) {
    const previous = beforeNode[field] ?? null
    const next = afterNode[field] ?? null
    if (previous === next) continue
    changes.push({ field, before: previous, after: next })
  }
  const boundsChange = describeBoundsChange(beforeNode.bounds, afterNode.bounds, minDelta)
  if (changes.length === 0 && boundsChange === undefined) return undefined

  const kind = changes.length > 0
    ? boundsChange === undefined ? 'text' : 'both'
    : 'geometry'
  return {
    id: afterNode.id,
    beforeId: beforeNode.id,
    afterId: afterNode.id,
    type: afterNode.type,
    depth: afterNode.depth,
    kind,
    matchedBy,
    ...(changes.length === 0 ? {} : { changes }),
    ...(boundsChange === undefined ? {} : { boundsChange }),
  }
}

/**
 * 描述 bounds 差异；变化小于 `minDelta` 时返回 undefined。
 *
 * 某一侧缺 bounds 时按「变化了」保守上报（`delta` 与 `maxDelta` 为 `null`）：
 * 宁可让用户点开看一眼，也别悄悄把一条结构变化吞掉。
 *
 * @param {{ left: number, top: number, right: number, bottom: number } | undefined} beforeBounds
 * @param {{ left: number, top: number, right: number, bottom: number } | undefined} afterBounds
 * @param {number} minDelta
 * @returns {object | undefined}
 */
function describeBoundsChange(beforeBounds, afterBounds, minDelta) {
  if (beforeBounds === undefined && afterBounds === undefined) return undefined
  if (beforeBounds === undefined || afterBounds === undefined) {
    return {
      before: beforeBounds === undefined ? null : withSize(beforeBounds),
      after: afterBounds === undefined ? null : withSize(afterBounds),
      delta: null,
      maxDelta: null,
    }
  }

  const delta = {
    left: afterBounds.left - beforeBounds.left,
    top: afterBounds.top - beforeBounds.top,
    right: afterBounds.right - beforeBounds.right,
    bottom: afterBounds.bottom - beforeBounds.bottom,
    width: widthOf(afterBounds) - widthOf(beforeBounds),
    height: heightOf(afterBounds) - heightOf(beforeBounds),
  }
  const maxDelta = Math.max(
    Math.abs(delta.left),
    Math.abs(delta.top),
    Math.abs(delta.right),
    Math.abs(delta.bottom),
  )
  if (maxDelta === 0) return undefined
  if (maxDelta < minDelta) return undefined
  return {
    before: withSize(beforeBounds),
    after: withSize(afterBounds),
    delta,
    maxDelta,
  }
}

/**
 * 给 bounds 补上宽高，方便调用方直接读，不用自己减。
 * @param {{ left: number, top: number, right: number, bottom: number }} bounds
 * @returns {object}
 */
function withSize(bounds) {
  return {
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
    width: widthOf(bounds),
    height: heightOf(bounds),
  }
}

/**
 * 输出一个节点的摘要。缺失的可选字段直接不出现，避免 `undefined` 键到处传。
 * @param {object} node
 * @returns {object}
 */
function summarizeNode(node) {
  return {
    id: node.id,
    type: node.type,
    depth: node.depth,
    hasSemantics: node.hasSemantics,
    ...(node.text === undefined ? {} : { text: node.text }),
    ...(node.contentDescription === undefined ? {} : { contentDescription: node.contentDescription }),
    ...(node.role === undefined ? {} : { role: node.role }),
    ...(node.bounds === undefined ? {} : { bounds: { ...node.bounds } }),
  }
}

/**
 * 读树级元信息（画布尺寸与渲染器）。
 *
 * 尺寸变了意味着两次渲染的坐标根本不可比，调用方应该先提示用户，再看节点差异。
 * 直接传节点数组时没有元信息，返回 undefined。
 *
 * @param {any} tree
 * @returns {object | undefined}
 */
function readFrame(tree) {
  if (tree === null || typeof tree !== 'object' || Array.isArray(tree)) return undefined
  const frame = {}
  const width = toFinite(tree.width)
  const height = toFinite(tree.height)
  if (width !== undefined) frame.width = width
  if (height !== undefined) frame.height = height
  if (typeof tree.renderer === 'string' && tree.renderer.length > 0) frame.renderer = tree.renderer
  return frame
}

/**
 * 比较两次渲染的树级元信息。
 * @param {any} before
 * @param {any} after
 * @returns {{ before: object | null, after: object | null, sizeChanged: boolean, rendererChanged: boolean, changed: boolean }}
 */
function describeFrame(before, after) {
  const beforeFrame = readFrame(before)
  const afterFrame = readFrame(after)
  const comparableSize = beforeFrame !== undefined && afterFrame !== undefined
    && beforeFrame.width !== undefined && beforeFrame.height !== undefined
    && afterFrame.width !== undefined && afterFrame.height !== undefined
  const sizeChanged = comparableSize
    && (beforeFrame.width !== afterFrame.width || beforeFrame.height !== afterFrame.height)
  const rendererChanged = beforeFrame?.renderer !== undefined && afterFrame?.renderer !== undefined
    && beforeFrame.renderer !== afterFrame.renderer
  return {
    before: beforeFrame ?? null,
    after: afterFrame ?? null,
    sizeChanged,
    rendererChanged,
    changed: sizeChanged || rendererChanged,
  }
}
