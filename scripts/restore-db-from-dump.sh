#!/usr/bin/env bash
# 将 mysqldump 全量备份导入 Docker 中的 MySQL。
# 用法：
#   cd /opt/flowcube
#   FORCE_RESTORE=1 bash scripts/restore-db-from-dump.sh /path/to/flowcube_backup.sql
#
# 会 DROP 并重建数据库，仅在有可信备份时使用。
# 依赖：docker 中有 flowcube-mysql；.env 中 DB_PASSWORD 须与 compose 里 MYSQL_ROOT_PASSWORD 一致（本仓库默认同源）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DUMP="${1:-}"

if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "用法: FORCE_RESTORE=1 bash scripts/restore-db-from-dump.sh /path/to/backup.sql"
  exit 1
fi

if [[ "${FORCE_RESTORE:-}" != "1" ]]; then
  echo "将删除并重建数据库后导入。确认无误后请加: FORCE_RESTORE=1"
  exit 2
fi

if [[ ! -f "$ROOT/.env" ]]; then
  echo "缺少 $ROOT/.env（需含 DB_PASSWORD DB_NAME）"
  exit 3
fi

set -a
# shellcheck source=/dev/null
source "$ROOT/.env"
set +a

DB="${DB_NAME:-flowcube}"
P="${DB_PASSWORD:?DB_PASSWORD 未设置}"
CONTAINER="${MYSQL_CONTAINER:-flowcube-mysql}"

echo "[restore] 容器: $CONTAINER | 库: $DB | 文件: $DUMP"

docker exec "$CONTAINER" mysqladmin ping -h localhost -uroot -p"$P" --silent >/dev/null

docker exec -i "$CONTAINER" mysql -h localhost -uroot -p"$P" --default-character-set=utf8mb4 <<SQL
DROP DATABASE IF EXISTS \`$DB\`;
CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
SQL

docker exec -i "$CONTAINER" mysql -h localhost -uroot -p"$P" --default-character-set=utf8mb4 "$DB" <"$DUMP"

echo "[restore] 导入完成。重启后端："
echo "  docker compose -f $ROOT/docker-compose.yml restart backend"
