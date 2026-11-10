/**
 * 语义树 diff 的单元测试。
 *
 * 用例全部取自面板里真实会出现的两种树：Studio 路径的 `TextView`/`Button`
 * 可读树，以及 headless 路径那种 77 个节点里只有十几个带语义的容器树。
 * 重点不是覆盖率，而是证明四种日常改动（插入一行、删除一行、改文字、
 * 微调 padding）不会被放大成满屏「新增 + 消失」。
 *
 *   node --test test/
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { diffTrees } from '../src/host/preview-diff.js'

/**
 * 造一个节点。缺省 `hasSemantics` 按「有文字就算有语义」推断，和
 * `preview.js` 里 Studio 路径的归一化口径一致。
 * @param {object} overrides
 * @returns {object}
 */
function node(overrides) {
  const hasText = typeof overrides.text === 'string' && overrides.text.length > 0
  return {
    hasSemantics: hasText,
    depth: 4,
    ...overrides,
  }
}

/**
 * 造一个矩形。
 * @param {number} left
 * @param {number} top
 * @param {number} right
 * @param {number} bottom
 * @returns {{ left: number, top: number, right: number, bottom: number }}
 */
function box(left, top, right, bottom) {
  return { left, top, right, bottom }
}

/**
 * 造一棵 Studio 路径的登录页树。
 *
 * 返回的是工厂函数：调用方可以按自己的场景改写某一项再拼回去，
 * 避免每个用例都重抄一遍这四行。
 *
 * @param {{ titleTop?: number, buttonTop?: number }} [shift]
 * @returns {object}
 */
function loginTree(shift = {}) {
  const titleTop = shift.titleTop ?? 120
  const buttonTop = shift.buttonTop ?? 1625
  return {
    width: 1080,
    height: 2400,
    renderer: 'studio',
    nodes: [
      node({ id: 'n0', type: 'TextView', text: '邮箱登录', depth: 4, bounds: box(40, titleTop, 600, titleTop + 60) }),
      node({ id: 'n1', type: 'EditText', text: '请输入邮箱', depth: 4, bounds: box(40, 240, 1040, 330) }),
      node({ id: 'n2', type: 'EditText', text: '请输入密码', depth: 4, bounds: box(40, 350, 1040, 440) }),
      node({
        id: 'n3',
        type: 'Button',
        text: '登录',
        role: 'Button',
        depth: 6,
        bounds: box(63, buttonTop, 1017, buttonTop + 137),
      }),
    ],
  }
}

/**
 * 造一棵 headless 路径的树：大量 `Box` / `Column` 容器只有少数带语义。
 * @returns {object}
 */
function headlessTree() {
  return {
    width: 1080,
    height: 2400,
    renderer: 'headless',
    nodes: [
      { id: 'n0', type: 'Box', depth: 0, hasSemantics: false, bounds: box(0, 0, 1080, 2400) },
      { id: 'n1', type: 'Column', depth: 1, hasSemantics: false, bounds: box(0, 0, 1080, 2400) },
      { id: 'n2', type: 'Row', depth: 2, hasSemantics: false, bounds: box(0, 0, 1080, 240) },
      node({ id: 'n3', type: 'TextView', text: '邮箱登录', depth: 2, bounds: box(40, 120, 600, 180) }),
      { id: 'n4', type: 'Box', depth: 2, hasSemantics: false, bounds: box(40, 240, 1040, 330) },
      node({ id: 'n5', type: 'EditText', text: '请输入邮箱', depth: 3, bounds: box(40, 240, 1040, 330) }),
      node({ id: 'n6', type: 'TextView', text: '获取验证码', depth: 3, bounds: box(760, 240, 1040, 330) }),
      { id: 'n7', type: 'Box', depth: 2, hasSemantics: false, bounds: box(40, 350, 1040, 440) },
      node({ id: 'n8', type: 'EditText', text: '请输入密码', depth: 3, bounds: box(40, 350, 1040, 440) }),
      { id: 'n9', type: 'Column', depth: 2, hasSemantics: false, bounds: box(40, 1625, 1017, 1762) },
      node({ id: 'n10', type: 'Button', text: '登录', role: 'Button', depth: 3, bounds: box(63, 1625, 1017, 1762) }),
    ],
  }
}

