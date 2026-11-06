# dsh-plugin-usage-cost

一个本地 DSH bundle：在输入框下方的 dock 上实时显示**当前会话的 token 用量与估算花费（人民币）**，点开看分项（未命中 / 缓存命中 / 缓存写入 / 输出）、堆叠占比条、缓存命中率和轮次/速度。

## 长什么样

- 收起：`● ≈¥0.254 · 10.3M tok`。圆点绿色是空闲价，橙色是高峰价。
- 展开：总价、高峰/空闲标记、当前模型、四段堆叠条、逐项 token 与费用、`4 轮 · 93 步 · 235 tok/s · 模型 2m00s · 工具 30s`。
- 点面板外面任意空白处、按 Esc、或点右上角 × 都能关闭。面板用 portal 挂在 body 上，不会被 composer 裁切。

## 数据来源

三个会话投影，随回合结算自动刷新，没有 RPC：

| 投影 | 用途 |
|---|---|
| `tokenUsage` | 四个计费桶的累计 token |
| `modelSelection` | 会话最近一次请求实际用的模型（`next ?? lastUsed`），价格自动跟随 |
| `sessionStats` | 轮数、步数、解码速度、模型/工具耗时，填面板里的那行 meta |

模型是自动读的，面板里不再有下拉框——只有会话真正用过的那个模型参与计价。

## 价格口径

DeepSeek 官网人民币价目（元 / 百万 tokens），空闲 / 高峰两档：

| 模型 | 缓存命中 | 缓存未命中 | 输出 |
|---|---|---|---|
| deepseek-flash | 0.02 / 0.04 | 1 / 2 | 4 / 8 |
| deepseek-v4-pro | 0.15 / 0.30 | 4.5 / 9.0 | 13.5 / 27.0 |

高峰 = **北京时间**周一至周五 09:00–12:00、14:00–18:00；其余时间（含周末）空闲。中国法定节假日未建模。

**这不是账单**，只是按当前时段单价对累计 token 的估算。模型识别不到时退回 `deepseek-flash` 并在面板底部注明。

改价：改 `lib/client.js` 顶部的 `PRICES`，刷新页面即生效。

## 和内置统计的关系

内置的 `conversation.composer.dock` 统计胶囊（`id: 'stats'`）被本插件用同 id 的空组件覆盖了，所以不会再出现两个 token 读数。轮次/步数/速度被挪进了本插件的面板。

如果哪天内置槽位不再支持按 id 覆盖，重启后会看到两个读数——把 `apply()` 里第一段 `ctx.slots.register(... id: 'stats' ...)` 删掉即可恢复原状。

## 安装状态

已经装进桌面版的 `desktop` profile：

- 包软链到 `~/.dsh/profiles/node_modules/dsh-plugin-usage-cost`
- `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 加入了 `dsh-plugin-usage-cost`
- 同文件 `dependencies` 加了 `file:` 指向本目录
- 原文件备份在 `~/.dsh/profiles/desktop/package.json.bak-usage-cost`

改了 `lib/client.js` 之后需要**重启应用**（客户端 bundle 的版本在宿主启动时登记，页面刷新不一定拿到新内容）。

## 卸载

```sh
cd ~/.dsh/profiles/desktop
cp package.json.bak-usage-cost package.json
rm ~/.dsh/profiles/node_modules/dsh-plugin-usage-cost
```

然后重启应用。

## 结构

```
package.json        dsh.bundle.patch + dsh.client.platform=web
cordis.patch.yml    插入一行 id: usage-cost
lib/index.js        host 半侧：空 apply（只为让行存在）
lib/client.js       浏览器半侧：__ModuleLoader__ + React，挂在 conversation.composer.dock
```

没有构建步骤：客户端 bundle 是手写的 CJS factory，`react` / `react-dom` 由宿主平台的模块表提供。

## 已知限制

- 费用按**当前时段**单价乘累计 token；跨高峰/空闲边界的会话会有偏差。
- 高峰判定不含中国法定节假日。
- 一个会话中途换过模型时，整段历史都按当前模型计价（投影只给最近一次）。
- 面板里不再有内置的「时间与速度」对话框，对应信息合并进了 meta 行。
