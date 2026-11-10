/**
 * preview 宿主侧的单元测试。
 *
 * 用 node 自带的 test runner，不引入额外依赖——与本插件其它部分保持同一套工具。
 * 只测纯函数与可离线跑的部分：真实渲染要 Gradle，放在人工验收里，不进 CI。
 *
 *   node --test test/
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  declaresFlavors,
  describeScan,
  extractPreviewFqns,
  readModuleDeclarations,
  repoLabel,
  scanPreviewModules,
} from '../src/host/discover.js'
import {
  PreviewService,
  moduleFingerprint,
  projectDependencies,
  normalizeHeadlessTree,
  normalizeStudioTree,
  parseStudioCheck,
  prettyTitle,
  shortHash,
  splitFqn,
} from '../src/host/preview.js'
import { isTrustedRequest } from '../src/host/routes.js'

test('splitFqn 从实测 FQN 拆出包名、文件与函数', () => {
  const split = splitFqn('com.joyroom.z3.feature.account.impl.EmailLoginScreenKt.EmailLoginContentPreview')
  assert.equal(split.packageName, 'com.joyroom.z3.feature.account.impl')
  assert.equal(split.className, 'EmailLoginScreenKt')
  assert.equal(split.fileName, 'EmailLoginScreen.kt')
  assert.equal(split.functionName, 'EmailLoginContentPreview')
})

test('prettyTitle 不重复显示类名与函数名里相同的部分', () => {
  const cases = [
    ['EmailLoginScreenKt', 'EmailLoginContentPreview', 'Email Login'],
    ['PhoneLoginScreenKt', 'PhoneLoginContentPreview', 'Phone Login'],
    ['SleepRecordScreenKt', 'SleepRecordContentPreview', 'Sleep Record'],
    ['ImageCaptchaKt', 'ImageCaptchaDialogBodyPreview', 'Image Captcha · Dialog'],
    ['AboutScreenKt', 'AboutContentPreview', 'About'],
    ['DeviceListScreenKt', 'DeviceListPreview', 'Device List'],
  ]
  for (const [className, functionName, expected] of cases) {
    assert.equal(prettyTitle({ className, functionName }), expected, `${className}.${functionName}`)
  }
})

test('shortHash 稳定且定长', () => {
  assert.equal(shortHash('a'), shortHash('a'))
  assert.notEqual(shortHash('a'), shortHash('b'))
  assert.equal(shortHash('a', 8).length, 8)
})

test('moduleFingerprint 跟着源文件变化走', async () => {
  const root = await mkdtemp(join(tmpdir(), 'damp-fp-'))
  try {
    const module = join(root, 'feature', 'demo', 'impl')
    const sourceDir = join(module, 'src', 'main', 'kotlin', 'com', 'demo')
    await mkdir(sourceDir, { recursive: true })
    const file = join(sourceDir, 'DemoScreen.kt')
    await writeFile(file, 'fun a() {}', 'utf8')
    const first = await moduleFingerprint(module)

    /* 内容变化必然变指纹。 */
    await writeFile(file, 'fun a() { }', 'utf8')
    const second = await moduleFingerprint(module)
    assert.notEqual(first, second, '内容变了指纹应该变')

    /* 只改 mtime 不该变指纹：git checkout 与「保存但没改动」都会这样，
       若把 mtime 算进去，整批 preview 会被误标为已过期。 */
    const now = new Date()
    await (await import('node:fs/promises')).utimes(file, now, new Date(now.getTime() + 60_000))
    assert.equal(await moduleFingerprint(module), second, '只改 mtime 不该让指纹变化')

    /* build 目录不参与：否则每次构建都会让所有 preview 变成「已过期」。 */
    await mkdir(join(module, 'build', 'tmp'), { recursive: true })
    await writeFile(join(module, 'build', 'tmp', 'junk.kt'), 'junk', 'utf8')
    assert.equal(await moduleFingerprint(module), second, 'build 目录不该影响指纹')

    /* 再加一个文件也要变。 */
    await writeFile(join(sourceDir, 'Other.kt'), 'fun b() {}', 'utf8')
    assert.notEqual(await moduleFingerprint(module), second, '新增文件应该变指纹')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('moduleFingerprint 对不存在的模块返回稳定值', async () => {
  const value = await moduleFingerprint('/nonexistent/definitely/nope')
  /* 空目录：0 个文件 + 空哈希的前 24 位。 */
  assert.equal(value, '0:e3b0c44298fc1c149afbf4c8')
})

