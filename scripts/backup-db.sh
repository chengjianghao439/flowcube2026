#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FlowCube 数据库与小满持久目录备份（宿主机 cron 调用）
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
#   BACKUP_DATABASE_ONLY=1  显式仅做数据库备份（独立 MySQL 等场景）
# 小满副本与数据库时间点单独记录；只有两份副本完整才生成成对回执。
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
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ops-common.sh
. "$SCRIPT_DIR/lib/ops-common.sh"
. "$SCRIPT_DIR/lib/runtime-guards.sh"

PROJECT_DIR="${PROJECT_DIR:-/opt/flowcube}"
BACKUP_DIR="${BACKUP_DIR:-/opt/flowcube/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
MIN_BYTES="${MIN_BYTES:-1024}"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

# 失败统一出口：写日志 + 推钉钉 + 清理残骸后退出
fail() {
  local reason="$1"
  echo "[$(ts)] [ERROR] $reason" >&2
  cleanup
  dingtalk_send "$(read_dingtalk_webhook "$PROJECT_DIR")" \
    "🔴 FlowCube 备份失败（$(ts)）：${reason}
请尽快检查最新完整备份与成对回执。" || true
  exit 1
}

# 容器名不再硬编码：Docker 会在 container_name 冲突时把容器改名为 <短id>_<原名>
cd "$PROJECT_DIR" 2>/dev/null || { echo "无法进入备份项目目录" >&2; exit 1; }
CONTAINER="${CONTAINER:-$(resolve_container mysql flowcube-mysql)}"

cleanup() {
  if [ -n "${STAGE_DIR:-}" ]; then
    rm -f "$STAGE_DIR/database.sql.gz" "$STAGE_DIR/assistant.json.gz" "$STAGE_DIR/dump.err"
    rmdir "$STAGE_DIR" 2>/dev/null || true
  fi
}
mkdir -p "$BACKUP_DIR" || fail "无法创建备份目录 $BACKUP_DIR"
docker inspect -f '{{.State.Status}}' "$CONTAINER" >/dev/null 2>&1 \
  || fail "MySQL 容器 ${CONTAINER} 不存在或无法访问"
exec 9>>"$BACKUP_DIR/.backup.lock" || fail "无法打开备份锁"
if ! flock -n 9; then
  echo "[$(ts)] [ERROR] 同一目录已有备份运行" >&2
  exit 1
fi

[[ "$MIN_BYTES" =~ ^[1-9][0-9]*$ && "$KEEP_DAYS" =~ ^[1-9][0-9]*$ ]] || fail "备份大小与保留天数须为正整数"
STAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/flowcube_${STAMP}.sql.gz"
[ ! -e "$FILE" ] || fail "该时间戳的备份已存在"
STAGE_DIR=$(mktemp -d "$BACKUP_DIR/.backup-staging-XXXXXXXX") || fail "无法创建私有暂存目录"
PART="$STAGE_DIR/database.sql.gz"
ERRLOG="$STAGE_DIR/dump.err"
trap cleanup EXIT
trap 'exit 1' INT TERM
echo "[$(ts)] [INFO] 开始备份 → $(basename "$FILE")（容器 ${CONTAINER}）"

snapshot_assistant() {
  local backend_id backend_identity backend_project mount_type extra
  backend_id=$(docker compose ps -q backend) || return 1
  [[ "$backend_id" =~ ^[a-f0-9]{12,64}$ ]] || return 1
  backend_identity=$(docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.project"}} {{range .Mounts}}{{if eq .Destination "/var/lib/flowcube/assistant"}}{{.Type}} {{.Name}}{{end}}{{end}}' "$backend_id") || return 1
  read -r ASSISTANT_IMAGE backend_project mount_type ASSISTANT_VOLUME extra <<< "$backend_identity"
  [[ "$ASSISTANT_IMAGE" =~ ^sha256:[a-f0-9]{64}$ && "$mount_type" = volume && -z "$extra" &&
    "$ASSISTANT_VOLUME" =~ ^[A-Za-z0-9_.-]+$ && "$backend_project" =~ ^[A-Za-z0-9_.-]+$ && "$backend_project" = "$MYSQL_PROJECT" ]] || return 1
  [ "$(docker volume inspect -f '{{index .Labels "com.docker.compose.volume"}} {{index .Labels "com.docker.compose.project"}}' "$ASSISTANT_VOLUME")" = "assistant_data $backend_project" ] || return 1
  DOCKER_COMMAND_TIMEOUT=60 docker exec -i "$backend_id" node --input-type=commonjs - snapshot /var/lib/flowcube/assistant \
    < "$SCRIPT_DIR/lib/assistant-backup.cjs" | gzip > "$STAGE_DIR/assistant.json.gz" || return 1
  ASSISTANT_SUMMARY=$(gzip -dc "$STAGE_DIR/assistant.json.gz" | node "$SCRIPT_DIR/lib/assistant-backup.cjs" verify) || return 1
  [ "$(docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.project"}} {{range .Mounts}}{{if eq .Destination "/var/lib/flowcube/assistant"}}{{.Type}} {{.Name}}{{end}}{{end}}' "$backend_id")" = "$backend_identity" ]
}

