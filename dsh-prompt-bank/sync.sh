#!/bin/bash
# 把源码同步进 desktop profile 的安装副本，并自检。
#
# 为什么会有「同步」这一步：本插件用 file: 协议安装（而不是 link:），因为 link
# 方式下 Node 按真实路径解析模块，插件目录里解析不到 profile 提供的
# peerDependency @deepseek-ai/schemastery，host 侧会在 import 期直接崩掉。
#
# pnpm 初次安装时对包内文件建的是硬链接，改源码本应即时生效；但编辑器/工具
# 常以「写临时文件再 rename」的方式保存，这会切断硬链接，安装副本停在旧内容。
# 所以每次改完源码都跑一遍这个脚本，别指望硬链接自己保住。
#
# 用法：bash sync.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DST="$HOME/.dsh/profiles/desktop/node_modules/dsh-prompt-bank"

if [ ! -d "$DST" ]; then
  echo "未找到安装副本：$DST" >&2
  echo "请先在 DSH 里运行 plugin_manager install_bundle（target 为本目录）。" >&2
  exit 1
fi

# 1. 先自检源码，别把坏文件推过去。
node --check "$SRC/client.js"
node --check "$SRC/lib/index.js"
for f in package.json locale/zh.json locale/en.json; do
  python3 -c "import json; json.load(open('$SRC/$f'))" || { echo "$f 不是合法 JSON" >&2; exit 1; }
done

# 2. 同步运行时文件。-f 吞掉「相同文件」在部分平台上的非零退出码。
mkdir -p "$DST/lib" "$DST/locale"
for f in client.js package.json cordis.patch.yml icon.svg lib/index.js locale/zh.json locale/en.json README.md; do
  cp -f "$SRC/$f" "$DST/$f" 2>/dev/null || true
done

# 3. 逐项比对，真正确认副本已经是最新。
stale=0
for f in client.js lib/index.js package.json cordis.patch.yml icon.svg locale/zh.json locale/en.json; do
  if ! diff -q "$SRC/$f" "$DST/$f" >/dev/null 2>&1; then
    echo "仍不一致：$f" >&2
    stale=1
  fi
done
[ "$stale" -eq 0 ] && echo "安装副本已是最新。"

# 4. 验证 host 入口能在副本目录里真正加载——能抓住 peer 依赖解析失败。
( cd "$DST" && node --input-type=module -e "import('./lib/index.js').then(m => { if (m.Config === undefined) throw new Error('Config 未导出'); console.log('host 入口加载 OK，volatile:', m.VOLATILE_SUPPORTED) })" )

echo "自检通过。"
