#!/usr/bin/env bash
# 每日09:00心跳：正常一行，异常按影响/待处理/数据安全/服务/资源呈现。
# 收到日报只证明日报任务执行，不能据此推断监控任务、备份恢复能力均正常。
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/ops-common.sh"
PROJECT_DIR="${PROJECT_DIR:-/opt/flowcube}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
STATE_FILE="${STATE_FILE:-$BACKUP_DIR/.monitor.state}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/ready}"
DINGTALK_WEBHOOK="$(read_dingtalk_webhook "$PROJECT_DIR")"
export DOCKER_COMMAND_TIMEOUT=5
. "$SCRIPT_DIR/lib/runtime-guards.sh"
cd "$PROJECT_DIR" || exit 1
up=0
for pair in "mysql:flowcube-mysql" "backend:flowcube-backend" "frontend:flowcube-frontend"; do
  actual=$(resolve_container "${pair%%:*}" "${pair##*:}")
  st=$(docker inspect -f '{{.State.Status}}' "$actual" 2>/dev/null | tr -d '\n' || true)
  [ "$st" = running ] && up=$((up + 1))
done
disk=$(df / | awk 'NR==2{gsub("%","",$5); print $5}')
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>/dev/null)
code=${code:-000}
if ! MSG=$(printf 'metric\tup\t%s\nmetric\ttotal\t3\nmetric\tbackend\t%s\nmetric\tdisk\t%s\n' \
    "$up" "$code" "${disk:-未知}" | node "$SCRIPT_DIR/lib/ops-alerts.js" daily "$STATE_FILE" "$BACKUP_DIR" "$(date +%s)"); then
  MSG="⚠️ 极序 Flow｜日报生成失败，请检查监控状态与备份目录权限。"
fi
printf '[%s] %s\n' "$(ts)" "$MSG"
dingtalk_send "$DINGTALK_WEBHOOK" "$MSG"
