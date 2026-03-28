#!/usr/bin/env bash
# 将 main 与标签同步到 Gitee（远程名默认为 gitee）
#
# 前置条件之一：
#   • HTTPS：git config credential.helper 已配置，或推送时输入 Gitee 用户名/密码（或私人令牌作密码）
#   • SSH：git remote set-url gitee git@gitee.com:<namespace>/flowcube2026.git 且已在 Gitee 添加公钥
#
# 用法：bash scripts/sync-to-gitee.sh [remote_name]
set -euo pipefail

REMOTE="${1:-gitee}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! git remote get-url "$REMOTE" &>/dev/null; then
  echo "未找到 git remote: $REMOTE"
  echo "添加示例: git remote add gitee https://gitee.com/chengjianghao/flowcube2026.git"
  exit 1
fi

echo "=== git push $REMOTE main ==="
git push "$REMOTE" main

echo "=== git push $REMOTE --tags ==="
git push "$REMOTE" --tags

echo "=== 完成。请在 Gitee 仓库页确认提交与标签（如 v0.3.41）已更新 ==="
