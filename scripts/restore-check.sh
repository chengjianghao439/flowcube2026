#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FlowCube 备份恢复演练脚本（审计 4.5）
#
# 取最新备份在「临时 MySQL 容器」中完整导入，校验表数与关键表行数，
# 作为「备份真的能恢复」的证明。只读操作，不影响生产库。
#
# 导入前会规范化 mysqldump 对触发器函数体的已知导出缺陷（2026-09-14 事故）：
# 函数体残留的结尾分号会被导出成 `... ); */;;`，直接导入必然 1064。这里只在
# 导入管道里把该分号移出可执行注释，绝不改写备份文件本身。
#
# 用法：
#   bash scripts/restore-check.sh              # 校验最新备份
#   bash scripts/restore-check.sh <file.sql.gz> # 校验指定备份
#
# 环境变量：
#   RESTORE_IMAGE   临时 MySQL 镜像（默认 mysql:8.0）
#   RESTORE_DB      校验用库名（默认 flowcube_restore_check，用完即删）
#   RESTORE_TIMEOUT_SECONDS 整个演练时限（默认 900 秒，超时清理容器）
#   RESTORE_MEMORY / RESTORE_CPUS / RESTORE_PIDS 默认 768m / 1 / 256
#   BACKUP_DIR      备份目录（默认 /opt/flowcube/backups）
#   MIN_TABLES      最小表数阈值（默认从迁移文件数推导：backend/src/database/*.sql
#                   中的 CREATE TABLE 净数 - 2 容差；可显式覆盖）
#   MIN_ROWS        关键表最小行数（默认 1：0 行即判恢复异常）
#   BACKUP_MAX_AGE_HOURS 自动选取最新备份时允许的文件年龄（默认 48 小时）。
#                   显式指定历史备份只检验恢复能力，文件过期时提示但不拒绝。
#                   FRESH_HOURS 保留为旧配置别名，现按文件时间判断，不再查销售单。
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESTORE_TIMEOUT_SECONDS="${RESTORE_TIMEOUT_SECONDS:-900}"
[[ "$RESTORE_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || { echo 'RESTORE_TIMEOUT_SECONDS 必须为正整数' >&2; exit 1; }
TIMEOUT_BIN="$(type -P timeout || type -P gtimeout || true)"
[ -n "$TIMEOUT_BIN" ] || { echo '恢复演练需要 GNU timeout（macOS: coreutils）' >&2; exit 1; }
if [ "${FLOWCUBE_RESTORE_DEADLINE_ACTIVE:-0}" != 1 ]; then
  # 让调用者PID直接由timeout接管；手动终止该PID也会转发到导入与清理链。
  exec "$TIMEOUT_BIN" -k 10 "$RESTORE_TIMEOUT_SECONDS" env FLOWCUBE_RESTORE_DEADLINE_ACTIVE=1 \
    bash "$SCRIPT_DIR/restore-check.sh" "$@"
fi
# 位于整体 timeout 进程组内，子命令不能创建逃离该时限的新进程组。
export FLOWCUBE_TIMEOUT_GROUP=1
. "$SCRIPT_DIR/lib/runtime-guards.sh"
# shellcheck source=lib/ops-common.sh
. "$SCRIPT_DIR/lib/ops-common.sh"

PROJECT_DIR="${PROJECT_DIR:-/opt/flowcube}"
BACKUP_DIR="${BACKUP_DIR:-/opt/flowcube/backups}"
RESTORE_IMAGE="${RESTORE_IMAGE:-mysql:8.0}"
RESTORE_DB="${RESTORE_DB:-flowcube_restore_check}"
# 临时数据卷用**具名**卷（而不是让 mysql 镜像自动建匿名卷）：名字固定，才能在每次演练启动时幂等
# 清掉上次异常中断留下的残留。2026-09-19 查明：匿名卷一旦因 SIGKILL / 机器重启 / OOM 绕过 trap，
# 就会以 64 位 hex 名长期堆积——2026-08-10、08-25、09-01 各残留一个含完整业务表的
# flowcube_restore_check 卷，共 769MB。
RESTORE_VOLUME="${RESTORE_VOLUME:-flowcube_restore_check_tmp}"
RESTORE_MEMORY="${RESTORE_MEMORY:-768m}"
RESTORE_CPUS="${RESTORE_CPUS:-1}"
RESTORE_PIDS="${RESTORE_PIDS:-256}"
MIN_TABLES="${MIN_TABLES:-}"
[[ "$RESTORE_DB" =~ ^[A-Za-z0-9_]+$ ]] || { echo 'RESTORE_DB 只能包含字母、数字和下划线' >&2; exit 1; }
[[ "$RESTORE_MEMORY" =~ ^[1-9][0-9]*[mMgG]$ ]] || { echo 'RESTORE_MEMORY 必须带 m/g 容量单位' >&2; exit 1; }
[[ "$RESTORE_CPUS" =~ ^[0-9]+([.][0-9]+)?$ && ! "$RESTORE_CPUS" =~ ^0+([.]0+)?$ ]] || { echo 'RESTORE_CPUS 必须为正数' >&2; exit 1; }
[[ "$RESTORE_PIDS" =~ ^[1-9][0-9]*$ ]] || { echo 'RESTORE_PIDS 必须为正整数' >&2; exit 1; }

# 推导表数阈值：取仓库迁移文件里「CREATE TABLE 净数」- 2 容差（脚本在服务器
# /opt/flowcube 下运行，仓库相对路径为 ../backend/src/database）。
# 直接用 .sql 文件数会虚高（含少量纯删除/索引迁移），且生产实测表数约 131，
# 文件数与其脱节，必须按迁移声明的建表数推导。
MIGRATION_DIR="$SCRIPT_DIR/../backend/src/database"
MIGRATION_DIR="$(cd "$MIGRATION_DIR" 2>/dev/null && pwd || true)"
DERIVED_MIN_TABLES=0
if [ -n "$MIGRATION_DIR" ] && ls "$MIGRATION_DIR"/*.sql >/dev/null 2>&1; then
  DERIVED_MIN_TABLES=$(
    created=$(grep -h '^CREATE TABLE' "$MIGRATION_DIR"/*.sql | wc -l | tr -d ' ')
    dropped=$(grep -h '^DROP TABLE' "$MIGRATION_DIR"/*.sql | wc -l | tr -d ' ')
    echo $(( created - dropped - 2 ))
  )
fi
MIN_TABLES="${MIN_TABLES:-$DERIVED_MIN_TABLES}"
MIN_TABLES="${MIN_TABLES:-80}"
MIN_ROWS="${MIN_ROWS:-1}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-${FRESH_HOURS:-48}}"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

# mysqldump 会把触发器函数体残留的结尾分号导出成 `... ); */;;`。可执行注释
# /*!50003 ... */ 里的这个分号会提前终止语句，剩下的 `*/` 触发 1064 语法错误，
# 于是完整的备份被误判成「损坏」。把分号移到注释外即可，触发器定义本身不变。
normalize_trigger_terminators() {
  sed 's|;[[:space:]]*\*/;;[[:space:]]*\r*$| */;;|'
}

fail() {
  local reason="$1"
  echo "[$(ts)] [ERROR] $reason" >&2
  # 告警发送结果**不得改变本脚本的退出码**：本脚本是 set -e，而 dingtalk_send 现在会在
  # 未配置/发送失败时返回非 0（2026-09-18 审计修复），不显式吞掉就会在下面 exit 1 之前中断，
  # 把「恢复演练失败」的退出码 1 变成 2。告警失败本身已由 dingtalk_send 写 stderr。
  dingtalk_send "$(read_dingtalk_webhook "$PROJECT_DIR")" \
    "🔴 FlowCube 备份恢复演练失败（$(ts)）：${reason}\n备份可能无法恢复，请尽快人工验证！" || true
  exit 1
}

FILE="${1:-}"
AUTO_LATEST=0
if [ -z "$FILE" ]; then
  AUTO_LATEST=1
  FILE=$(ls -t "$BACKUP_DIR"/flowcube_*.sql.gz 2>/dev/null | head -1 || true)
fi
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  fail "未找到备份文件（$BACKUP_DIR/flowcube_*.sql.gz）"
fi
echo "[$(ts)] [INFO] 校验备份：$(basename "$FILE")（$(du -h "$FILE" | cut -f1)）"

# 无业务的时段也必须产出新备份；销售单时间不能代表备份作业是否在运行。
[[ "$BACKUP_MAX_AGE_HOURS" =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_MAX_AGE_HOURS 必须为正整数"
FILE_EPOCH=$(stat -c %Y "$FILE" 2>/dev/null || stat -f %m "$FILE" 2>/dev/null) \
  || fail "无法读取备份文件时间"
[[ "$FILE_EPOCH" =~ ^[0-9]+$ ]] || fail "备份文件时间无效"
AGE_SECONDS=$(( $(date +%s) - FILE_EPOCH ))
[ "$AGE_SECONDS" -ge 0 ] || fail "备份文件时间晚于当前时间，请检查系统时钟"
echo "[$(ts)] [INFO] 备份文件距今 $(( AGE_SECONDS / 3600 )) 小时（阈值 ${BACKUP_MAX_AGE_HOURS}h）"
if [ "$AGE_SECONDS" -gt $(( BACKUP_MAX_AGE_HOURS * 3600 )) ]; then
  if [ "$AUTO_LATEST" = 1 ]; then
    fail "最新备份文件已过期，请检查每日备份作业"
  fi
  echo "[$(ts)] [WARN] 指定的历史备份已超过新鲜度阈值，本次仅验证其恢复能力"
fi

# 起一个临时 MySQL 容器（随机名防冲突），用 root 密码导入
CONTAINER="flowcube-restore-check-$$"
cleanup() {
  # 数据目录是**具名**卷（见 RESTORE_VOLUME）：`docker rm -f -v` 只删匿名卷、对具名卷无效，
  # 因此必须再显式删卷，否则成功路径也会把整个恢复库留在盘上。
  DOCKER_COMMAND_TIMEOUT=5 docker rm -f -v "$CONTAINER" >/dev/null 2>&1 \
    || echo "[WARN] 临时恢复容器清理失败，请检查 $CONTAINER" >&2
  DOCKER_COMMAND_TIMEOUT=10 docker volume rm -f "$RESTORE_VOLUME" >/dev/null 2>&1 \
    || echo "[WARN] 临时恢复数据卷清理失败，请检查 $RESTORE_VOLUME" >&2
  [ -n "${IMPORT_LOG:-}" ] && rm -f "$IMPORT_LOG"
}
trap cleanup EXIT
trap 'exit 124' TERM
trap 'exit 130' INT

# 启动前先清掉同名卷：上一次演练若被 SIGKILL / 机器重启 / OOM 杀掉，trap 不会执行、卷会留下；
# 这里幂等清理让它自愈，异常中断也不再累积（旧写法用匿名卷，根本无法按名字回收）。
echo "[$(ts)] [INFO] 清理可能残留的临时数据卷 $RESTORE_VOLUME ..."
DOCKER_COMMAND_TIMEOUT=15 docker volume rm -f "$RESTORE_VOLUME" >/dev/null 2>&1 || true

echo "[$(ts)] [INFO] 启动临时 MySQL 容器 $CONTAINER ..."
docker run -d --name "$CONTAINER" \
  --network none --memory "$RESTORE_MEMORY" --memory-swap "$RESTORE_MEMORY" \
  --cpus "$RESTORE_CPUS" --pids-limit "$RESTORE_PIDS" \
  -v "$RESTORE_VOLUME:/var/lib/mysql" \
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
  [ "$i" = "60" ] && fail "临时 MySQL 未就绪"
  sleep 2
done
[ "$ready" = "1" ] && echo "[$(ts)] [INFO] 临时 MySQL 已就绪"

echo "[$(ts)] [INFO] 解压并导入备份到 $RESTORE_DB ..."
# 备份是 mysqldump 单库输出（不含 CREATE DATABASE/USE，见 backup-db.sh），
# 须显式指定目标库；先建库确保存在（幂等），再导入。
docker exec "$CONTAINER" \
  mysql -uroot -prestore_check_pw -e "CREATE DATABASE IF NOT EXISTS \`$RESTORE_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" >/dev/null 2>&1
# 导入失败时要拿到真实原因：旧写法把 stderr 丢进 /dev/null，只报「备份可能损坏」，
# 让一份完好的备份被误判（2026-09-14）。这里落盘再透出，区分文件损坏与语法问题。
IMPORT_LOG="$(mktemp)"
set +e
{ gunzip -c "$FILE" | normalize_trigger_terminators \
  | DOCKER_COMMAND_TIMEOUT="$RESTORE_TIMEOUT_SECONDS" docker exec -i "$CONTAINER" \
      mysql -uroot -prestore_check_pw "$RESTORE_DB" >/dev/null; } 2>"$IMPORT_LOG"
IMPORT_RC=$?
set -e
if [ "$IMPORT_RC" -ne 0 ]; then
  IMPORT_DETAIL="$(grep -v -i 'using a password' "$IMPORT_LOG" 2>/dev/null \
    | grep -v '^[[:space:]]*$' | head -1 || true)"
  if [ -z "$IMPORT_DETAIL" ] && grep -q -i 'unexpected end of file\|not in gzip format\|invalid compressed data' "$IMPORT_LOG" 2>/dev/null; then
    IMPORT_DETAIL='备份压缩包无法完整解压，文件疑似截断或损坏'
  fi
  [ -n "$IMPORT_DETAIL" ] && echo "[$(ts)] [ERROR] 导入失败详情：$IMPORT_DETAIL" >&2
  # dingtalk_send 直接拼接 JSON，报错文本里的引号/反斜杠会让钉钉静默失败，先净化。
  IMPORT_ALERT="$(printf '%s' "$IMPORT_DETAIL" | tr '\n\r\t' '   ' | sed 's/["\\]//g' | cut -c1-200)"
  fail "备份导入失败（退出码 ${IMPORT_RC}）：${IMPORT_ALERT:-未捕获到 MySQL 输出}"
fi

# 校验表数
TABLES=$(docker exec "$CONTAINER" \
  mysql -uroot -prestore_check_pw -N -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$RESTORE_DB'" 2>/dev/null | tr -d ' ')

echo "[$(ts)] [INFO] 恢复后表数：${TABLES}（阈值 ${MIN_TABLES}）"
if [ "${TABLES:-0}" -lt "$MIN_TABLES" ]; then
  fail "恢复后表数不足（${TABLES} < ${MIN_TABLES}），备份疑似不完整"
fi

# 校验关键表行数（2026-08-22 变硬）：不再「存在即通过」——任一关键表 0 行即 FAIL。
# 关键表是业务主链路的核心表，任何一张是空表都说明备份不完整或导入有问题。
echo "[$(ts)] [INFO] 关键表行数抽查（阈值 ≥${MIN_ROWS} 行）："
for t in sys_users product_items sale_orders purchase_orders inventory_containers; do
  ROWS=$(docker exec "$CONTAINER" \
    mysql -uroot -prestore_check_pw -N -e \
    "SELECT COUNT(*) FROM \`$RESTORE_DB\`.\`$t\`" 2>/dev/null | tr -d ' ')
  ROWS=${ROWS:-0}
  echo "    $t: ${ROWS} 行"
  if [ "${ROWS:-0}" -lt "$MIN_ROWS" ]; then
    fail "关键表 $t 行数为 0（阈值 ${MIN_ROWS}），备份疑似不完整"
  fi
done

echo "[$(ts)] [OK] 备份恢复演练通过：$(basename "$FILE") 可完整导入（${TABLES} 张表）"
