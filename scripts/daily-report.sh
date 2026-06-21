#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FlowCube 每日巡检报告（心跳 / dead man's switch）
#
# 每天定时发一条"系统状态摘要"到钉钉群。即使一切正常也发——
# 若某天没收到这条日报，说明 cron / 服务器 / 监控脚本本身可能出了问题，
# 用户最晚 1 天即可察觉（弥补"只在异常时告警"的盲区）。
#
# cron（每天 09:00）：
#   0 9 * * * /opt/flowcube/scripts/daily-report.sh >> /opt/flowcube/backups/daily-report.log 2>&1
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/flowcube}"
BACKUP_DIR="${BACKUP_DIR:-/opt/flowcube/backups}"
CONTAINERS="${CONTAINERS:-flowcube-mysql flowcube-backend flowcube-frontend}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

DINGTALK_WEBHOOK="${DINGTALK_WEBHOOK:-}"
if [ -z "$DINGTALK_WEBHOOK" ] && [ -f "$PROJECT_DIR/.env" ]; then
  DINGTALK_WEBHOOK="$(grep -E '^DINGTALK_WEBHOOK=' "$PROJECT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2-)"
fi

# 容器状态
up=0; total=0; cstat=""
for c in $CONTAINERS; do
  total=$((total + 1))
  st=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)
  [ "$st" = running ] && up=$((up + 1))
  cstat="${cstat}\n  · ${c}: ${st}"
done

# 磁盘
disk=$(df -h / | awk 'NR==2{print $5" ("$3"/"$2")"}')

# 后端健康
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>/dev/null)
code=${code:-000}
[ "$code" = "200" ] && health="正常 (200)" || health="异常 ($code)"

# 最近备份
latest=$(ls -t "$BACKUP_DIR"/flowcube_*.sql.gz 2>/dev/null | head -1)
if [ -n "$latest" ]; then
  bsize=$(du -h "$latest" | cut -f1)
  btime=$(date -r "$latest" '+%m-%d %H:%M' 2>/dev/null || echo '?')
  bcount=$(ls "$BACKUP_DIR"/flowcube_*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
  backup="最新 ${btime}（${bsize}），共 ${bcount} 份"
else
  backup="⚠ 未找到备份文件"
fi

# 整体健康判定（用于标题图标）
if [ "$up" = "$total" ] && [ "$code" = "200" ]; then icon="✅"; else icon="⚠️"; fi

now=$(date '+%Y-%m-%d %H:%M')
MSG="FlowCube 每日巡检报告 ${icon} (${now})\n容器: ${up}/${total} 运行中${cstat}\n后端: ${health}\n磁盘: ${disk}\n备份: ${backup}\n\n收到本条即说明系统与监控均正常运行；若某天未收到，请检查服务器与监控任务。"

echo "[$(date '+%F %T')] $MSG"

if [ -n "$DINGTALK_WEBHOOK" ]; then
  payload="{\"msgtype\":\"text\",\"text\":{\"content\":\"${MSG}\"}}"
  curl -s -m 10 -H 'Content-Type: application/json' -d "$payload" "$DINGTALK_WEBHOOK" >/dev/null 2>&1 || true
fi
