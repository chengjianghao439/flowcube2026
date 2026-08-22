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
#   CONTAINER   MySQL 容器名（默认自动解析 compose 服务 mysql）
#   KEEP_DAYS   保留天数（默认 14）
#   MIN_BYTES   最小有效字节数，低于则判为损坏（默认 1024）
#
# ⚠️ 失败语义（2026-08-21 事故后重写，勿退回旧写法）：
#   备份要么产出一个通过完整性校验的文件，要么**什么都不留下**并告警。
#   旧版把 dump 直接重定向到最终文件名，且用 `set -e`：管道一失败脚本立刻退出，
#   后面那段"体积不足就删除"的校验根本没机会执行，于是每天留下一个 20 字节的
#   空 gzip；daily-report 只检查文件是否存在，就把它当成"今日备份✓"，
#   导致数据库连续 12 天无有效备份而无人察觉。
#   因此现在：① 先写 .part 临时文件，校验通过才原子 mv 到正式名；
#   ② 不用 `set -e` 兜底，显式检查每一步退出码；③ 任何失败都推钉钉。
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ops-common.sh
. "$SCRIPT_DIR/lib/ops-common.sh"

PROJECT_DIR="${PROJECT_DIR:-/opt/flowcube}"
BACKUP_DIR="${BACKUP_DIR:-/opt/flowcube/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
MIN_BYTES="${MIN_BYTES:-1024}"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

# 失败统一出口：写日志 + 推钉钉 + 清理残骸后退出
fail() {
  local reason="$1"
  echo "[$(ts)] [ERROR] $reason" >&2
  rm -f "${PART:-}" "${ERRLOG:-}"
  dingtalk_send "$(read_dingtalk_webhook "$PROJECT_DIR")" \
    "🔴 FlowCube 数据库备份失败（$(ts)）：${reason}\n请尽快检查，当前可能没有可用的最新备份。"
  exit 1
}

# 容器名不再硬编码：Docker 会在 container_name 冲突时把容器改名为 <短id>_<原名>
cd "$PROJECT_DIR" 2>/dev/null || true
CONTAINER="${CONTAINER:-$(resolve_container mysql flowcube-mysql)}"

mkdir -p "$BACKUP_DIR" || fail "无法创建备份目录 $BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/flowcube_${STAMP}.sql.gz"
PART="${FILE}.part"
ERRLOG="$(mktemp)"
trap 'rm -f "${PART:-}" "${ERRLOG:-}"' EXIT

echo "[$(ts)] [INFO] 开始备份 → $(basename "$FILE")（容器 ${CONTAINER}）"

docker inspect -f '{{.State.Status}}' "$CONTAINER" >/dev/null 2>&1 \
  || fail "MySQL 容器 ${CONTAINER} 不存在或无法访问"

# 在容器内导出，容器自身环境变量提供凭证；--single-transaction 不锁表。
# stderr 收进 ERRLOG（mysqldump 正常时也会警告密码明文，只在失败时才打印）。
docker exec "$CONTAINER" bash -c \
  'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --add-drop-table "$MYSQL_DATABASE"' \
  2>"$ERRLOG" | gzip > "$PART"
# PIPESTATUS 必须整体复制：它在下一条命令（哪怕是赋值）执行后就被重置，
# 逐个取 ${PIPESTATUS[0]} / ${PIPESTATUS[1]} 会在第二次取值时越界（set -u 直接报错）
pipe_rc=("${PIPESTATUS[@]}")
dump_rc=${pipe_rc[0]:-1}
gzip_rc=${pipe_rc[1]:-1}

if [ "$dump_rc" -ne 0 ]; then
  fail "mysqldump 失败（退出码 ${dump_rc}）：$(tr '\n' ' ' < "$ERRLOG" | tail -c 300)"
fi
[ "$gzip_rc" -ne 0 ] && fail "gzip 压缩失败（退出码 ${gzip_rc}）"

BYTES=$(wc -c < "$PART" | tr -d ' ')
[ "${BYTES:-0}" -lt "$MIN_BYTES" ] && fail "备份文件疑似损坏（仅 ${BYTES} 字节，阈值 ${MIN_BYTES}）"

# 完整性校验：能解压且含建表语句，才算真备份（防止 dump 出一份合法 gzip 的错误内容）
gzip -t "$PART" 2>/dev/null || fail "备份文件 gzip 校验不通过"
# 用 grep -c 而非 grep -q：-q 一匹配就退出会让上游 zcat 收到 SIGPIPE（退出码 141），
# 在 `set -o pipefail` 下整条管道被判为失败，好备份会被误删
TABLE_COUNT=$(zcat "$PART" 2>/dev/null | grep -c '^CREATE TABLE' || true)
[ "${TABLE_COUNT:-0}" -lt 1 ] \
  && fail "备份内容不含 CREATE TABLE 语句，疑似导出了空库"

mv -f "$PART" "$FILE" || fail "无法写入最终备份文件 $FILE"
# 备份含完整业务数据（客户/供应商/账务），收紧权限只允许 root 读
chmod 600 "$FILE" || true

# 清理过期备份
find "$BACKUP_DIR" -name 'flowcube_*.sql.gz' -mtime "+${KEEP_DAYS}" -delete 2>/dev/null || true
REMAIN=$(find "$BACKUP_DIR" -name 'flowcube_*.sql.gz' | wc -l | tr -d ' ')

echo "[$(ts)] [OK] 备份完成：$(basename "$FILE")（$(du -h "$FILE" | cut -f1)），当前共 ${REMAIN} 份，保留 ${KEEP_DAYS} 天"