test('diffTrees 对两棵完全相同的树报告无变化', () => {
  const result = diffTrees(loginTree(), loginTree())
  assert.deepEqual(result.added, [])
  assert.deepEqual(result.removed, [])
  assert.deepEqual(result.changed, [])
  assert.equal(result.unchanged.count, 4)
  assert.equal(result.summary.hasChanges, false)
  assert.equal(result.frame.sizeChanged, false)
})

test('diffTrees 在 before 为 null 时全部算新增', () => {
  const result = diffTrees(null, loginTree())
  assert.equal(result.added.length, 4)
  assert.equal(result.removed.length, 0)
  assert.equal(result.changed.length, 0)
  assert.equal(result.frame.before, null)
  assert.equal(result.frame.after.width, 1080)
  assert.equal(result.frame.rendererChanged, false)
  assert.equal(result.summary.hasChanges, true)
})

test('diffTrees 在 after 为 null 时全部算消失', () => {
  const result = diffTrees(loginTree(), null)
  assert.equal(result.added.length, 0)
  assert.equal(result.removed.length, 4)
  assert.equal(result.frame.after, null)
})

test('diffTrees 两边都是 null 时给出空结果而不是抛异常', () => {
  const result = diffTrees(null, null, {})
  assert.deepEqual(result.added, [])
  assert.deepEqual(result.removed, [])
  assert.deepEqual(result.changed, [])
  assert.equal(result.unchanged.count, 0)
  assert.equal(result.summary.hasChanges, false)
  assert.equal(result.options.minDelta, 1)
  assert.equal(result.options.semanticOnly, true)
})

test('插入一行只报一个新的，不会把后面的节点一起报成新增+消失', () => {
  const before = loginTree()
  const after = loginTree()
  /* 在「邮箱」和「密码」之间插一行错误提示，并把下面整体下移 40 像素。 */
  after.nodes = [
    after.nodes[0],
    after.nodes[1],
    node({ id: 'n2', type: 'TextView', text: '邮箱格式不正确', depth: 4, bounds: box(40, 350, 1040, 390) }),
    node({ id: 'n3', type: 'EditText', text: '请输入密码', depth: 4, bounds: box(40, 390, 1040, 480) }),
    node({ id: 'n4', type: 'Button', text: '登录', role: 'Button', depth: 6, bounds: box(63, 1665, 1017, 1802) }),
  ]

  const result = diffTrees(before, after)
  assert.deepEqual(result.added.map((entry) => entry.text), ['邮箱格式不正确'])
  assert.deepEqual(result.removed, [])
  /*
   * 插入行让下面的真实位移被报出来，这是对的；关键是它落在 changed 里，
   * 并且 delta 方向一致（都往下 40），而不是一堆 removed + added。
   */
  const moved = result.changed.filter((entry) => entry.kind === 'geometry')
  assert.equal(moved.length, 2)
  for (const entry of moved) {
    assert.equal(entry.boundsChange.delta.top, 40)
    assert.equal(entry.matchedBy, 'key')
  }
  assert.equal(result.summary.added, 1)
  assert.equal(result.summary.removed, 0)
})

test('删除一行只报消失，其余节点不受 id 错位影响', () => {
  const before = loginTree()
  const after = loginTree()
  /* 删掉「请输入密码」：它在 before 里是 n2，after 里「登录」的 id 从 n3 变成 n2。 */
  after.nodes = [after.nodes[0], after.nodes[1], after.nodes[3]]

  const result = diffTrees(before, after)
  assert.deepEqual(result.removed.map((entry) => entry.text), ['请输入密码'])
  assert.deepEqual(result.added, [])
  assert.deepEqual(result.changed, [])
  assert.equal(result.unchanged.count, 3)
})

test('文字改了报成同一个节点的文字变化，而不是消失+新增', () => {
  const before = loginTree()
  const after = loginTree()
  after.nodes[2] = node({ id: 'n2', type: 'EditText', text: '请输入密码（6-20 位）', depth: 4, bounds: box(40, 350, 1040, 440) })

  const result = diffTrees(before, after)
  assert.deepEqual(result.added, [])
  assert.deepEqual(result.removed, [])
  assert.equal(result.changed.length, 1)
  const [entry] = result.changed
  assert.equal(entry.kind, 'text')
  assert.equal(entry.type, 'EditText')
  assert.equal(entry.beforeId, 'n2')
  assert.equal(entry.afterId, 'n2')
  assert.deepEqual(entry.changes, [{ field: 'text', before: '请输入密码', after: '请输入密码（6-20 位）' }])
  assert.equal(entry.boundsChange, undefined)
})

