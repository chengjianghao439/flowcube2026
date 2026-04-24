#!/usr/bin/env bash
# 在服务器仓库根目录执行：bash scripts/release-gate.sh
# 作用：执行发布前门禁，任一烟雾失败即退出非 0
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PLAYWRIGHT_IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-noble}"
SMOKE_BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1}"
SMOKE_USERNAME="${SMOKE_USERNAME:-}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-}"

if ! command -v docker >/dev/null 2>&1; then
  echo "!! 缺少 docker，无法执行发布门禁" >&2
  exit 1
fi

if [ ! -f docker-compose.yml ]; then
  echo "!! 未找到 docker-compose.yml，无法执行发布门禁" >&2
  exit 1
fi

if [ -z "$SMOKE_USERNAME" ] || [ -z "$SMOKE_PASSWORD" ]; then
  echo "!! 缺少 SMOKE_USERNAME / SMOKE_PASSWORD，无法执行页面烟雾检查" >&2
  exit 1
fi

cleanup_docker_space() {
  echo "==> 预检 Docker 磁盘空间..."
  local avail_mb
  avail_mb="$(df -Pm / | awk 'NR==2 {print $4}')"
  echo "==> 当前可用空间：${avail_mb}MB"
  if [ "${avail_mb:-0}" -lt 2500 ]; then
    echo "==> 可用空间偏低，清理 Docker builder cache / 未使用镜像..."
    docker builder prune -af >/dev/null
    docker image prune -af >/dev/null
    avail_mb="$(df -Pm / | awk 'NR==2 {print $4}')"
    echo "==> 清理后可用空间：${avail_mb}MB"
    if [ "${avail_mb:-0}" -lt 2500 ]; then
      echo "!! 清理后空间仍不足 2500MB，无法安全拉取 Playwright 容器" >&2
      exit 1
    fi
  fi
}

echo "==> 检查旧桌面下载目录是否被误用..."
node scripts/check-deprecated-downloads.js

echo "==> 运行报表烟雾检查..."
docker compose exec -T backend npm run smoke:reports

cleanup_docker_space

echo "==> 运行页面烟雾检查（Playwright 容器）..."
docker run --rm --network host \
  -e PAGE_SMOKE_BASE_URL="$SMOKE_BASE_URL" \
  -e SMOKE_USERNAME="$SMOKE_USERNAME" \
  -e SMOKE_PASSWORD="$SMOKE_PASSWORD" \
  -e PLAYWRIGHT_BROWSER_NAME=chromium \
  -e PLAYWRIGHT_SKIP_BROWSER_INSTALL=1 \
  -v "$ROOT":"$ROOT" \
  -w "$ROOT" \
  "$PLAYWRIGHT_IMAGE" \
  node scripts/smoke-pages.node.js

echo "==> 运行对账回跳烟雾检查（Playwright 容器）..."
docker run --rm --network host \
  -e PAGE_SMOKE_BASE_URL="$SMOKE_BASE_URL" \
  -e SMOKE_USERNAME="$SMOKE_USERNAME" \
  -e SMOKE_PASSWORD="$SMOKE_PASSWORD" \
  -e PLAYWRIGHT_BROWSER_NAME=chromium \
  -e PLAYWRIGHT_SKIP_BROWSER_INSTALL=1 \
  -v "$ROOT":"$ROOT" \
  -w "$ROOT" \
  "$PLAYWRIGHT_IMAGE" \
  node scripts/smoke-reconciliation-jumps.node.js

echo "==> 发布门禁通过"
