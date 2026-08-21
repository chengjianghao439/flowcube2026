#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FlowCube 服务器 cron 安装脚本（幂等，审计 4.5）
#
# 把 backup / monitor / daily-report / rotate-slowlog 四条定时任务装进 crontab。
# 幂等：已存在的任务不重复添加（精确匹配命令行）。
#
# 用法：
#   bash scripts/install-cron.sh
#
# 安装的任务：
#   0 2 * * *   backup-db.sh       每天 02:00 数据库备份
#   */5 * * *   monitor.sh         每 5 分钟健康检查
#   0 9 * * *   daily-report.sh    每天 09:00 日报（含"今日备份"校验）
#   0 4 * * *   rotate-slowlog.sh  每天 04:00 慢查询日志轮转（>1M 才截断留档）
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# 仓库根（脚本在 scripts/ 下）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BACKUP_CRON='0 2 * * *'
MONITOR_CRON='*/5 * * * *'
REPORT_CRON='0 9 * * *'
SLOWLOG_CRON='0 4 * * *'

add_or_keep() {
  local pattern="$1" cron_line="$2"
  if crontab -l 2>/dev/null | grep -F "$pattern" | grep -q .; then
    echo "  ✓ 已存在：$pattern（跳过）"
  else
    ( crontab -l 2>/dev/null; echo "$cron_line" ) | crontab -
    echo "  + 已添加：$cron_line"
  fi
}

echo "==> 安装/核对 cron（幂等）..."
add_or_keep "backup-db.sh"      "$BACKUP_CRON bash $ROOT/scripts/backup-db.sh >> $ROOT/backups/backup.log 2>&1"
add_or_keep "monitor.sh"        "$MONITOR_CRON /opt/flowcube/scripts/monitor.sh >> /opt/flowcube/backups/monitor.log 2>&1"
add_or_keep "daily-report.sh"   "$REPORT_CRON /opt/flowcube/scripts/daily-report.sh >> /opt/flowcube/backups/daily-report.log 2>&1"
add_or_keep "rotate-slowlog.sh" "$SLOWLOG_CRON bash $ROOT/scripts/rotate-slowlog.sh >> $ROOT/backups/rotate-slowlog.log 2>&1"

echo "==> 当前 crontab："
crontab -l 2>/dev/null || true
echo "==> 完成"
