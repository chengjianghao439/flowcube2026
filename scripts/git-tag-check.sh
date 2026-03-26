#!/usr/bin/env bash
# 打 tag 前：HEAD 须与 origin/main 一致，且工作区干净（避免 tag 落在旧提交或未推送改动上）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "⚙️ CI 环境：跳过本地 tag 前置检查"
  exit 0
fi

if [ "${SKIP_TAG_CHECK:-}" = "1" ]; then
  echo "⚠️ 已跳过 tag 检查 (SKIP_TAG_CHECK=1)"
  exit 0
fi

echo "🔍 检查 tag 是否指向最新 commit..."
git fetch origin

HEAD_COMMIT=$(git rev-parse HEAD)
REMOTE_COMMIT=$(git rev-parse origin/main)

if [ "$HEAD_COMMIT" != "$REMOTE_COMMIT" ]; then
  echo "❌ 当前 HEAD 不是 origin/main 最新 commit"
  echo "   HEAD : $HEAD_COMMIT"
  echo "   main : $REMOTE_COMMIT"
  echo "禁止打 tag。请先 git pull / git push 对齐。"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "❌ 工作区有未提交变更，禁止打 tag"
  git status --short
  exit 1
fi

echo "✅ tag 可基于当前最新 commit（与 origin/main 一致且工作区干净）"