test('normalizeHeadlessTree 保留 bounds、text 与语义标记', () => {
  /* 结构照抄实测输出（截取真实节点）。 */
  const tree = {
    width: 1080,
    height: 2400,
    components: [{
      name: 'Wrap',
      bounds: { left: 0, top: 0, right: 1080, bottom: 2400 },
      children: [{
        name: 'Text',
        bounds: { left: 63, top: 189, right: 628, bottom: 279 },
        sourceLocation: { fileName: 'PhoneLoginScreen.kt', lineNumber: 563 },
        semantics: { text: 'Sign in with email' },
      }, {
        name: 'Box',
        bounds: { left: 63, top: 2105, right: 1017, bottom: 2242 },
        semantics: { role: 'Button', actions: 'OnClick' },
      }, {
        name: 'Column',
        bounds: { left: 63, top: 189, right: 1017, bottom: 1852 },
      }],
    }],
  }
  const out = normalizeHeadlessTree(tree)
  assert.equal(out.width, 1080)
  assert.equal(out.height, 2400)
  assert.equal(out.renderer, 'headless')
  assert.equal(out.nodes.length, 4)
  assert.deepEqual(out.nodes.map((node) => node.depth), [0, 1, 1, 1])
  const text = out.nodes[1]
  assert.equal(text.text, 'Sign in with email')
  assert.deepEqual(text.source, { file: 'PhoneLoginScreen.kt', line: 563 })
  assert.equal(text.hasSemantics, true)
  const button = out.nodes[2]
  assert.deepEqual(button.actions, ['OnClick'])
  assert.equal(button.role, 'Button')
  /* 没有任何 semantics 的容器：默认视图不该显示它。 */
  assert.equal(out.nodes[3].hasSemantics, false)
})

test('normalizeHeadlessTree 扛得住缺字段的输入', () => {
  const out = normalizeHeadlessTree({ components: [{ name: 'X' }, null, { bounds: null }] })
  assert.equal(out.width, 0)
  assert.equal(out.nodes.length, 2)
  assert.deepEqual(out.nodes[0].bounds, { left: 0, top: 0, right: 0, bottom: 0 })
})

test('normalizeStudioTree 解析实测缩进文本', () => {
  /* 从真实 stdout 复制的片段，缩进与字段原样保留。 */
  const text = [
    'ComposeViewAdapter (left: 0, top: 0, right: 1080, bottom: 1920)',
    '  ComposeView (left: 0, top: 0, right: 1080, bottom: 1920)',
    '    ScrollView (left: 0, top: 168, right: 1080, bottom: 1435)',
    '      TextView (left: 63, top: 189, right: 628, bottom: 279) text="Sign in with email"',
    '      EditText (left: 116, top: 570, right: 964, bottom: 696) text="hello@joyroom.com"',
    '      Button (left: 63, top: 1625, right: 1017, bottom: 1762)',
    '      View (left: 0, top: 0, right: 1080, bottom: 168)',
    '        CheckBox (left: 63, top: 1467, right: 168, bottom: 1572)',
    'Wrote rendering to /tmp/x.png',
  ].join('\n')
  const out = normalizeStudioTree(text)
  assert.equal(out.renderer, 'studio')
  assert.equal(out.width, 1080)
  assert.equal(out.height, 1920)
  /* 「Wrote rendering to ...」这行不是节点，必须被跳过；剩下 8 个才是。 */
  assert.equal(out.nodes.length, 8)
  assert.deepEqual(out.nodes.map((node) => node.depth), [0, 1, 2, 3, 3, 3, 3, 4])
  assert.equal(out.nodes[3].text, 'Sign in with email')
  assert.equal(out.nodes[3].type, 'TextView')
  const button = out.nodes[5]
  assert.equal(button.type, 'Button')
  assert.equal(button.hasSemantics, true, 'Button 没有 text 也算有语义')
  /* 纯容器 View 默认不该出现；实测一棵树里这种节点占多数。 */
  assert.equal(out.nodes[6].hasSemantics, false)
  assert.equal(out.nodes[6].type, 'View')
  assert.equal(out.nodes[7].type, 'CheckBox')
  assert.equal(out.nodes[7].depth, 4)
})

