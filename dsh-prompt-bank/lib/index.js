/**
 * dsh-prompt-bank — Host 半
 *
 * 能力全在浏览器侧（插槽按钮、面板、草稿插入）。Host 侧要做的事只有一件：
 * 把 `Config` 交给宿主 Loader，让 profile 条目里的 `library` 字段成为可被
 * `configForms` 读写的 volatile 字段。
 *
 * 为什么必须有 Config：客户端用 `ctx.configForms.get(NAMESPACE)` 拿到 form，
 * 再 `form.set(field, value)` 落盘。宿主只对「声明了 Config schema 的条目」投影
 * 出可写的 volatile 字段；没有 schema，写入会被拒绝，面板永远读不到数据。
 *
 * `library` 用 `.volatile()`：增删改一条提示词不该重挂插件（重挂会丢面板状态、
 * 抖动输入框），volatile 字段原地更新、即时生效。
 */
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-prompt-bank'

/**
 * schemastery 的 `.volatile()` 是 ≥3.18.3 的能力。宿主内置更旧版本时，加载期直接
 * 调用会在 import 期抛 TypeError，导致整个插件加载失败。这里做特性探测：不支持时
 * 退化为普通字段——功能仍可用，只是保存后需要重挂插件才读到新值。
 */
export const VOLATILE_SUPPORTED = typeof z?.string?.()?.volatile === 'function'

/**
 * 对 schema 字段应用 `.volatile()`（宿主支持时）。
 * @param {unknown} field - 待修饰的 schema 字段。
 * @returns {unknown} 修饰后或原样的字段。
 */
function applyVolatile(field) {
  return typeof field?.volatile === 'function' ? field.volatile() : field
}

/**
 * 宿主 Loader 解析 profile patch 中本条目 config 所用的 schema。
 *
 * `library` 存整库 JSON 字符串（`{"version":1,"items":[...]}`），空串表示空库。
 * 选字符串而不选结构化对象：schema 校验只需管「是不是字符串」，库里条目的形状
 * 由客户端 `parseLibrary` 收敛（坏数据退化为空数组，不会打哑面板）。
 */
export const Config = z.object({
  library: applyVolatile(z.string().default('')),
})

/**
 * 无 Host 侧行为：按钮、面板、草稿插入都在 client 半侧。
 *
 * 保留 apply 是因为宿主 Loader 需要一个显式入口。
 */
export function apply() {}
