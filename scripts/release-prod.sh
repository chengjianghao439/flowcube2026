#!/usr/bin/env bash
# 统一正式发布入口：
# 1. push main -> 触发浏览器端/服务器自动部署
# 2. push desktop tag -> 触发桌面端 EXE 构建与 Release
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

echo "==> 推送 main（触发浏览器端/服务器自动部署）..."
git push origin main

echo "==> 推送桌面端 tag（触发 Windows EXE 构建与 Release）..."
bash scripts/release-desktop-tag.sh

echo "==> 发布请求已提交到 GitHub Actions"
echo "    - 浏览器 / 服务器：Deploy Browser App"
echo "    - 桌面端安装包：Build Desktop Installer"