mysql_identity() {
  docker exec "$CONTAINER" bash -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=TCP -h127.0.0.1 -uroot --connect-timeout=5 --database="$MYSQL_DATABASE" -N -B -e "SELECT @@server_uuid, VERSION(), DATABASE()"' 2>/dev/null
}

ASSISTANT_OK=0
if [ "${BACKUP_DATABASE_ONLY:-0}" != 1 ]; then
  MYSQL_PROJECT=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$CONTAINER") || MYSQL_PROJECT=''
  if snapshot_assistant; then ASSISTANT_OK=1; fi
fi
MYSQL_BEFORE=$(mysql_identity) || fail "无法读取备份源 MySQL UUID"
read -r MYSQL_UUID MYSQL_VERSION MYSQL_SCHEMA unexpected <<< "$MYSQL_BEFORE"
[[ "$MYSQL_UUID" =~ ^[a-f0-9-]{36}$ && "$MYSQL_SCHEMA" =~ ^[A-Za-z0-9_]+$ && -n "$MYSQL_VERSION" && -z "$unexpected" ]] \
  || fail "备份源 MySQL 身份无效"
MYSQL_STARTED=$(node -p 'new Date().toISOString()') || fail '无法记录 MySQL 快照起点'

# 在容器内导出，容器自身环境变量提供凭证；--single-transaction 不锁表。
# 转储沿用既有运行窗口。管理探针和新小满快照使用各自时限。
# 仅在失败时打印 mysqldump 诊断。
"$DOCKER_BIN" exec "$CONTAINER" bash -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -u root --single-transaction --routines --triggers --add-drop-table -- "$MYSQL_DATABASE"' \
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
TABLE_COUNT=$(gzip -dc "$PART" 2>/dev/null | grep -c '^CREATE TABLE' || true)
[ "${TABLE_COUNT:-0}" -lt 1 ] \
  && fail "备份内容不含 CREATE TABLE 语句，疑似导出了空库"

MYSQL_FINISHED=$(node -p 'new Date().toISOString()') || fail '无法记录 MySQL 转储结束时间'
[ "$(mysql_identity)" = "$MYSQL_BEFORE" ] || fail "MySQL 备份期间来源变化"
mv "$PART" "$FILE" || fail "无法写入最终备份文件 $FILE"
echo "[$(ts)] [OK] 数据库备份完成：$(basename "$FILE")（$(du -h "$FILE" | cut -f1)）"
# Preserve the existing local retention duration for the database, including
# recovery when only it was available in this backup cycle.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'flowcube_*.sql.gz' -mtime "+${KEEP_DAYS}" -delete 2>/dev/null || true
if [ "${BACKUP_DATABASE_ONLY:-0}" = 1 ]; then exit 0; fi
[ "$ASSISTANT_OK" = 1 ] || fail "数据库备份已保留；小满卷身份或一致性校验失败，未生成成对回执"
mkdir -p "$BACKUP_DIR/assistant" "$BACKUP_DIR/paired" || fail "无法创建小满归档和回执目录"
mv "$STAGE_DIR/assistant.json.gz" "$BACKUP_DIR/assistant/flowcube_${STAMP}.json.gz" || fail "无法写入小满归档"
node "$SCRIPT_DIR/lib/backup-pair.cjs" write "$BACKUP_DIR" "$STAMP" "$MYSQL_UUID" "$MYSQL_VERSION" "$MYSQL_SCHEMA" \
  "$MYSQL_STARTED" "$MYSQL_FINISHED" "$ASSISTANT_VOLUME" "$ASSISTANT_IMAGE" "$ASSISTANT_SUMMARY" || fail "成对备份回执失败"
echo "[$(ts)] [OK] 已保存数据库与小满成对回执（不同快照时间）"

# Apply the same retention to the companion and receipt directories.
find "$BACKUP_DIR/assistant" -maxdepth 1 -type f -name 'flowcube_*.json.gz' -mtime "+${KEEP_DAYS}" -delete 2>/dev/null || true
find "$BACKUP_DIR/paired" -maxdepth 1 -type f -name 'flowcube_*.json' -mtime "+${KEEP_DAYS}" -delete 2>/dev/null || true
