#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# FlowCube Docker 备份容器入口脚本
#
# 运行环境：alpine:3.19 + mysql-client
# 调用方  ：docker-compose.backup.yml 中的 backup 服务
#
# 流程：
#   1. 立即执行一次备份（容器启动即备份，确认配置正确）
#   2. 将 cron 任务写入 /etc/crontabs/root
#   3. 启动 crond（前台运行，保持容器存活）
#
# 环境变量（由 docker-compose.backup.yml 注入）：
#   DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
#   KEEP_DAYS     保留天数（默认 7）
#   BACKUP_CRON   cron 表达式（默认 "0 2 * * *"，每天 02:00）
# ─────────────────────────────────────────────────────────────────────────────

set -e

DB_HOST="${DB_HOST:-mysql}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-flowcube}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-flowcube}"
KEEP_DAYS="${KEEP_DAYS:-7}"
BACKUP_CRON="${BACKUP_CRON:-0 2 * * *}"
BACKUP_DIR="/backups"
MIN_BYTES="${MIN_BYTES:-1024}"

_ts()      { date '+%Y-%m-%d %H:%M:%S'; }
log_info() { echo "[$(_ts)] [INFO]  $*"; }
log_warn() { echo "[$(_ts)] [WARN]  $*" >&2; }
log_error(){ echo "[$(_ts)] [ERROR] $*" >&2; }

# ─── 单次备份函数 ─────────────────────────────────────────────────────────────

do_backup() {
  mkdir -p "$BACKUP_DIR"
  TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
  FILENAME="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

  log_info "开始备份：$DB_NAME → $(basename "$FILENAME")"

  mysqldump \
    -h "$DB_HOST" \
    -P "$DB_PORT" \
    -u "$DB_USER" \
    -p"$DB_PASSWORD" \
    --single-transaction \
    --routines \
    --triggers \
    --add-drop-table \
    "$DB_NAME" 2>/dev/null \
    | gzip > "$FILENAME"

  ACTUAL_BYTES=$(wc -c < "$FILENAME" | tr -d ' ')
  if [ "$ACTUAL_BYTES" -lt "$MIN_BYTES" ]; then
    log_error "备份文件疑似损坏（仅 ${ACTUAL_BYTES} 字节）：$FILENAME"
    rm -f "$FILENAME"
    return 1
  fi

  SIZE=$(du -sh "$FILENAME" | cut -f1)
  log_info "备份完成：$(basename "$FILENAME")（$SIZE）"

  # 清理过期备份
  find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete 2>/dev/null || true
  REMAINING=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" | wc -l | tr -d ' ')
  log_info "当前备份数量：$REMAINING（保留 $KEEP_DAYS 天）"
}

# ─── 等待 MySQL 就绪（最多重试 30 次）────────────────────────────────────────

log_info "等待 MySQL 就绪（$DB_HOST:$DB_PORT）..."
RETRY=0
until mysqladmin ping -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" \
    --silent 2>/dev/null; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge 30 ]; then
    log_error "MySQL 连接超时，备份容器退出"
    exit 1
  fi
  sleep 5
done
log_info "MySQL 已就绪 ✓"

# ─── 立即执行首次备份 ────────────────────────────────────────────────────────

do_backup

# ─── 注册 cron 任务 ───────────────────────────────────────────────────────────

# 将所有需要的环境变量写入 cron 环境（alpine crond 不继承 shell 环境变量）
CRON_ENV="DB_HOST=$DB_HOST DB_PORT=$DB_PORT DB_USER=$DB_USER DB_PASSWORD=$DB_PASSWORD DB_NAME=$DB_NAME KEEP_DAYS=$KEEP_DAYS MIN_BYTES=$MIN_BYTES BACKUP_DIR=$BACKUP_DIR"
CRON_CMD="$CRON_ENV /docker-backup-entrypoint.sh cron-run >> /proc/1/fd/1 2>&1"

echo "$BACKUP_CRON $CRON_CMD" > /etc/crontabs/root
log_info "定时备份已注册：$BACKUP_CRON (Asia/Shanghai)"

# ─── 处理 cron-run 子命令（由 cron 调用）────────────────────────────────────

if [ "${1:-}" = "cron-run" ]; then
  do_backup
  exit 0
fi

# ─── 启动 crond（前台运行，日志输出到 stdout）────────────────────────────────

log_info "备份服务启动完毕，crond 运行中..."
exec crond -f -d 6
