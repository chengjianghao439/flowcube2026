#!/usr/bin/env bash
# 统一正式发布入口：
# 1. push main -> 触发浏览器端/服务器自动部署
# 2. 同 SHA 的检查、浏览器及 PDA 完成后 push desktop tag
# 3. 等待桌面 tag 发布并核对线上三端版本
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 缺少 node，无法读取部署配置"
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "❌ 当前分支不是 main：$CURRENT_BRANCH"
  echo "请先切到 main 并确认需要发布的提交已在 main 上。"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "❌ 工作区有未提交变更，拒绝正式发布"
  git status --short
  exit 1
fi

DEPLOY_HOST="$(node scripts/read-deploy-config.js server.host)"
DEPLOY_APP_PATH="$(node scripts/read-deploy-config.js server.appPath)"
ERP_ORIGIN="$(node scripts/read-deploy-config.js erpOrigin)"
VERSION="$(node -p "require('./desktop/package.json').version")"
TAG="v${VERSION}"

echo "==> 生产环境：$DEPLOY_HOST"
echo "==> 服务器目录：$DEPLOY_APP_PATH"
echo "==> 浏览器地址：$ERP_ORIGIN"
echo "==> 发布版本：$VERSION ($TAG)"

# 推送前验证 GitHub API 访问能力；token 只在环境中传递，不打印。
command -v gh >/dev/null 2>&1 || { echo '!! 缺少 gh，无法等待完整发布结果'; exit 1; }
GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token)}"
export GITHUB_TOKEN
[ -n "$GITHUB_TOKEN" ] || { echo '!! 缺少 GitHub 登录态'; exit 1; }
GITHUB_REPOSITORY="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
GITHUB_SHA="$(git rev-parse HEAD)"
export GITHUB_REPOSITORY GITHUB_SHA
export RELEASE_TAG="$TAG" FLOWCUBE_ERP_ORIGIN="$ERP_ORIGIN"

echo "==> 推送 main（触发浏览器端/服务器自动部署）..."
git push origin main

echo "==> 等待同一提交的检查、浏览器及 PDA，再发布桌面端并核对线上版本..."
node scripts/complete-release.js
