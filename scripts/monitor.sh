#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FlowCube 服务健康监控（宿主机 cron 每 5 分钟调用）
#
# 检查项：
#   1. 三个容器是否 running（mysql / backend / frontend）
#   2. 磁盘使用率是否超阈值
#   3. 后端 /api/health 是否 200
#
# 异常时推送企业微信群机器人（webhook 从 .env 的 WECOM_WEBHOOK 读取，不入库）；
# 未配置 webhook 时仅记录到日志。带状态去抖：仅在「正常→异常」与「异常→恢复」
# 的状态切换时通知，避免每 5 分钟重复刷屏。
#
# cron：
#   */5 * * * * /opt/flowcube/scripts/monitor.sh >> /opt/flowcube/backups/monitor.log 2>&1
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/flowcube}"
DISK_THRESHOLD="${DISK_THRESHOLD:-85}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
CONTAINERS="${CONTAINERS:-flowcube-mysql flowcube-backend flowcube-frontend}"
STATE_FILE="${STATE_FILE:-/opt/flowcube/backups/.monitor.state}"

# webhook 从 .env 读取（敏感，不入库）
WECOM_WEBHOOK="${WECOM_WEBHOOK:-}"
if [ -z "$WECOM_WEBHOOK" ] && [ -f "$PROJECT_DIR/.env" ]; then
  WECOM_WEBHOOK="$(grep -E '^WECOM_WEBHOOK=' "$PROJECT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"
fi

ts() { date '+%Y-%m-%d %H:%M:%S'; }

problems=""

# 1. 容器存活
for c in $CONTAINERS; do
  st=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo "missing")
  [ "$st" != "running" ] && problems="${problems}容器 $c 异常($st)；"
done

# 2. 磁盘使用率
use=$(df / | awk 'NR==2{gsub("%","",$5); print $5}')
if [ -n "$use" ] && [ "$use" -ge "$DISK_THRESHOLD" ]; then
  problems="${problems}磁盘使用率 ${use}%(阈值${DISK_THRESHOLD}%)；"
fi

# 3. 后端健康
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>/dev/null)
code=${code:-000}
[ "$code" != "200" ] && problems="${problems}后端健康检查 HTTP ${code}；"

# 推送函数（企业微信 text 消息）
notify() {
  msg="$1"
  if [ -n "$WECOM_WEBHOOK" ]; then
    payload="{\"msgtype\":\"text\",\"text\":{\"content\":\"${msg}\"}}"
    curl -s -m 10 -H 'Content-Type: application/json' -d "$payload" "$WECOM_WEBHOOK" >/dev/null 2>&1 || true
  fi
  echo "[$(ts)] $msg"
}

prev="ok"
[ -f "$STATE_FILE" ] && prev="$(cat "$STATE_FILE" 2>/dev/null || echo ok)"

if [ -n "$problems" ]; then
  [ "$prev" = "ok" ] && notify "🔴 FlowCube 服务异常（$(ts)）：${problems}"
  echo "bad" > "$STATE_FILE"
else
  [ "$prev" = "bad" ] && notify "✅ FlowCube 服务已恢复正常（$(ts)）"
  echo "ok" > "$STATE_FILE"
fi
