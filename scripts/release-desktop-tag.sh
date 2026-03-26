#!/usr/bin/env bash
# tag 唯一来源：desktop/package.json 的 version → v{version}；禁止与远程重复。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bash "$ROOT/scripts/git-tag-check.sh"

VERSION=$(node -p "require('./desktop/package.json').version")
TAG="v${VERSION}"

echo "当前版本（desktop/package.json）: $VERSION"
echo "将使用 tag: $TAG"

LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
if [ -z "$LAST_TAG" ]; then
  echo "上一个 tag: (仓库中暂无 tag)"
else
  echo "上一个 tag: $LAST_TAG"
fi

# 远程是否已有同名 tag（避免重复发布；git-tag-check 已 fetch origin）
if git ls-remote --tags origin "refs/tags/${TAG}" | grep -q .; then
  echo "❌ 远程已存在 tag ${TAG}"
  echo "请先提升 desktop/package.json 的 version 再发布（勿重复打同一版本）。"
  exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "❌ 本地已存在 tag $TAG，请先删除或修改版本号"
  exit 1
fi

echo "发布检查: 允许发布（远程无 ${TAG}、本地无 ${TAG}）"
echo "创建并推送: ${TAG}（与 package.json 一致）"
git tag "${TAG}"
git push origin "${TAG}"
echo "已推送 ${TAG}"
