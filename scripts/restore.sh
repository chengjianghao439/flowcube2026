#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FlowCube 数据库恢复脚本
#
# 功能：
#   • 列出可用备份文件，支持按序号或路径选择
#   • 恢复前要求输入数据库名称确认（防误操作）
#   • 恢复后自动验证：统计表数量并对比关键业务表是否存在
#   • 同时支持 Docker 模式和本地 mysql 客户端
#
# 使用方式：
#   交互模式  ./scripts/restore.sh
#   指定文件  ./scripts/restore.sh ./backups/daily/flowcube_20260303_020000.sql.gz
#   Docker    USE_DOCKER=true ./scripts/restore.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── 路径与配置 ──────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../backend/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-flowcube}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-flowcube}"
DOCKER_CONTAINER="${DOCKER_CONTAINER:-flowcube-mysql}"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/../backups/daily}"
USE_DOCKER="${USE_DOCKER:-auto}"

# 恢复完成后验证的关键业务表（检查是否存在）
VERIFY_TABLES="inventory_containers inventory_stock inventory_logs products users"

# ─── 颜色与日志 ───────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

_ts()       { date '+%Y-%m-%d %H:%M:%S'; }
log_info()  { echo -e "${GREEN}[$(_ts)] [INFO] ${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[$(_ts)] [WARN] ${NC} $*" >&2; }
log_error() { echo -e "${RED}[$(_ts)] [ERROR]${NC} $*" >&2; }

# ─── Docker 模式检测 ──────────────────────────────────────────────────────────

use_docker() {
  case "$USE_DOCKER" in
    true)  return 0 ;;
    false) return 1 ;;
    *)
      docker ps --format '{{.Names}}' 2>/dev/null \
        | grep -qx "$DOCKER_CONTAINER"
      ;;
  esac
}

# ─── mysql 命令构建 ───────────────────────────────────────────────────────────

# 输出可用的 mysql 客户端路径（本地模式时使用）
find_mysql_cmd() {
  if [ -n "${MYSQL_BIN:-}" ]; then
    echo "$MYSQL_BIN/mysql"
    return
  fi
  command -v mysql \
    || ls /opt/homebrew/bin/mysql \
       /usr/local/bin/mysql \
       /usr/bin/mysql 2>/dev/null \
    | head -1 \
    || true
}

# 执行 MySQL 查询（自动选择 Docker/本地）
run_query() {
  local sql="$1"
  if use_docker; then
    docker exec "$DOCKER_CONTAINER" \
      mysql -u "$DB_USER" -p"$DB_PASSWORD" -N -e "$sql" 2>/dev/null
  else
    local cmd
    cmd="$(find_mysql_cmd)"
    "$cmd" -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" -N -e "$sql" 2>/dev/null
  fi
}

# ─── 选择备份文件 ─────────────────────────────────────────────────────────────

BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ]; then
  echo ""
  echo -e "${BOLD}${CYAN}可用备份文件：${NC}"
  echo "─────────────────────────────────────────────────────────"

  # 列出备份文件，按时间降序（最新在前）
  mapfile -t BACKUP_LIST < <(
    find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f \
      | xargs ls -t 2>/dev/null \
      || true
  )

  if [ ${#BACKUP_LIST[@]} -eq 0 ]; then
    log_error "备份目录 $BACKUP_DIR 中没有找到备份文件"
    exit 1
  fi

  for i in "${!BACKUP_LIST[@]}"; do
    FILE="${BACKUP_LIST[$i]}"
    FNAME="$(basename "$FILE")"
    FSIZE="$(du -sh "$FILE" | cut -f1)"
    FTIME="$(date -r "$FILE" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || stat -c '%y' "$FILE" 2>/dev/null | cut -d'.' -f1 || echo 'unknown')"
    printf "  %2d)  %-45s  %6s  %s\n" "$((i+1))" "$FNAME" "$FSIZE" "$FTIME"
  done

  echo ""
  echo -n "请输入序号（1-${#BACKUP_LIST[@]}），或备份文件完整路径，直接回车取消：> "
  read -r INPUT

  if [ -z "$INPUT" ]; then
    echo "已取消"
    exit 0
  fi

  if [[ "$INPUT" =~ ^[0-9]+$ ]] && [ "$INPUT" -ge 1 ] && [ "$INPUT" -le "${#BACKUP_LIST[@]}" ]; then
    BACKUP_FILE="${BACKUP_LIST[$((INPUT-1))]}"
  else
    BACKUP_FILE="$INPUT"
  fi
fi

# ─── 验证备份文件 ─────────────────────────────────────────────────────────────

if [ ! -f "$BACKUP_FILE" ]; then
  log_error "备份文件不存在：$BACKUP_FILE"
  exit 1
fi

FSIZE="$(du -sh "$BACKUP_FILE" | cut -f1)"
log_info "目标备份文件：$(basename "$BACKUP_FILE")（$FSIZE）"
log_info "目标数据库  ：$DB_NAME"

# 验证 gz 文件完整性
if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
  log_error "备份文件 gzip 校验失败，文件可能已损坏"
  exit 1
fi
log_info "文件完整性校验通过 ✓"

# ─── 确认操作 ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${RED}${BOLD}┌─────────────────────────────────────────────────────┐${NC}"
echo -e "${RED}${BOLD}│  ⚠️  警告：此操作将覆盖数据库 '$DB_NAME' 中的所有数据！  │${NC}"
echo -e "${RED}${BOLD}└─────────────────────────────────────────────────────┘${NC}"
echo ""
echo -n "请输入数据库名称 ($DB_NAME) 以确认恢复操作：> "
read -r CONFIRM

if [ "$CONFIRM" != "$DB_NAME" ]; then
  echo "输入不匹配，操作已取消"
  exit 1
fi

# ─── 执行恢复 ─────────────────────────────────────────────────────────────────

echo ""
log_info "开始恢复..."

if use_docker; then
  log_info "模式：Docker（容器 $DOCKER_CONTAINER）"
  gunzip -c "$BACKUP_FILE" \
    | docker exec -i "$DOCKER_CONTAINER" \
        mysql -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" 2>/dev/null
else
  MYSQL_CMD="$(find_mysql_cmd)"
  if [ -z "$MYSQL_CMD" ] || [ ! -x "$MYSQL_CMD" ]; then
    log_error "找不到 mysql 命令。请安装 MySQL 客户端，或使用 USE_DOCKER=true"
    exit 1
  fi
  log_info "模式：本地（$MYSQL_CMD）"
  gunzip -c "$BACKUP_FILE" \
    | "$MYSQL_CMD" -h "$DB_HOST" -P "$DB_PORT" \
        -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" 2>/dev/null
fi

log_info "SQL 导入完成 ✓"

# ─── 恢复验证 ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}─── 恢复验证 ────────────────────────────────────────────${NC}"

# 1. 统计表数量
TABLE_COUNT="$(
  run_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME';" \
    | tr -d ' \n' \
    || echo "0"
)"
log_info "数据库表数量：${TABLE_COUNT} 张"

# 2. 关键业务表存在性检查
ALL_OK=true
for TABLE in $VERIFY_TABLES; do
  EXISTS="$(
    run_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_name='$TABLE';" \
      | tr -d ' \n' \
      || echo "0"
  )"
  if [ "$EXISTS" = "1" ]; then
    echo -e "  ${GREEN}✓${NC}  $TABLE"
  else
    echo -e "  ${RED}✗${NC}  $TABLE  ${RED}← 未找到！${NC}"
    ALL_OK=false
  fi
done

echo ""
if [ "$ALL_OK" = "true" ] && [ "${TABLE_COUNT:-0}" -gt 0 ]; then
  log_info "恢复验证通过 ✓  共 $TABLE_COUNT 张表，关键业务表全部存在"
else
  log_warn "恢复验证发现异常，请手动确认数据库状态"
  exit 1
fi
