#!/usr/bin/env bash
# 同步递增三端版本号（backend / frontend / desktop）到同一个值。
#
# 为什么三端要一致：版本号是整个系统的统一标识。后端 /health、桌面端关于页、
# 桌面自动更新(latest.json) 都各读各自 package.json 的 version；三端不一致会让
# 线上排查“到底跑的哪一版”变得混乱。desktop/package.json 还是 git tag 的唯一来源
# （release-desktop-tag.sh 据它生成 v<version>），所以它必须准确。
#
# 用法: bash bump-version.sh <version>     例: bash bump-version.sh 0.4.8
set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "用法: bash bump-version.sh <version>   例: 0.4.8" >&2
  exit 1
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌ 版本号格式应为 x.y.z（如 0.4.8）" >&2
  exit 1
fi

# 定位仓库根：脚本在 .claude/skills/release-flowcube/scripts/ 下，但发布要在项目根跑。
# 优先用当前工作目录（应为项目根），校验三端目录存在。
ROOT="$(pwd)"
for d in backend frontend desktop; do
  if [[ ! -f "$ROOT/$d/package.json" ]]; then
    echo "❌ 找不到 $d/package.json —— 请在 flowcube 项目根目录运行本脚本" >&2
    exit 1
  fi
done

echo "将三端版本统一设为: $VERSION"
for d in backend frontend desktop; do
  ( cd "$ROOT/$d" && npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null )
  echo "  ✓ $d -> $(node -p "require('$ROOT/$d/package.json').version")"
done

echo "完成。三端 package.json 与 package-lock 已更新（尚未 commit）。"