test('contentDescription 与 role 的变化走同一条文字变化通道', () => {
  const before = {
    width: 1080,
    height: 2400,
    renderer: 'studio',
    nodes: [
      node({ id: 'n0', type: 'ImageView', contentDescription: '关闭', depth: 3, bounds: box(960, 60, 1040, 140) }),
      node({ id: 'n1', type: 'Button', text: '确定', role: 'Button', depth: 4, bounds: box(63, 1625, 1017, 1762) }),
    ],
  }
  const after = {
    width: 1080,
    height: 2400,
    renderer: 'studio',
    nodes: [
      node({ id: 'n0', type: 'ImageView', contentDescription: '关闭弹窗', depth: 3, bounds: box(960, 60, 1040, 140) }),
      node({ id: 'n1', type: 'Button', text: '确定', role: 'CheckBox', depth: 4, bounds: box(63, 1625, 1017, 1762) }),
    ],
  }

  const result = diffTrees(before, after)
  assert.equal(result.changed.length, 2)
  assert.deepEqual(result.changed[0].changes, [{ field: 'contentDescription', before: '关闭', after: '关闭弹窗' }])
  assert.deepEqual(result.changed[1].changes, [{ field: 'role', before: 'Button', after: 'CheckBox' }])
  assert.equal(result.summary.textChanged, 2)
  assert.equal(result.summary.geometryChanged, 0)
})

test('微调 padding 报成位移，并给出变化前后与差值', () => {
  const before = loginTree()
  const after = loginTree()
  after.nodes[1] = node({ id: 'n1', type: 'EditText', text: '请输入邮箱', depth: 4, bounds: box(56, 240, 1024, 330) })

  const result = diffTrees(before, after)
  assert.equal(result.changed.length, 1)
  const [entry] = result.changed
  assert.equal(entry.kind, 'geometry')
  assert.equal(entry.boundsChange.before.left, 40)
  assert.equal(entry.boundsChange.after.left, 56)
  assert.equal(entry.boundsChange.delta.left, 16)
  assert.equal(entry.boundsChange.delta.right, -16)
  assert.equal(entry.boundsChange.delta.width, -32)
  assert.equal(entry.boundsChange.delta.height, 0)
  assert.equal(entry.boundsChange.maxDelta, 16)
  assert.equal(result.summary.geometryChanged, 1)
  assert.equal(result.summary.textChanged, 0)
})

test('文字和位置同时变时 kind 是 both，两块信息都给', () => {
  const before = loginTree()
  const after = loginTree()
  after.nodes[3] = node({ id: 'n3', type: 'Button', text: '立即登录', role: 'Button', depth: 6, bounds: box(63, 1625, 1017, 1780) })

  const result = diffTrees(before, after)
  assert.equal(result.changed.length, 1)
  const [entry] = result.changed
  assert.equal(entry.kind, 'both')
  assert.equal(entry.changes.length, 1)
  assert.equal(entry.boundsChange.delta.bottom, 18)
})

test('minDelta 把亚像素抖动吃掉，阈值以上才报', () => {
  const before = loginTree()
  const after = loginTree()
  /* 三次渲染之间常见的 2 像素抖动。 */
  after.nodes[0] = node({ id: 'n0', type: 'TextView', text: '邮箱登录', depth: 4, bounds: box(40, 122, 600, 182) })

  const reported = diffTrees(before, after)
  assert.equal(reported.changed.length, 1)
  assert.equal(reported.changed[0].boundsChange.maxDelta, 2)

  const swallowed = diffTrees(before, after, { minDelta: 5 })
  assert.equal(swallowed.changed.length, 0)
  assert.equal(swallowed.unchanged.count, 4)
  assert.equal(swallowed.options.minDelta, 5)

  /* 等于阈值时按「够大」处理，只在严格小于时吞掉。 */
  const equal = diffTrees(before, after, { minDelta: 2 })
  assert.equal(equal.changed.length, 1)
})

test('minDelta 为 0 时 1 像素也算变化', () => {
  const before = loginTree()
  const after = loginTree()
  after.nodes[0] = node({ id: 'n0', type: 'TextView', text: '邮箱登录', depth: 4, bounds: box(40, 121, 600, 181) })

  assert.equal(diffTrees(before, after).changed.length, 1)
  assert.equal(diffTrees(before, after, { minDelta: 0 }).changed.length, 1)
})

