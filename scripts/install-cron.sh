#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FlowCube 服务器 cron 安装脚本（幂等，审计 4.5）
#
# 把 backup / monitor / daily-report / rotate-slowlog / restore-check 五条定时任务装进 crontab。
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
#   0 5 * * 1   restore-check.sh   每周一 05:00 备份恢复演练（2026-08-21 审计修复：
#               备份可恢复性无定期验证——文件级校验通过≠能恢复，起临时容器完整导入）
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# 仓库根（脚本在 scripts/ 下）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BACKUP_CRON='0 2 * * *'
MONITOR_CRON='*/5 * * * *'
REPORT_CRON='0 9 * * *'
SLOWLOG_CRON='0 4 * * *'
RESTORE_CRON='0 5 * * 1'

# 整份读取、补齐后只安装一次，读取失败时保留用户原表。
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
if ! LC_ALL=C crontab -l > "$tmpdir/table" 2>"$tmpdir/error"; then
  if ! grep -qi 'no crontab for' "$tmpdir/error"; then cat "$tmpdir/error" >&2; exit 1; fi
  : > "$tmpdir/table"
fi
mkdir -p "$ROOT/backups"
add_or_keep() {
  local schedule="$1" script="$2" name="$3" cmd logfile
  printf -v cmd '%q' "$ROOT/scripts/$script"
  printf -v logfile '%q' "$ROOT/backups/$name.log"
  # 兼容既有的直接执行和 bash 执行。注释和其它工程同名脚本不算已安装。
  if awk -v cmd="$cmd" '$0 !~ /^[[:space:]]*#/ { for(i=6;i<=NF;i++) if($i==cmd){found=1} } END {exit !found}' "$tmpdir/table" ||
     grep -Fqx "$schedule bash $cmd >> $logfile 2>&1" "$tmpdir/table"; then return; fi
  echo "$schedule bash $cmd >> $logfile 2>&1" >> "$tmpdir/table"
}
add_or_keep "$BACKUP_CRON" backup-db.sh backup
add_or_keep "$MONITOR_CRON" monitor.sh monitor
add_or_keep "$REPORT_CRON" daily-report.sh daily-report
add_or_keep "$SLOWLOG_CRON" rotate-slowlog.sh rotate-slowlog
add_or_keep "$RESTORE_CRON" restore-check.sh restore-check
crontab - < "$tmpdir/table"
echo "==> 当前 crontab："
crontab -l
