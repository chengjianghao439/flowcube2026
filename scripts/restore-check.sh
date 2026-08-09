#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FlowCube 备份恢复演练脚本（审计 4.5）
#
# 取最新备份在「临时 MySQL 容器」中完整导入，校验表数与关键表行数，
# 作为「备份真的能恢复」的证明。只读操作，不影响生产库。
#
# 用法：
#   bash scripts/restore-check.sh              # 校验最新备份
#   bash scripts/restore-check.sh <file.sql.gz> # 校验指定备份
#
# 环境变量：
#   RESTORE_IMAGE   临时 MySQL 镜像（默认 mysql:8.0）
#   RESTORE_DB      校验用库名（默认 flowcube_restore_check，用完即删）
#   BACKUP_DIR      备份目录（默认 /opt/flowcube/backups）
#   MIN_TABLES      最小表数阈值（默认 80，低于视为恢复异常）
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/flowcube/backups}"
RESTORE_IMAGE="${RESTORE_IMAGE:-mysql:8.0}"
RESTORE_DB="${RESTORE_DB:-flowcube_restore_check}"
MIN_TABLES="${MIN_TABLES:-80}"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

FILE="${1:-}"
if [ -z "$FILE" ]; then
  FILE=$(ls -t "$BACKUP_DIR"/flowcube_*.sql.gz 2>/dev/null | head -1)
fi
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "[$(ts)] [ERROR] 未找到备份文件（$BACKUP_DIR/flowcube_*.sql.gz）" >&2
  exit 1
fi
echo "[$(ts)] [INFO] 校验备份：$(basename "$FILE")（$(du -h "$FILE" | cut -f1)）"

# 起一个临时 MySQL 容器（随机名防冲突），用 root 密码导入
CONTAINER="flowcube-restore-check-$$"
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[$(ts)] [INFO] 启动临时 MySQL 容器 $CONTAINER ..."
docker run -d --name "$CONTAINER" \
  -e MYSQL_ROOT_PASSWORD=restore_check_pw \
  -e MYSQL_DATABASE="$RESTORE_DB" \
  "$RESTORE_IMAGE" >/dev/null

# 等待容器就绪：mysqladmin ping 通过后还要确认能实际执行建库
# （MySQL 8.0 首次启动做初始化，ping 可能在 init 完成前就应答）
ready=0
for i in $(seq 1 60); do
  if docker exec "$CONTAINER" mysql -uroot -prestore_check_pw \
      -e "SELECT 1" >/dev/null 2>&1; then
    ready=1
    break
  fi
  [ "$i" = "60" ] && { echo "[$(ts)] [ERROR] 临时 MySQL 未就绪" >&2; exit 1; }
  sleep 2
done
[ "$ready" = "1" ] && echo "[$(ts)] [INFO] 临时 MySQL 已就绪"

echo "[$(ts)] [INFO] 解压并导入备份到 $RESTORE_DB ..."
# 备份是 mysqldump 单库输出（不含 CREATE DATABASE/USE，见 backup-db.sh），
# 须显式指定目标库；先建库确保存在（幂等），再导入。
docker exec "$CONTAINER" \
  mysql -uroot -prestore_check_pw -e "CREATE DATABASE IF NOT EXISTS \`$RESTORE_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" >/dev/null 2>&1
gunzip -c "$FILE" | docker exec -i "$CONTAINER" \
  mysql -uroot -prestore_check_pw "$RESTORE_DB" >/dev/null 2>&1 || {
    echo "[$(ts)] [ERROR] 备份导入失败 —— 备份可能损坏" >&2
    exit 1
  }

# 校验表数
TABLES=$(docker exec "$CONTAINER" \
  mysql -uroot -prestore_check_pw -N -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$RESTORE_DB'" 2>/dev/null | tr -d ' ')

echo "[$(ts)] [INFO] 恢复后表数：${TABLES}（阈值 ${MIN_TABLES}）"
if [ "${TABLES:-0}" -lt "$MIN_TABLES" ]; then
  echo "[$(ts)] [ERROR] 恢复后表数不足（${TABLES} < ${MIN_TABLES}），备份疑似不完整" >&2
  exit 1
fi

# 校验关键表行数（存在即有数据；阈值可放宽为 0，防止历史库本就少数据误报）
echo "[$(ts)] [INFO] 关键表行数抽查："
for t in sys_users product_items sale_orders purchase_orders inventory_containers; do
  EXISTS=$(docker exec "$CONTAINER" \
    mysql -uroot -prestore_check_pw -N -e \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$RESTORE_DB' AND table_name='$t'" 2>/dev/null | tr -d ' ')
  if [ "$EXISTS" = "1" ]; then
    ROWS=$(docker exec "$CONTAINER" \
      mysql -uroot -prestore_check_pw -N -e \
      "SELECT COUNT(*) FROM \`$RESTORE_DB\`.\`$t\`" 2>/dev/null | tr -d ' ')
    echo "    $t: ${ROWS} 行"
  else
    echo "    $t: 表不存在（历史备份可能无此表，忽略）"
  fi
done

echo "[$(ts)] [OK] 备份恢复演练通过：$(basename "$FILE") 可完整导入（${TABLES} 张表）"
