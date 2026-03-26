#!/usr/bin/env bash
# 本地打包前：确保工作区与 origin/main 一致且无脏文件；并写入 desktop/.git-build-sha 供运行时日志使用。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

mkdir -p "$ROOT/desktop"

if [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "⚙️ CI 环境：跳过与 origin/main 的本地对齐检查（以 Actions checkout 为准）"
  echo "${GITHUB_SHA:-$(git rev-parse HEAD)}" > "$ROOT/desktop/.git-build-sha"
  echo "✅ 已写入 desktop/.git-build-sha"
  exit 0
fi

if [ "${SKIP_GIT_SYNC_CHECK:-}" = "1" ]; then
  echo "⚠️ 已跳过 Git 同步检查 (SKIP_GIT_SYNC_CHECK=1)"
  git rev-parse HEAD > "$ROOT/desktop/.git-build-sha" 2>/dev/null || echo "local" > "$ROOT/desktop/.git-build-sha"
  exit 0
fi

echo "🔍 检查 Git 同步状态..."
git fetch origin

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "❌ 本地代码未与 origin/main 对齐"
  echo "   LOCAL : $LOCAL"
  echo "   REMOTE: $REMOTE"
  echo "请先执行：git pull origin main 或 git push（并确认已 fetch）"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "❌ 存在未提交或未跟踪的变更，禁止构建桌面包"
  git status --short
  echo "请先提交或贮藏变更；临时跳过可设 SKIP_GIT_SYNC_CHECK=1（不推荐）"
  exit 1
fi

echo "$LOCAL" > "$ROOT/desktop/.git-build-sha"
echo "✅ 本地与 GitHub origin/main 已同步，且工作区干净"
echo "✅ 已写入 desktop/.git-build-sha"