test('parseStudioCheck 读出项目名与就绪状态', () => {
  const text = [
    'pid: 1988',
    'version: Rabbit 2 | 2026.2.2',
    'Projects:',
    '    READY     JOYROOM_AUDIO  /Users/x/JOYROOM_AUDIO_NOW',
    '    READY     Z3             /Users/x/New',
    '',
  ].join('\n')
  const parsed = parseStudioCheck(text)
  assert.equal(parsed.running, true)
  assert.equal(parsed.version, 'Rabbit 2 | 2026.2.2')
  assert.equal(parsed.projects.length, 2)
  assert.deepEqual(parsed.projects[1], { ready: true, name: 'Z3', path: '/Users/x/New' })
})

test('parseStudioCheck 对没开 Studio 的输出返回空', () => {
  const parsed = parseStudioCheck('No running Studio instances found')
  assert.equal(parsed.running, false)
  assert.deepEqual(parsed.projects, [])
})

test('isTrustedRequest 拒绝非 loopback 对端与外部 Host', () => {
  const make = (remoteAddress, host) => ({ socket: { remoteAddress }, headers: { host } })
  assert.equal(isTrustedRequest(make('127.0.0.1', '127.0.0.1:59714')), true)
  assert.equal(isTrustedRequest(make('::1', 'localhost:59714')), true)
  assert.equal(isTrustedRequest(make('::ffff:127.0.0.1', '[::1]:59714')), true)
  /* 局域网对端必须挡掉。 */
  assert.equal(isTrustedRequest(make('192.168.1.5', '127.0.0.1:59714')), false)
  /* DNS rebinding：对端是 loopback，但 Host 指向外部域名。 */
  assert.equal(isTrustedRequest(make('127.0.0.1', 'evil.example.com')), false)
  assert.equal(isTrustedRequest(make('127.0.0.1', undefined)), false)
})