test('minDelta 是负数或 NaN 时退回默认值，不把 NaN 带进比较', () => {
  const before = loginTree()
  const after = loginTree()
  after.nodes[0] = node({ id: 'n0', type: 'TextView', text: '邮箱登录', depth: 4, bounds: box(40, 122, 600, 182) })

  for (const value of [-5, Number.NaN, Number.POSITIVE_INFINITY, 'abc', null, undefined]) {
    const result = diffTrees(before, after, { minDelta: value })
    assert.equal(result.options.minDelta, 1, String(value))
    assert.equal(result.changed.length, 1, String(value))
  }
})

test('semanticOnly 默认过滤掉没有文字的容器节点', () => {
  const before = headlessTree()
  const after = headlessTree()
  /* 整体容器被挪动 8 像素：没有语义，不该打扰用户。 */
  after.nodes[0] = { id: 'n0', type: 'Box', depth: 0, hasSemantics: false, bounds: box(2, 2, 1082, 2402) }

  const result = diffTrees(before, after)
  assert.equal(result.changed.length, 0)
  /* 11 个节点里只有 5 个带语义：两段文字输入、标题、验证码、按钮。 */
  assert.equal(result.summary.beforeNodes, 5)
  assert.equal(result.summary.afterNodes, 5)
})

test('semanticOnly=false 时容器一起参与比对', () => {
  const before = headlessTree()
  const after = headlessTree()
  after.nodes[0] = { id: 'n0', type: 'Box', depth: 0, hasSemantics: false, bounds: box(2, 0, 1080, 2398) }

  const result = diffTrees(before, after, { semanticOnly: false })
  assert.equal(result.options.semanticOnly, false)
  assert.equal(result.summary.beforeNodes, 11)
  assert.equal(result.changed.length, 1)
  assert.equal(result.changed[0].type, 'Box')
  assert.equal(result.changed[0].kind, 'geometry')
})

test('id 全量错位但内容相同的节点不应被报成新增+消失', () => {
  /*
   * 这是模块存在的理由：在 headless 树最前面插一个容器，后面 10 个节点的 id
   * 全部后移一位。如果按 id 比对，这里会变成 10 条消失 + 10 条新增。
   */
  const before = headlessTree()
  const after = {
    width: 1080,
    height: 2400,
    renderer: 'headless',
    nodes: [
      { id: 'n0', type: 'Box', depth: 0, hasSemantics: false, bounds: box(0, 0, 1080, 2400) },
      /* 新插进来的一层容器：下面所有节点的 id 因此整体后移一位。 */
      { id: 'n1', type: 'Box', depth: 1, hasSemantics: false, bounds: box(0, 0, 1080, 2400) },
      ...before.nodes.slice(1).map((entry, index) => ({ ...entry, id: `n${index + 2}`, depth: entry.depth + 1 })),
    ],
  }

  const result = diffTrees(before, after)
  assert.deepEqual(result.added, [])
  assert.deepEqual(result.removed, [])
  assert.deepEqual(result.changed, [])
  assert.equal(result.unchanged.count, 5)

  /* 容器开关打开后，多出来的那层容器确实被认成新增，但语义节点仍然稳定。 */
  const withContainers = diffTrees(before, after, { semanticOnly: false })
  assert.equal(withContainers.added.length, 1)
  assert.equal(withContainers.added[0].type, 'Box')
  assert.deepEqual(withContainers.removed, [])
})

test('id 全部重排的两棵树在所有节点上都按内容配上', () => {
  const before = loginTree()
  const after = loginTree()
  /* 模拟「源码里加了个 Composable，旧的 id 全废」。 */
  after.nodes = after.nodes.map((entry, index) => ({ ...entry, id: `x${index}` }))

  const result = diffTrees(before, after)
  assert.deepEqual(result.added, [])
  assert.deepEqual(result.removed, [])
  assert.deepEqual(result.changed, [])
  assert.equal(result.unchanged.count, 4)
})

test('缺 bounds 的节点不抛异常，差异里 delta 为 null', () => {
  const before = loginTree()
  const after = loginTree()
  delete after.nodes[0].bounds

  const result = diffTrees(before, after)
  assert.equal(result.added.length, 0)
  assert.equal(result.removed.length, 0)
  assert.equal(result.changed.length, 1)
  const [entry] = result.changed
  assert.equal(entry.kind, 'geometry')
  assert.equal(entry.boundsChange.delta, null)
  assert.equal(entry.boundsChange.maxDelta, null)
  assert.equal(entry.boundsChange.before.left, 40)
  assert.equal(entry.boundsChange.after, null)
})

