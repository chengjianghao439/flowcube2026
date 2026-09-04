#!/usr/bin/env bash
# 生产验收按顺序执行；限制辅助容器，失败由 server-update 回退应用。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "$ROOT/scripts/lib/runtime-guards.sh"
PLAYWRIGHT_IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-noble}"
export PAGE_SMOKE_BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:8080}"
export SMOKE_USERNAME="${SMOKE_USERNAME:-}" SMOKE_PASSWORD="${SMOKE_PASSWORD:-}"
[ -f docker-compose.yml ] || { echo '!! 未找到 docker-compose.yml' >&2; exit 1; }
[ -n "$SMOKE_USERNAME" ] && [ -n "$SMOKE_PASSWORD" ] || { echo '!! 缺少 SMOKE_USERNAME / SMOKE_PASSWORD' >&2; exit 1; }

exec 8>"${RELEASE_GATE_LOCK_FILE:-/tmp/flowcube-release-gate.lock}"
flock -n 8 || { echo '!! 已有发布门禁运行，拒绝重叠执行' >&2; exit 1; }
gate_name="flowcube-gate-$$-$(date +%s)"
cleanup_gate() {
  local status=$?
  trap - EXIT
  DOCKER_COMMAND_TIMEOUT=15 docker rm -f "$gate_name" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup_gate EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

avail_mb=$(df -Pm "$ROOT" | awk 'NR==2 {print $4}')
if [[ ! "$avail_mb" =~ ^[0-9]+$ ]] || [ "$avail_mb" -lt 4096 ]; then
  echo '!! 可用空间不足 4096 MB，终止门禁；不自动 prune 镜像/缓存/数据卷' >&2
  exit 1
fi

echo '==> 检查旧桌面下载目录是否被误用...'
if command -v node >/dev/null 2>&1; then bounded 30 node scripts/check-deprecated-downloads.js; fi
echo '==> 运行报表烟雾检查...'
DOCKER_COMMAND_TIMEOUT=120 docker compose exec -T backend npm run smoke:reports

for script in smoke-pages.node.js smoke-reconciliation-jumps.node.js; do
  echo "==> 运行 ${script}（最多 1 CPU / 1 GiB / 14 分钟）..."
  # 容器内 timeout 真正结束浏览器进程；客户端超时/中断由 EXIT 清理兜底。
  # --memory-swap 与 --memory 相等，避免验收把主机拖入交换抖动。
  DOCKER_COMMAND_TIMEOUT=900 docker run --rm --init --pull never --name "$gate_name" --network host \
    --cpus 1 --memory 1g --memory-swap 1g --pids-limit 256 --shm-size 256m \
    -e PAGE_SMOKE_BASE_URL -e SMOKE_USERNAME -e SMOKE_PASSWORD \
    -e PLAYWRIGHT_BROWSER_NAME=chromium -e PLAYWRIGHT_SKIP_BROWSER_INSTALL=1 \
    -v "$ROOT":"$ROOT" -w "$ROOT" "$PLAYWRIGHT_IMAGE" \
    timeout -k 10 840 node "scripts/$script"
done
echo '==> 发布门禁通过'
