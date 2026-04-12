#!/usr/bin/env bash
# 在服务器仓库根目录执行：bash scripts/release-gate.sh
# 作用：执行发布前门禁，任一烟雾失败即退出非 0
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PLAYWRIGHT_IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-noble}"
SMOKE_BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1}"

if ! command -v docker >/dev/null 2>&1; then
  echo "!! 缺少 docker，无法执行发布门禁" >&2
  exit 1
fi

if [ ! -f docker-compose.yml ]; then
  echo "!! 未找到 docker-compose.yml，无法执行发布门禁" >&2
  exit 1
fi

echo "==> 运行报表烟雾检查..."
docker compose exec -T backend npm run smoke:reports

echo "==> 运行页面烟雾检查（Playwright 容器）..."
docker run --rm --network host \
  -e PAGE_SMOKE_BASE_URL="$SMOKE_BASE_URL" \
  -v "$ROOT":"$ROOT" \
  -w "$ROOT" \
  "$PLAYWRIGHT_IMAGE" \
  node scripts/smoke-pages.node.js

echo "==> 运行对账回跳烟雾检查（Playwright 容器）..."
docker run --rm --network host \
  -e PAGE_SMOKE_BASE_URL="$SMOKE_BASE_URL" \
  -v "$ROOT":"$ROOT" \
  -w "$ROOT" \
  "$PLAYWRIGHT_IMAGE" \
  node scripts/smoke-reconciliation-jumps.node.js

echo "==> 发布门禁通过"
