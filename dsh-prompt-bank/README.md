# dsh-prompt-bank

DSH 提示词库：在输入框左侧加一个按钮，点开面板就能把预存的提示词插入当前草稿。

## 为什么做这个

DSH 自带「计划模式」这类功能，粒度是会话级状态机。日常更常见的需求是另一种：
**同一段话反复输入**（"只评审不要改代码"、"先分析再动手"），或者**不同场景附加不同提示词**。
计划模式解决不了，每次复制粘贴又太麻烦。本插件把这个动作变成"点一下"。

## 怎么用

1. 输入框左下角（`+` 附件按钮旁）多一个**文档图标**，点开是提示词库面板。
2. 面板里：搜索框 + 分组标签 + 条目列表。
3. **点条目 → 追加到草稿**；**按住 Shift 点 → 替换草稿**。
4. 每条右侧：`☆` 置顶 / `✎` 编辑。顶部「新建」进入编辑视图，编辑视图可删除。
5. 数据存在本插件 profile 条目的 `library` 字段里，走官方 settings 服务，不额外写文件。

## 架构

| 半侧 | 文件 | 职责 |
|---|---|---|
| Host | `lib/index.js` | 只导出 `Config`（schemastery schema），让 `library` 成为可写的 volatile 字段 |
| Client | `client.js` | 插槽按钮、面板 UI、增删改查、插入草稿 |

**Host 侧为什么必须有 `Config`**：客户端用 `ctx.configForms.get('dsh-prompt-bank')` 拿 form，
再 `form.set('library', json)` 落盘。宿主只对**声明了 Config schema 的条目**投影出可写字段；
没有 schema，写入会被拒绝，面板永远读到空库。这是最初版本最大的缺口。

**`library` 为什么用 `.volatile()`**：改一条提示词不该重挂插件（会丢面板状态、抖动输入框）。
volatile 字段原地更新、即时生效。

**插入用什么 API**：slot props 里的 `inputActions.insertText(text, span)`，
span 由 `inputActions.captureInsertion()` 在打开面板时抓取。`insertText` 返回 `false`
表示草稿在此期间被改过——此时不硬插入，保留待插文本让用户确认，避免覆盖已输入内容。

## 安装方式（重要）

**必须用 `file:` 协议，不能用 `link:`。**

```bash
# 在 DSH 里执行：
plugin_manager(action="install_bundle", target="/Users/hetianfu/Repository/DeepSeek/dsh-prompt-bank")
```

`install_bundle` 默认用 `link:`。link 方式下 Node 按**真实路径**解析模块，
插件目录在仓库里、解析不到 profile 提供的 `peerDependency: @deepseek-ai/schemastery`，
**host 侧会在 import 期直接崩掉，插件静默不激活**。

改法：把 profile `package.json` 里的依赖声明从 `link:` 改成 `file:`，再 `pnpm install`。
`file:` 会生成独立副本（内部用**硬链接**指向源码），既能解析 peer 依赖，
改源码又即时生效——不用重新安装。

`bash sync.sh` 可随时自检：语法、JSON、硬链接是否生效、host 入口能否真正加载。

## 卸载

```bash
bash rollback.sh
```

只移除 package.json 里的依赖与 bundles 条目、以及 node_modules 副本；
不碰其他插件、会话、技能、凭据。源码目录保留。

## 排错清单（都踩过）

| 症状 | 真因 | 修法 |
|---|---|---|
| 面板永远显示空库，加进去的提示词"没存住" | host 侧没导出 `Config`，`configForms` 不投影出可写字段，写入被拒 | `lib/index.js` 导出 schemastery schema，`library` 用 `.volatile()` |
| 插件装上了但完全不激活，界面没按钮 | 用 `link:` 安装，Node 按真实路径解析，找不到 profile 的 peer dep | 改 `file:` 协议重新安装 |
| 深色主题下面板是白底黑字，和宿主割裂 | CSS 用了不存在的变量名（`--dsw-alias-text-primary` 之类），全靠 fallback 硬撑 | 只用 `Theme.listTokens` 里真实存在的 8 个 token |
| 改完源码没生效 | 编辑器保存会切断 pnpm 的硬链接，安装副本停在旧内容 | 每次改完跑 `bash sync.sh` |

排查顺序：先 `cordis_inspect_query(host, Config, listConfigs, name="dsh-prompt-bank")` 看条目在不在，
再 `cordis_inspect_query(client, Slots, listSubTree, root="conversation.input.left")` 看
`dsh-prompt-bank.trigger` 有没有进 occupants 且 `active: true`。

## 验证状态

已确认（`2026-11-05`，重启后实测）：

- Host 侧条目激活：`Config.listConfigs(name="dsh-prompt-bank")` → `status: "schema"`
- 插槽注册：`conversation.input.left` 的 occupants 里有 `dsh-prompt-bank.trigger`，`active: true`
- 模块加载：模拟 `__ModuleLoader__` 后 `id` / `inject` / `apply` 均正确
- `apply` 调用序列：样式 → configForms.get → zh 字典(28) → en 字典(28) → 插槽注册，字段无误
- 数据链路：`plainConfig` 会递归解包 volatile，客户端读到的 `library` 是纯字符串
- 纯函数：往返解析、坏 JSON 收敛为空库、过滤均通过

**未验证**：浏览器里的实际渲染效果（面板长什么样、点击是否顺手、深色主题下的观感）。
这需要人眼看，我没有浏览器控制权，也没做 mock 截图冒充验证。

## 已知边界

- 面板用绝对定位挂在按钮上（`conversation.input.left` 是 list 槽，宿主会裁剪），
  所以是贴近输入框的浮层，不是全局弹窗。想改成 portal 到 body 也能做，但需要自己算坐标。
- 插入位置以打开面板时的光标为准；面板期间改动草稿会走"冲突提示"分支，不会静默覆盖。
- 条目正文不做长度限制，超大文本（几十 KB）会让 `library` 字段很大；
  日常使用不受影响，真要存整篇长文建议用文件 + `@` 引用。
