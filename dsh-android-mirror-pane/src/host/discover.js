/**
 * 自动发现「这个仓库里哪些模块写有 @Preview」。
 *
 * 为什么要这一层：早先的模块列表是照着一个仓库写死的五个路径，
 * 换到另一个安卓仓库就扫出 0 条、还不报错——这是最糟的失败方式。
 * 而全量跑 `android preview list` 实测 3 秒/模块，28 个模块要 90 秒，
 * 面板不可能这么等。
 *
 * 所以这里做两件便宜的事：
 *
 * 1. 从 `settings.gradle.kts` 读模块声明（正则，零成本）；
 * 2. 只在模块的 `src` 里扫一遍 `.kt` 找 `@Preview`（实测 40–63 毫秒）；
 *
 * 同时顺带判定模块是否声明了 `productFlavors`。这一点很关键：
 * 实测有 flavors 的模块，headless 的 `android preview render` 必然失败
 * （它硬编码找 `debug` 变体，而实际变体叫 `StandardDebug`），
 * 但 Studio 路径能正常渲染。所以要把这个事实提前标出来，
 * 而不是让用户看到一个含糊的 `Runfiles command failed`。
 *
 * @module dsh-android-mirror-pane/discover
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

/**
 * 从 `settings.gradle.kts` 解析出模块声明。
 *
 * 支持两种写法（实测两个仓库都在用第一种）：
 *   include(":feature:account:impl")
 *   include(":app")
 *
 * 刻意不解析 `includeBuild(...)`：那是复合构建，不是本仓库的模块。
 *
 * @param {string} projectRoot
 * @returns {Promise<string[]>} 模块路径，形如 `feature/account/impl`。
 */
export async function readModuleDeclarations(projectRoot) {
  for (const name of ['settings.gradle.kts', 'settings.gradle']) {
    let text
    try {
      text = await readFile(join(projectRoot, name), 'utf8')
    } catch {
      continue
    }
    const modules = []
    const re = /include\(\s*["'](:[^"']+)["']\s*\)/g
    for (;;) {
      const match = re.exec(text)
      if (match === null) break
      const path = match[1].slice(1).split(':').join('/')
      if (path.length > 0) modules.push(path)
    }
    /* 注释掉的 include 会被上面的正则一起抓到，用存在性兜底过滤。 */
    return modules.filter((module) => existsSync(join(projectRoot, module)))
  }
  return []
}

/**
 * 递归扫一个目录下所有 `.kt`，判断有没有 `@Preview`。
 *
 * 跳过 `build`、`.gradle` 与隐藏目录：生成的代码里可能有 `@Preview`，
 * 但那是构建产物，渲染它没有意义。
 *
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
async function hasPreviewAnnotation(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'build') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (await hasPreviewAnnotation(full)) return true
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.kt')) continue
    try {
      const text = await readFile(full, 'utf8')
      /* 只在确有 @Preview 时才算；注释里的 @Preview 会多扫一个模块，
         代价是多几次 CLI 调用，但不影响正确性。 */
      if (text.includes('@Preview')) return true
    } catch {
      /* 读不了就跳过这一个文件。 */
    }
  }
  return false
}

/**
 * 某模块的构建脚本里是否声明了 productFlavors。
 *
 * @param {string} moduleDir
 * @returns {Promise<boolean>}
 */
export async function declaresFlavors(moduleDir) {
  for (const name of ['build.gradle.kts', 'build.gradle']) {
    try {
      const text = await readFile(join(moduleDir, name), 'utf8')
      /* 注释掉的行不算，但这类误判只会让模块被误标为「需 Studio」，
         方向是保守的，不会导致「以为能扫其实扫不了」。 */
      const active = text
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//'))
        .join('\n')
      if (active.includes('productFlavors')) return true
    } catch {
      /* 没有这个文件就试下一个。 */
    }
  }
  return false
}

/**
 * 扫描整个仓库，找出写有 @Preview 的模块。
 *
 * 返回里区分 `modules`（可用）与 `skipped`（跳过及原因），
 * 面板要能把「为什么某个模块没出现」说清楚，否则用户只会觉得面板坏了。
 *
 * @param {string} projectRoot
 * @param {{ includeFlavored?: boolean }} [options]
 * @returns {Promise<{
 *   projectRoot: string,
 *   modules: { path: string, flavored: boolean, headlessUsable: boolean }[],
 *   skipped: { path: string, reason: 'no-src' | 'no-preview' }[],
 *   durationMs: number,
 * }>}
 */
export async function scanPreviewModules(projectRoot, options = {}) {
  const startedAt = Date.now()
  const declared = await readModuleDeclarations(projectRoot)
  const modules = []
  const skipped = []

  for (const path of declared) {
    const moduleDir = join(projectRoot, path)
    const sourceRoot = join(moduleDir, 'src')
    if (!existsSync(sourceRoot)) {
      skipped.push({ path, reason: 'no-src' })
      continue
    }
    if (!(await hasPreviewAnnotation(sourceRoot))) {
      skipped.push({ path, reason: 'no-preview' })
      continue
    }
    const flavored = await declaresFlavors(moduleDir)
    modules.push({
      path,
      flavored,
      /* 有 flavors 时 headless 的 render 必然失败，只能走 Studio。
         这个标记决定后面要不要白跑一次 Gradle。 */
      headlessUsable: !flavored,
    })
  }

  return {
    projectRoot,
    modules,
    skipped,
    durationMs: Date.now() - startedAt,
  }
}

