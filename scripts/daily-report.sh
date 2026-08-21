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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ops-common.sh
. "$SCRIPT_DIR/lib/ops-common.sh"

PROJECT_DIR="${PROJECT_DIR:-/opt/flowcube}"
BACKUP_DIR="${BACKUP_DIR:-/opt/flowcube/backups}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
MIN_BYTES="${MIN_BYTES:-1024}"

DINGTALK_WEBHOOK="$(read_dingtalk_webhook "$PROJECT_DIR")"

# 容器状态。名字经 resolve_container 解析，避免 Docker 改名后误报 missing
cd "$PROJECT_DIR" 2>/dev/null || true
up=0; total=0; cstat=""
for pair in "mysql:flowcube-mysql" "backend:flowcube-backend" "frontend:flowcube-frontend"; do
  svc="${pair%%:*}"; expected="${pair##*:}"
  total=$((total + 1))
  actual=$(resolve_container "$svc" "$expected")
  # docker inspect 失败时会往 stdout 吐空行，不清掉会把报告排版打乱
  st=$(docker inspect -f '{{.State.Status}}' "$actual" 2>/dev/null | tr -d '\n' || true)
  st=${st:-missing}
  [ "$st" = running ] && up=$((up + 1))
  # 容器被改过名时一并显示，便于发现 compose 状态漂移
  label="$expected"
  [ "$actual" != "$expected" ] && label="$expected → 实际 ${actual}"
  cstat="${cstat}\n  · ${label}: ${st}"
done

# 磁盘
disk=$(df -h / | awk 'NR==2{print $5" ("$3"/"$2")"}')

# 后端健康
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>/dev/null)
code=${code:-000}
[ "$code" = "200" ] && health="正常 (200)" || health="异常 ($code)"

# ── 最近备份 ────────────────────────────────────────────────────────────────
# ⚠️ 只统计「体积达标」的备份（2026-08-21 事故）：旧版仅用 `ls` 判断今日文件
# 是否存在，而备份失败时会留下 20 字节的空 gzip，于是日报天天显示"今日✓"，
# 数据库连续 12 天没有有效备份却无人察觉。判定必须看内容规模，不能看文件名。
valid_latest=""; valid_count=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  sz=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
  [ "${sz:-0}" -lt "$MIN_BYTES" ] && continue
  valid_count=$((valid_count + 1))
  [ -z "$valid_latest" ] && valid_latest="$f"
done <<< "$(ls -t "$BACKUP_DIR"/flowcube_*.sql.gz 2>/dev/null)"

junk_count=$(( $(ls "$BACKUP_DIR"/flowcube_*.sql.gz 2>/dev/null | wc -l | tr -d ' ') - valid_count ))

if [ -n "$valid_latest" ]; then
  bsize=$(du -h "$valid_latest" | cut -f1)
  btime=$(date -r "$valid_latest" '+%m-%d %H:%M' 2>/dev/null || echo '?')
  backup="最新 ${btime}（${bsize}），有效 ${valid_count} 份"
  # 备份是 02:00 cron、日报 09:00 跑，今日理应已有新备份；没有就是昨晚失败了
  today=$(date '+%Y%m%d')
  if [ -n "$(find "$BACKUP_DIR" -name "flowcube_${today}_*.sql.gz" -size +"${MIN_BYTES}"c 2>/dev/null | head -1)" ]; then
    backup="$backup，今日✓"
  else
    backup="⚠ $backup，但今日无有效备份 —— 昨晚备份可能失败！"
    backup_failed=1
  fi
else
  backup="⚠ 未找到任何有效备份文件"
  backup_failed=1
fi
[ "${junk_count:-0}" -gt 0 ] && backup="$backup（另有 ${junk_count} 个损坏文件待清理）"

# 整体健康判定（用于标题图标）：备份失败也算异常
if [ "$up" = "$total" ] && [ "$code" = "200" ] && [ -z "${backup_failed:-}" ]; then icon="✅"; else icon="⚠️"; fi

now=$(date '+%Y-%m-%d %H:%M')
MSG="FlowCube 每日巡检报告 ${icon} (${now})\n容器: ${up}/${total} 运行中${cstat}\n后端: ${health}\n磁盘: ${disk}\n备份: ${backup}\n\n收到本条即说明系统与监控均正常运行；若某天未收到，请检查服务器与监控任务。"

echo "[$(date '+%F %T')] $MSG"

dingtalk_send "$DINGTALK_WEBHOOK" "$MSG"