test('bounds 为 null、节点为 null、节点是数字都不抛', () => {
  const before = {
    width: 1080,
    height: 2400,
    nodes: [
      { id: 'n0', type: 'TextView', text: '甲', hasSemantics: true, bounds: null },
      null,
      42,
      { id: 'n3', type: 'TextView', text: '乙', hasSemantics: true },
    ],
  }
  const after = {
    width: 1080,
    height: 2400,
    nodes: [
      { id: 'n0', type: 'TextView', text: '甲', hasSemantics: true },
      { id: 'n1', type: 'TextView', text: '乙', hasSemantics: true, bounds: box(10, 10, 100, 50) },
    ],
  }

  const result = diffTrees(before, after)
  /* null 与 42 归一化成 Unknown 节点，semanticOnly 下被过滤掉，剩两个真节点。 */
  assert.equal(result.summary.beforeNodes, 2)
  assert.equal(result.summary.afterNodes, 2)
  /* 「乙」的 before 缺 bounds：保守报成几何变化，delta 拿不到就给 null。 */
  assert.equal(result.changed.length, 1)
  assert.equal(result.changed[0].kind, 'geometry')
  assert.equal(result.changed[0].boundsChange.delta, null)
  assert.equal(result.unchanged.count, 1)
  assert.equal(result.summary.hasChanges, true)
})

test('nodes 不是数组、整棵树是字符串时退回空结果', () => {
  const cases = [
    [null, { nodes: 'oops' }],
    [{ nodes: null }, { nodes: {} }],
    ['not a tree', 12345],
    [{}, []],
  ]
  for (const [before, after] of cases) {
    const result = diffTrees(before, after)
    assert.equal(result.added.length, 0, JSON.stringify(before))
    assert.equal(result.removed.length, 0)
    assert.equal(result.changed.length, 0)
  }
})

test('直接传节点数组也能比对（省掉 .nodes 一层）', () => {
  const result = diffTrees(loginTree().nodes, loginTree().nodes)
  assert.equal(result.unchanged.count, 4)
  assert.equal(result.frame.before, null)
  assert.equal(result.frame.changed, false)
})

test('重复节点不会互相乱配出多余的新增或消失', () => {
  const repeated = (previous) => ({
    width: 1080,
    height: 2400,
    renderer: 'headless',
    nodes: [
      node({ id: 'n0', type: 'TextView', text: '项目', depth: 3, bounds: box(0, 100, 1080, 180) }),
      node({ id: 'n1', type: 'TextView', text: '项目', depth: 3, bounds: box(0, 200, 1080, 280) }),
      node({ id: previous, type: 'TextView', text: '项目', depth: 3, bounds: box(0, 300, 1080, 380) }),
    ],
  })
  const before = repeated('n2')
  const after = repeated('n9')

  const result = diffTrees(before, after)
  assert.deepEqual(result.added, [])
  assert.deepEqual(result.removed, [])
  assert.equal(result.unchanged.count, 3)
})

test('空字符串文字与没有文字等价，不产生假变化', () => {
  /*
   * 空串必须显式带 hasSemantics：否则 node() 会按「没文字」推断成 false，
   * 节点在 semanticOnly 下先被过滤掉，就测不到「空串 vs 缺失」这件事本身了。
   */
  const withEmptyText = () => {
    const tree = loginTree()
    tree.nodes[0] = node({ id: 'n0', type: 'TextView', text: '', depth: 4, hasSemantics: true, bounds: box(40, 120, 600, 180) })
    return tree
  }
  const withoutTextField = () => {
    const tree = loginTree()
    delete tree.nodes[0].text
    return tree
  }

  assert.equal(diffTrees(withEmptyText(), withoutTextField()).changed.length, 0)
  assert.equal(diffTrees(withoutTextField(), withEmptyText()).changed.length, 0)

  /* 真有文字改成空串时，确实要报出来，after 为 null。 */
  const cleared = diffTrees(loginTree(), withEmptyText())
  assert.equal(cleared.changed.length, 1)
  assert.equal(cleared.changed[0].kind, 'text')
  assert.equal(cleared.changed[0].matchedBy, 'geometry')
  assert.deepEqual(cleared.changed[0].changes, [{ field: 'text', before: '邮箱登录', after: null }])
})

