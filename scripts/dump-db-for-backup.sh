#!/usr/bin/env bash
# 在「仍有完整业务数据的旧机器」上执行，生成可迁移到阿里云的 SQL。
# 用法：
#   bash scripts/dump-db-for-backup.sh > flowcube_backup.sql
# 或：
#   bash scripts/dump-db-for-backup.sh /path/to/flowcube_backup.sql
#
# 将 flowcube_backup.sql scp 到服务器后：
#   FORCE_RESTORE=1 bash scripts/restore-db-from-dump.sh ./flowcube_backup.sql
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-}"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/.env"
  set +a
fi

H="${DB_HOST:-127.0.0.1}"
PT="${DB_PORT:-3306}"
U="${DB_USER:-flowcube}"
DB="${DB_NAME:-flowcube}"

echo "在终端输入数据库密码（用户: $U, 库: $DB）…" >&2

ARGS=(
  -h"$H" -P"$PT" -u"$U" -p
  --single-transaction --routines --triggers --set-gtid-purged=OFF
  --default-character-set=utf8mb4
  "$DB"
)

if [[ -n "$OUT" ]]; then
  mysqldump "${ARGS[@]}" >"$OUT"
  echo "已写入: $OUT" >&2
else
  mysqldump "${ARGS[@]}"
fi