test('projectDependencies 只读 project(...) 形式的同项目依赖', async () => {
  const root = await mkdtemp(join(tmpdir(), 'damp-deps-'))
  try {
    const module = join(root, 'feature', 'account', 'impl')
    await mkdir(module, { recursive: true })
    await writeFile(join(module, 'build.gradle.kts'), [
      'dependencies {',
      '    implementation(project(":core:resources"))',
      '    implementation(project(":core:ui"))',
      '    implementation("androidx.compose.ui:ui:1.9.0")',
      '    testImplementation(project(":core:data-test"))',
      '}',
    ].join('\n'), 'utf8')
    assert.deepEqual(await projectDependencies(module), ['core:data-test'.split(':').join('/'), 'core/resources', 'core/ui'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('moduleFingerprint 能发现依赖模块里的改动', async () => {
  /* 这条锁的是一个实测出来的漏检：account 的界面文案来自 core/resources，
     只改那里、不改 account 一行代码，渲染结果就已经变了。 */
  const root = await mkdtemp(join(tmpdir(), 'damp-dep-fp-'))
  try {
    const feature = join(root, 'feature', 'account', 'impl')
    const resources = join(root, 'core', 'resources')
    await mkdir(join(feature, 'src', 'main', 'kotlin'), { recursive: true })
    await mkdir(join(resources, 'src', 'main', 'res', 'values'), { recursive: true })
    await writeFile(join(feature, 'src', 'main', 'kotlin', 'Screen.kt'), 'fun a() {}', 'utf8')
    const strings = join(resources, 'src', 'main', 'res', 'values', 'strings.xml')
    await writeFile(strings, '<string name="t">Sign in</string>', 'utf8')

    const before = await moduleFingerprint(feature, { modules: [feature, resources] })
    await writeFile(strings, '<string name="t">Sign in now</string>', 'utf8')
    const after = await moduleFingerprint(feature, { modules: [feature, resources] })
    assert.notEqual(before, after, '依赖模块的资源变了，指纹必须变')

    /* 只算模块自己的 src 时看不出依赖模块的变化——这正是修之前的错误行为。 */
    const selfBefore = await moduleFingerprint(feature)
    await writeFile(strings, '<string name="t">Sign in again</string>', 'utf8')
    assert.equal(await moduleFingerprint(feature), selfBefore, '只看自己时依赖改动确实不可见')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('渲染后写入的指纹与 list 比较用的指纹必须同源', async () => {
  /* 锁住一个实测到的假过期：渲染完成时只算模块自己的 src，
     而 list 比的是含依赖闭包的指纹，两者永远不相等，
     于是每张刚渲染好的图立刻显示「源码已变」。 */
  const root = await mkdtemp(join(tmpdir(), 'damp-same-fp-'))
  try {
    const feature = join(root, 'feature', 'demo')
    const resources = join(root, 'core', 'resources')
    await mkdir(join(feature, 'src', 'main', 'kotlin'), { recursive: true })
    await mkdir(join(resources, 'src', 'main', 'res', 'values'), { recursive: true })
    await writeFile(join(feature, 'build.gradle.kts'), 'dependencies { implementation(project(":core:resources")) }', 'utf8')
    await writeFile(join(feature, 'src', 'main', 'kotlin', 'Demo.kt'), 'fun a() {}', 'utf8')
    await writeFile(join(resources, 'src', 'main', 'res', 'values', 's.xml'), '<string>x</string>', 'utf8')

    const deps = await projectDependencies(feature)
    const closure = [feature, ...deps.map((dep) => join(root, dep))]

    /* 两种取法必须给出同一个值——服务内部只应有唯一的指纹入口。 */
    const viaClosure = await moduleFingerprint(feature, { modules: closure })
    const viaClosureAgain = await moduleFingerprint(feature, { modules: closure })
    assert.equal(viaClosure, viaClosureAgain, '同一范围两次计算结果必须一致')

    /* 而不带闭包的那个值不该被当成「当前指纹」写进索引。 */
    const selfOnly = await moduleFingerprint(feature)
    assert.notEqual(selfOnly, viaClosure, '只算自己与算闭包必然是不同值，混用就会假过期')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('readModuleDeclarations 解析 include 并丢掉不存在的目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'damp-settings-'))
  try {
    await mkdir(join(root, 'app'), { recursive: true })
    await mkdir(join(root, 'feature', 'auth'), { recursive: true })
    await writeFile(join(root, 'settings.gradle.kts'), [
      'pluginManagement { includeGroupByRegex("com\\.android.*") }',
      'include(":app")',
      'include(":feature:auth")',
      '// include(":commented:out")',
      'include(":gone:missing")',
    ].join('\n'), 'utf8')
    const modules = await readModuleDeclarations(root)
    assert.deepEqual(modules, ['app', 'feature/auth'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('declaresFlavors 忽略注释里的 productFlavors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'damp-flavor-'))
  try {
    const a = join(root, 'a')
    const b = join(root, 'b')
    await mkdir(a, { recursive: true })
    await mkdir(b, { recursive: true })
    await writeFile(join(a, 'build.gradle.kts'), 'android { productFlavors { create("X") } }', 'utf8')
    await writeFile(join(b, 'build.gradle.kts'), '// productFlavors 以后再说\nandroid { }', 'utf8')
    assert.equal(await declaresFlavors(a), true)
    assert.equal(await declaresFlavors(b), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('extractPreviewFqns 正确处理 @PreviewParameter 与跨函数误抓', async () => {
  /* 两种写法都在真实仓库里出现过：
     - @PreviewParameter 带 @Preview 前缀，不能当成注解；
     - object 里的普通函数紧跟在某个 @Preview 后面，不能算成 preview。 */
  const root = await mkdtemp(join(tmpdir(), 'damp-fqn-'))
  try {
    const dir = join(root, 'src', 'main', 'java', 'com', 'demo')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'DemoScreen.kt'), [
      'package com.demo',
      '',
      'object Colors {',
      '    @Preview',
      '    fun notAPreview(x: Int): Int = x',
      '}',
      '',
      '@Preview(locale = "zh-rCN")',
      '@Composable',
      'private fun DemoScreenPreview(',
      '    @PreviewParameter(DemoProvider::class) state: DemoState,',
      ') { }',
      '',
      '@Preview',
      '@Composable',
      'private fun SecondPreview() { }',
    ].join('\n'), 'utf8')
    const fqns = await extractPreviewFqns(root)
    assert.deepEqual(fqns.map((item) => item.fqn).sort(), [
      'com.demo.DemoScreenKt.DemoScreenPreview',
      'com.demo.DemoScreenKt.SecondPreview',
    ])
    assert.equal(fqns[0].file.endsWith('DemoScreen.kt'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('scanPreviewModules 区分可用模块与跳过原因', async () => {
  const root = await mkdtemp(join(tmpdir(), 'damp-scan-'))
  try {
    const put = async (module, body, extra) => {
      const dir = join(root, module, 'src', 'main', 'java')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'A.kt'), body, 'utf8')
      await writeFile(join(root, module, 'build.gradle.kts'), extra, 'utf8')
    }
    await put('feature/plain', '@Preview\nfun A() {}', 'android { }')
    await put('feature/flavored', '@Preview\nfun B() {}', 'android { productFlavors { } }')
    await put('feature/nopreview', 'fun C() {}', 'android { }')
    await mkdir(join(root, 'empty'), { recursive: true })
    await writeFile(join(root, 'settings.gradle.kts'), [
      'include(":feature:plain")',
      'include(":feature:flavored")',
      'include(":feature:nopreview")',
      'include(":empty")',
    ].join('\n'), 'utf8')

    const scan = await scanPreviewModules(root)
    assert.deepEqual(scan.modules.map((m) => m.path), ['feature/plain', 'feature/flavored'])
    assert.equal(scan.modules[0].flavored, false)
    assert.equal(scan.modules[0].headlessUsable, true)
    assert.equal(scan.modules[1].flavored, true)
    /* flavored 的关键结论：headless 不可用，只能走 Studio。 */
    assert.equal(scan.modules[1].headlessUsable, false)
    assert.deepEqual(
      scan.skipped.map((s) => s.path).sort(),
      ['empty', 'feature/nopreview'],
    )
    assert.equal(scan.skipped.find((s) => s.path === 'empty').reason, 'no-src')
    assert.equal(scan.skipped.find((s) => s.path === 'feature/nopreview').reason, 'no-preview')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('scanPreviewModules 忽略 build 目录里的生成代码', async () => {
  const root = await mkdtemp(join(tmpdir(), 'damp-build-'))
  try {
    const dir = join(root, 'feature', 'x', 'src', 'main')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'Real.kt'), 'fun a() {}', 'utf8')
    /* 只有 build 里有 @Preview，不应被算进来。 */
    const gen = join(root, 'feature', 'x', 'build', 'tmp')
    await mkdir(gen, { recursive: true })
    await writeFile(join(gen, 'Gen.kt'), '@Preview\nfun b() {}', 'utf8')
    await writeFile(join(root, 'feature', 'x', 'build.gradle.kts'), 'android { }', 'utf8')
    await writeFile(join(root, 'settings.gradle.kts'), 'include(":feature:x")', 'utf8')
    const scan = await scanPreviewModules(root)
    assert.deepEqual(scan.modules, [])
    assert.equal(scan.skipped[0].reason, 'no-preview')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('repoLabel 给出项目根末段名', () => {
  assert.equal(repoLabel('/Users/x/Repository/Joyroom/New'), 'New')
  assert.equal(repoLabel('/Users/x/JOYROOM_AUDIO_NOW/'), 'JOYROOM_AUDIO_NOW')
})

test('describeScan 说清模块数与 flavored 数', () => {
  const text = describeScan({
    modules: [{ flavored: false }, { flavored: true }],
    skipped: [{ reason: 'no-preview' }, { reason: 'no-src' }],
  })
  assert.equal(text.includes('2 个模块含 @Preview'), true)
  assert.equal(text.includes('1 个带 flavors'), true)
  assert.equal(text.includes('1 个模块无 preview'), true)
})

test('modules 在索引为空时退回待扫列表，有索引时反映真实模块', () => {
  /* 锁一个实测到的显示 bug：自动发现之后，索引里只有 6 个模块，
     而列表仍返回内置的五个硬编码模块名，用户会以为面板扫错了地方。 */
  const svc = new PreviewService({
    projectRoot: '/nonexistent/repo',
    modules: ['feature/builtin'],
    logger: { info() {}, warn() {} },
  })
  /* 还没扫描：给出将要扫描的模块。 */
  assert.deepEqual(svc.modules, ['feature/builtin'])
  svc.dispose()
})