test('不修改传入的 before 与 after', () => {
  const before = loginTree()
  const after = loginTree()
  after.nodes = after.nodes.map((entry, index) => ({ ...entry, id: `q${index}` }))
  after.nodes[3] = node({ id: 'q3', type: 'Button', text: '立即登录', role: 'Button', depth: 6, bounds: box(63, 1200, 1017, 1337) })

  const beforeSnapshot = structuredClone(before)
  const afterSnapshot = structuredClone(after)
  diffTrees(before, after, { minDelta: 2, semanticOnly: false })

  assert.deepEqual(before, beforeSnapshot)
  assert.deepEqual(after, afterSnapshot)
})

test('summary 的计数与各数组长度自洽', () => {
  const before = headlessTree()
  const after = headlessTree()
  after.nodes = [
    after.nodes[0],
    after.nodes[1],
    /* 删掉 Row，改掉标题文字，挪动按钮。 */
    node({ id: 'n2', type: 'TextView', text: '手机号登录', depth: 2, bounds: box(40, 120, 600, 180) }),
    after.nodes[4],
    after.nodes[5],
    after.nodes[6],
    after.nodes[7],
    after.nodes[8],
    after.nodes[9],
    node({ id: 'n10', type: 'Button', text: '登录', role: 'Button', depth: 3, bounds: box(63, 1600, 1017, 1737) }),
  ]

  const result = diffTrees(before, after)
  assert.equal(result.summary.added, result.added.length)
  assert.equal(result.summary.removed, result.removed.length)
  assert.equal(result.summary.changed, result.changed.length)
  assert.equal(result.summary.unchanged, result.unchanged.count)
  assert.equal(
    result.summary.beforeNodes,
    result.added.length + result.removed.length + result.changed.length + result.unchanged.count,
  )
  assert.equal(result.summary.textChanged + result.summary.geometryChanged >= result.changed.length, true)
  assert.equal(result.summary.hasChanges, true)
})

test('画布尺寸与渲染器变化单独标出来', () => {
  const before = loginTree()
  const after = loginTree()
  after.width = 1440
  after.height = 3120

  const resized = diffTrees(before, after)
  assert.equal(resized.frame.sizeChanged, true)
  assert.equal(resized.frame.rendererChanged, false)
  assert.equal(resized.frame.changed, true)
  assert.equal(resized.frame.before.width, 1080)
  assert.equal(resized.frame.after.width, 1440)
  /* 尺寸变了但节点没动时，hasChanges 仍然为真：坐标已经不可比。 */
  assert.equal(resized.changed.length, 0)
  assert.equal(resized.summary.hasChanges, true)

  const switched = diffTrees(loginTree(), { ...loginTree(), renderer: 'headless' })
  assert.equal(switched.frame.rendererChanged, true)
})

test('类型换掉的节点宁可报消失+新增，也不猜成同一个', () => {
  const before = loginTree()
  const after = loginTree()
  /* 第 2 行从 EditText 换成 TextView，位置基本没动。 */
  after.nodes[1] = node({ id: 'n1', type: 'TextView', text: '邮箱地址', depth: 4, bounds: box(40, 240, 1040, 330) })

  const result = diffTrees(before, after)
  assert.equal(result.added.length, 1)
  assert.equal(result.removed.length, 1)
  assert.equal(result.added[0].type, 'TextView')
  assert.equal(result.removed[0].type, 'EditText')
  assert.deepEqual(result.changed, [])
})

test('超大的树走退化配对路径仍然给出稳定结论', () => {
  /* 2101 × 2101 已超过 LCS 表的格子上限，走保序贪心而不是分配 4MB 以上的表。 */
  const build = (offset) => ({
    width: 1080,
    height: 2400,
    renderer: 'headless',
    nodes: Array.from({ length: 2101 }, (_, index) => node({
      id: `n${index}`,
      type: 'TextView',
      text: `第 ${index + offset} 项`,
      depth: 3,
      bounds: box(0, index * 10, 100, index * 10 + 10),
    })),
  })

  const result = diffTrees(build(0), build(0))
  assert.equal(result.unchanged.count, 2101)
  assert.equal(result.summary.hasChanges, false)
})
