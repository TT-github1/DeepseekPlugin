#!/bin/bash
# 一键回滚：把 desktop profile 恢复到没有 dsh-prompt-bank 的状态。
#
# 只动三样东西，全部可逆：
#   1. profile package.json 里的 dependencies 条目
#   2. profile package.json 里的 bundles 列表项
#   3. node_modules/dsh-prompt-bank 目录
# 不碰其它任何插件、不碰 ~/.dsh 下的会话、技能、凭据。
#
# 用法：bash rollback.sh
set -euo pipefail

P="$HOME/.dsh/profiles/desktop"

python3 - "$P" <<'PY'
import json, sys
p = sys.argv[1] + '/package.json'
d = json.load(open(p))
deps = d.get('dependencies', {})
removed_dep = deps.pop('dsh-prompt-bank', None) is not None
bundles = d['dsh']['profile']['bundles']
before = len(bundles)
d['dsh']['profile']['bundles'] = [b for b in bundles if b != 'dsh-prompt-bank']
removed_bundle = len(d['dsh']['profile']['bundles']) != before
json.dump(d, open(p, 'w'), indent=2, ensure_ascii=False)
print('dependencies 条目已移除:', removed_dep)
print('bundles 条目已移除:', removed_bundle)
PY

rm -rf "$P/node_modules/dsh-prompt-bank"
echo "已移除安装副本。"

echo
echo "回滚完成。重启 DSH 即回到安装前状态。"
echo "源码目录仍保留：$HOME/Repository/DeepSeek/dsh-prompt-bank"
