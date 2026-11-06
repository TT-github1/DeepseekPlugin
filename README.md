# DSH 插件合集

我自己写的 DeepSeek Harness 插件。每个子目录是一个独立的 npm 包，通过 DSH profile 的
`file:` / `link:` 依赖挂载。

## 插件

| 目录 | 包名 | 说明 |
|---|---|---|
| `dsh-plugin-usage-cost/` | `dsh-plugin-usage-cost` | 输入框 dock 上实时显示 token 用量与估算花费 |
| `dsh-android-mirror-pane/` | `dsh-android-mirror-pane` | 右侧栏 Android 投屏与操控面板 |
| `dsh-prompt-bank/` | `dsh-prompt-bank` | 输入框左侧提示词库，点一下插入草稿 |
| `quick-explain/` | `@local/quick-explain` | 选中文本右键就地解释 |

## 换电脑后怎么恢复

### 1. 克隆本仓库

```bash
git clone <本仓库地址> ~/Repository/DeepseekPlugin
```

### 2. 逐个安装依赖

每个插件目录都声明了自己的 `dependencies`，需要各自装一次：

```bash
cd ~/Repository/DeepseekPlugin
for d in dsh-plugin-usage-cost dsh-android-mirror-pane dsh-prompt-bank quick-explain; do
  (cd "$d" && npm install)
done
```

> **为什么必须装：** DSH 用 Node 原生 ESM 加载插件，`@deepseek-ai/*`
> 这类包不会自动从 DSH 主程序里借到，必须能被插件自己的
> `node_modules` 解析到，否则插件加载时会直接报
> `Cannot find package '@deepseek-ai/dsh-tools'` 而静默失效。

### 3. 挂到 DSH profile

编辑 `~/.dsh/profiles/desktop/package.json`，在 `dependencies` 里指向本地路径：

```json
{
  "dependencies": {
    "dsh-plugin-usage-cost": "file:/Users/<你>/Repository/DeepseekPlugin/dsh-plugin-usage-cost",
    "dsh-android-mirror-pane": "file:/Users/<你>/Repository/DeepseekPlugin/dsh-android-mirror-pane",
    "dsh-prompt-bank": "file:/Users/<你>/Repository/DeepseekPlugin/dsh-prompt-bank",
    "@local/quick-explain": "link:/Users/<你>/Repository/DeepseekPlugin/quick-explain"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-plugin-usage-cost",
        "dsh-android-mirror-pane",
        "dsh-prompt-bank",
        "@local/quick-explain"
      ]
    }
  }
}
```

`bundles` 列表决定哪些插件真正被加载，缺了不会生效。

### 4. 重启 DSH

## 排查：插件不生效

按顺序检查：

1. **依赖装了吗** —— 插件目录下有没有 `node_modules/@deepseek-ai/`
2. **在 bundles 里吗** —— `package.json` 的 `dsh.profile.bundles`
3. **真的能加载吗** —— 用真实环境测，普通的 `node` 测不出问题：

   ```bash
   cd ~/.dsh/profiles/desktop
   ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
     --input-type=module -e "import('dsh-android-mirror-pane').then(m=>console.log('ok',Object.keys(m))).catch(e=>console.log('fail',e.message))"
   ```

   > 这一步必须用 Electron 跑。DSH 是 Electron 应用，普通
   > `node` 读不到 `app.asar` 里的 `@deepseek-ai/*`，会给出误报。

## 注意

- `node_modules/` 不纳入版本控制（见 `.gitignore`）。
- `dsh-android-mirror-pane/vendor/scrcpy-server` 是二进制文件，有意保留在仓库里。