/**
 * 说人话地描述一次扫描结果，供日志与面板提示用。
 * @param {{ modules: object[], skipped: object[] }} scan
 * @returns {string}
 */
export function describeScan(scan) {
  const previews = scan.modules.length
  const flavored = scan.modules.filter((module) => module.flavored).length
  const parts = [`${previews} 个模块含 @Preview`]
  if (flavored > 0) parts.push(`其中 ${flavored} 个带 flavors（只能走 Studio）`)
  const noPreview = scan.skipped.filter((item) => item.reason === 'no-preview').length
  if (noPreview > 0) parts.push(`${noPreview} 个模块无 preview`)
  return parts.join('，')
}

/**
 * 相对项目根的短名，用于面板顶部显示「当前仓库」。
 * @param {string} projectRoot
 * @returns {string}
 */
export function repoLabel(projectRoot) {
  const name = projectRoot.split(/[\\/]/).filter((part) => part.length > 0).pop()
  return name ?? relative('/', projectRoot)
}

/**
 * 从源码里提取 `@Preview` 函数的 FQN。
 *
 * 为什么不用 `android preview list` 来枚举：实测它只对**无 flavors** 的模块
 * 可用，有 flavors 的模块会直接失败（变体名被硬编码成 `debug`）。
 * 而 flavored 模块恰恰是 preview 最集中的地方（实测某仓库 42/66 都在里面）。
 * 所以清单必须能离线从源码算出来，否则那部分模块永远列不出来。
 *
 * 准确性：用 CLI 的权威结果校验过三个模块（8/8、8/8、1/1 完全一致）。
 * 判定规则刻意保守——宁可少列，不要列出点了却渲染不了的东西。
 *
 * 容易误抓的两种写法及其处理：
 * - `@PreviewParameter(...)` 里有 `@Preview` 前缀 → 先替换掉；
 * - `@Preview` 之后隔着一个普通函数（如 object 里的工具函数）才是 `fun`
 *   → 要求两者之间只出现注解，不出现 `val`/`class`/`object` 或函数体。
 *
 * @param {string} moduleDir - 模块绝对路径。
 * @returns {Promise<{ fqn: string, file: string, functionName: string }[]>}
 */
export async function extractPreviewFqns(moduleDir) {
  const results = []
  const seen = new Set()
  const walk = async (dir) => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'build') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.kt')) continue
      let source
      try {
        source = await readFile(full, 'utf8')
      } catch {
        continue
      }
      if (!source.includes('@Preview')) continue
      /* `@PreviewParameter` 含 `@Preview` 前缀，先换掉避免误判。 */
      const clean = source.replaceAll('@PreviewParameter', '@_PP')
      if (!clean.includes('@Preview')) continue
      const packageMatch = /^\s*package\s+([\w.]+)/m.exec(source)
      const packageName = packageMatch === null ? '' : packageMatch[1]
      /* Kotlin 顶层函数编译后落在 `<文件名>Kt` 类里，FQN 必须带这个后缀。 */
      const className = `${entry.name.slice(0, -3)}Kt`
      const re = /@Preview\b/g
      for (;;) {
        const match = re.exec(clean)
        if (match === null) break
        const rest = clean.slice(match.index, match.index + 1200)
        const funMatch = /\bfun\s+([A-Za-z0-9_]+)\s*\(/.exec(rest)
        if (funMatch === null) continue
        const between = rest.slice(0, funMatch.index)
        /* 中间夹了普通声明，说明这个 @Preview 之后的 fun 不是它的函数。 */
        if (/(?<![@\w])(?:val|var|class|object)\s+\w+/.test(between)) continue
        /* 中间已经出现函数体开括号，说明跨过了上一个函数。 */
        if (/\{\s*\n/.test(between)) continue
        /* `@Preview` 出现在某个函数体内部（如 object 里的成员函数前），
           说明它不是在声明一个顶层 preview 函数。判据是它前面的括号深度：
           只有位于声明层（深度 0）的 @Preview 才算数。 */
        const before = clean.slice(0, match.index)
        let depth = 0
        for (const char of before) {
          if (char === '{') depth += 1
          else if (char === '}') depth = Math.max(0, depth - 1)
        }
        if (depth > 0) continue
        const fqn = packageName.length > 0
          ? `${packageName}.${className}.${funMatch[1]}`
          : `${className}.${funMatch[1]}`
        if (seen.has(fqn)) continue
        seen.add(fqn)
        results.push({
          fqn,
          file: relative(moduleDir, full),
          functionName: funMatch[1],
        })
      }
    }
  }
  await walk(join(moduleDir, 'src'))
  return results.sort((a, b) => (a.fqn < b.fqn ? -1 : a.fqn > b.fqn ? 1 : 0))
}
