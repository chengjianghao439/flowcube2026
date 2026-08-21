#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FlowCube MySQL 慢查询日志轮转（宿主机 cron 每日调用）
#
# 背景（2026-08-21）：slow.log 在容器内无 logrotate、宿主也无轮转 cron，
# log_queries_not_using_indexes 关闭前曾堆出 83M / 10.9 万条假阳性。现在只剩
# 真慢查询（增长慢），但文件仍会无限增长，需要定期截断。
#
# 方案：直接在容器内 truncate 而非轮转改名——MySQL 持有该文件的写句柄，
# 改名（mv）后 MySQL 继续写旧 inode，新文件不再增长，反而更糟；
# truncate 是原地清空，MySQL 无感知继续写，这是对 MySQL 无损的唯一做法。
# 清空前保留一份最近历史（.prev），供事后排查真慢查询。
#
# cron（每天 04:00）：
#   0 4 * * * bash /opt/flowcube/scripts/rotate-slowlog.sh >> /opt/flowcube/backups/rotate-slowlog.log 2>&1
#
# 可用环境变量覆盖默认值：
#   PROJECT_DIR   项目根（默认 /opt/flowcube）
#   MYSQL_CONTAINER  MySQL 容器名（默认自动解析 compose 服务 mysql）
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ops-common.sh
. "$SCRIPT_DIR/lib/ops-common.sh"

PROJECT_DIR="${PROJECT_DIR:-/opt/flowcube}"
SLOWLOG="${SLOWLOG:-/var/log/mysql/slow.log}"
MIN_BYTES="${MIN_BYTES:-1048576}"   # 1M 以下不轮转（避免空文件频繁留档）

ts() { date '+%Y-%m-%d %H:%M:%S'; }

cd "$PROJECT_DIR" 2>/dev/null || true
CONTAINER="${CONTAINER:-$(resolve_container mysql flowcube-mysql)}"

if ! docker inspect -f '{{.State.Status}}' "$CONTAINER" >/dev/null 2>&1; then
  echo "[$(ts)] [ERROR] MySQL 容器 $CONTAINER 不可用，跳过轮转" >&2
  exit 1
fi

size=$(docker exec "$CONTAINER" sh -c "wc -c < $SLOWLOG 2>/dev/null || echo 0" 2>/dev/null | tr -d ' ')
size=${size:-0}

if [ "${size:-0}" -lt "$MIN_BYTES" ]; then
  echo "[$(ts)] [OK] slow.log 当前 ${size} 字节，未达 ${MIN_BYTES} 阈值，跳过轮转"
  exit 0
fi

# 保留最近一份历史（覆盖旧的 .prev）
docker exec "$CONTAINER" sh -c "cp $SLOWLOG $SLOWLOG.prev 2>/dev/null && : > $SLOWLOG" \
  && echo "[$(ts)] [OK] slow.log 已轮转：${size} 字节 → $SLOWLOG.prev（保留一份）" \
  || { echo "[$(ts)] [ERROR] slow.log 轮转失败" >&2; exit 1; }
