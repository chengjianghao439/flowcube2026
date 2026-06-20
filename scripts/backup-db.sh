#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FlowCube 数据库自动备份脚本（宿主机 cron 调用）
#
# 在 MySQL 容器内部执行 mysqldump（使用容器自身的 root 密码，避免外部客户端
# 对 MySQL 8.0 caching_sha2_password 的兼容问题），输出 gzip 压缩到宿主机。
#
# 用法：
#   bash scripts/backup-db.sh
#
# cron（每天凌晨 02:00）：
#   0 2 * * * /opt/flowcube/scripts/backup-db.sh >> /opt/flowcube/backups/backup.log 2>&1
#
# 可用环境变量覆盖默认值：
#   BACKUP_DIR  备份目录（默认 /opt/flowcube/backups）
#   CONTAINER   MySQL 容器名（默认 flowcube-mysql）
#   KEEP_DAYS   保留天数（默认 14）
#   MIN_BYTES   最小有效字节数，低于则判为损坏（默认 1024）
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/flowcube/backups}"
CONTAINER="${CONTAINER:-flowcube-mysql}"
KEEP_DAYS="${KEEP_DAYS:-14}"
MIN_BYTES="${MIN_BYTES:-1024}"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/flowcube_${STAMP}.sql.gz"

echo "[$(ts)] [INFO] 开始备份 → $(basename "$FILE")"

# 在容器内导出，容器自身环境变量提供凭证；--single-transaction 不锁表
docker exec "$CONTAINER" bash -c \
  'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --add-drop-table "$MYSQL_DATABASE"' \
  2>/dev/null | gzip > "$FILE"

BYTES=$(wc -c < "$FILE" | tr -d ' ')
if [ "$BYTES" -lt "$MIN_BYTES" ]; then
  echo "[$(ts)] [ERROR] 备份文件疑似损坏（仅 ${BYTES} 字节），已删除：$FILE" >&2
  rm -f "$FILE"
  exit 1
fi

# 清理过期备份
find "$BACKUP_DIR" -name 'flowcube_*.sql.gz' -mtime "+${KEEP_DAYS}" -delete 2>/dev/null || true
REMAIN=$(find "$BACKUP_DIR" -name 'flowcube_*.sql.gz' | wc -l | tr -d ' ')

echo "[$(ts)] [OK] 备份完成：$(basename "$FILE")（$(du -h "$FILE" | cut -f1)），当前共 ${REMAIN} 份，保留 ${KEEP_DAYS} 天"
