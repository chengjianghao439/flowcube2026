#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FlowCube 服务健康监控（宿主机 cron 每 5 分钟调用）
#
# 检查项：
#   1. 三个容器是否 running（mysql / backend / frontend）
#   2. 磁盘使用率是否超阈值
#   3. 后端 /api/health 是否 200
#   4. MySQL 深检：连接可用性 + 慢查询堆积 + 连接数
#   5. 公网 HTTPS 探测（走 Caddy 全链路）
#   6. TLS 证书到期检查（剩余 <14 天告警）
#   7. 容器重启计数（反复崩溃被拉起）
#
# 异常时推送钉钉群机器人（webhook 从 .env 的 DINGTALK_WEBHOOK 读取，不入库）；
# 未配置 webhook 时仅记录到日志。带状态去抖：「正常→异常」与「异常→恢复」时
# 通知，避免每 5 分钟刷屏；但持续异常会按 REMIND_HOURS 定期重提醒（见下）。
#
# cron：
#   */5 * * * * /opt/flowcube/scripts/monitor.sh >> /opt/flowcube/backups/monitor.log 2>&1
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ops-common.sh
. "$SCRIPT_DIR/lib/ops-common.sh"

PROJECT_DIR="${PROJECT_DIR:-/opt/flowcube}"
DISK_THRESHOLD="${DISK_THRESHOLD:-85}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
# 公网探测地址：走 Caddy 全链路（DNS → Caddy → backend），能发现回环检查看不到的
# 域名解析 / Caddy 挂掉 / 证书链等问题（2026-08-22 新增）
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://jixuflow.com/api/health}"
# TLS 证书到期告警阈值（天）。Caddy 内置 ACME 通常提前 30 天自动续期，
# 连续几天告警说明续期链路有问题，需人工介入
CERT_HOST="${CERT_HOST:-jixuflow.com}"
CERT_DAYS_WARN="${CERT_DAYS_WARN:-14}"
# 容器重启计数告警阈值：restart: unless-stopped 会把崩溃容器反复拉起，
# 重启次数高说明容器在 crash-loop，仅靠「running」检查会漏报
RESTART_WARN="${RESTART_WARN:-3}"
STATE_FILE="${STATE_FILE:-/opt/flowcube/backups/.monitor.state}"
# cron 每 5 分钟启动一次；上一轮卡住时不得重复派生 Docker/TLS 探针。
exec 8>"${MONITOR_LOCK_FILE:-${STATE_FILE}.lock}" || { echo '!! 无法创建监控锁' >&2; exit 1; }
flock -n 8 || { echo '上一轮监控仍在运行，跳过本轮'; exit 0; }
export DOCKER_COMMAND_TIMEOUT=5
. "$SCRIPT_DIR/lib/runtime-guards.sh"
# 持续异常的重提醒间隔（小时）。0 表示只在状态切换时通知（旧行为，不推荐）
REMIND_HOURS="${REMIND_HOURS:-24}"

DINGTALK_WEBHOOK="$(read_dingtalk_webhook "$PROJECT_DIR")"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

cd "$PROJECT_DIR" 2>/dev/null || true
problems=""

# 1. 容器存活。名字经 resolve_container 解析：Docker 在 container_name 冲突时
#    会把容器改名为 <短id>_<原名>，硬编码名字会误报 missing（2026-08-21 事故）
for pair in "mysql:flowcube-mysql" "backend:flowcube-backend" "frontend:flowcube-frontend"; do
  svc="${pair%%:*}"; expected="${pair##*:}"
  actual=$(resolve_container "$svc" "$expected")
  st=$(docker inspect -f '{{.State.Status}}' "$actual" 2>/dev/null | tr -d '\n' || true)
  st=${st:-missing}
  [ "$st" != "running" ] && problems="${problems}容器 $expected 异常($st)；"
done

# 2. 磁盘使用率
use=$(df / | awk 'NR==2{gsub("%","",$5); print $5}')
if [ -n "$use" ] && [ "$use" -ge "$DISK_THRESHOLD" ]; then
  problems="${problems}磁盘使用率 ${use}%(阈值${DISK_THRESHOLD}%)；"
fi

# 3. 后端健康
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>/dev/null)
code=${code:-000}
[ "$code" != "200" ] && problems="${problems}后端健康检查 HTTP ${code}；"

# 4. MySQL 深检（P2-14）：连接可用性 + 慢查询堆积
SLOW_QUERY_WARN="${SLOW_QUERY_WARN:-50}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-$(resolve_container mysql flowcube-mysql)}"
if docker inspect "$MYSQL_CONTAINER" >/dev/null 2>&1; then
  if ! docker exec "$MYSQL_CONTAINER" mysqladmin ping --silent >/dev/null 2>&1; then
    problems="${problems}MySQL 无法连接；"
  else
    # 慢查询日志累积条数（配置开启后生效；日志不存在则跳过）。条数暴增说明有性能问题。
    slow_total=$(docker exec "$MYSQL_CONTAINER" sh -c \
      'test -f /var/log/mysql/slow.log && grep -c "^# Time:" /var/log/mysql/slow.log 2>/dev/null || echo 0' 2>/dev/null | tr -d ' ')
    slow_total=${slow_total:-0}
    if [ "${slow_total:-0}" -ge "$SLOW_QUERY_WARN" ]; then
      problems="${problems}慢查询日志累积 ${slow_total} 条（阈值${SLOW_QUERY_WARN}）；"
    fi
    # 连接数告警（P2-14）：Threads_connected 接近 max_connections 说明连接池打满。
    # 默认阈值 120：与 my.cnf 的 max_connections=151 拉开检测余量（实际生产峰值
    # 仅个位数，若真涨到 120 说明连接池已严重异常；不要设成 150 这种与上限重叠的值）
    MAX_CONN_WARN="${MAX_CONN_WARN:-120}"
    # 密码仅在容器内从已有环境读取，不展开到宿主命令参数或日志。
    # 查询失败/空值必须告警，不能把认证或数据库故障伪装成 0 个连接。
    if ! threads=$(docker exec "$MYSQL_CONTAINER" sh -c \
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot --connect-timeout=5 -N -B -e '\''SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME="Threads_connected"'\''' \
      2>/dev/null); then
      problems="${problems}MySQL 连接数查询失败；"
    elif [[ ! "$threads" =~ ^[0-9]+$ ]]; then
      problems="${problems}MySQL 连接数指标无效；"
    elif [ "$threads" -ge "$MAX_CONN_WARN" ]; then
      problems="${problems}MySQL 活跃连接 ${threads}（阈值${MAX_CONN_WARN}）；"
    fi
  fi
fi

# 当前时间戳提前计算（证书到期检查要算剩余天数；后面状态去抖也用它）
now_epoch=$(date +%s)

# 5. 公网 HTTPS 探测：与第 3 项的区别是走公网域名全链路（DNS→Caddy→backend），
#    回环检查无法发现 Caddy 挂掉、证书链异常、域名解析失败等问题
pub_code=$(curl -fsS -m 5 -o /dev/null -w '%{http_code}' "$PUBLIC_HEALTH_URL" 2>/dev/null)
pub_code=${pub_code:-000}
[ "$pub_code" != "200" ] && problems="${problems}公网探测 ${PUBLIC_HEALTH_URL} HTTP ${pub_code}；"

# 6. TLS 证书到期检查：剩余不足 CERT_DAYS_WARN 天告警。
#    Caddy 自动续期正常时应恒为「充足」，反复告警说明续期链路有问题。
cert_end=$(bounded 10 openssl s_client -servername "$CERT_HOST" -connect "$CERT_HOST:443" </dev/null \
  2>/dev/null | openssl x509 -noout -enddate 2>/dev/null) || cert_end=''
if [ -n "$cert_end" ]; then
  cert_date=$(printf '%s' "$cert_end" | cut -d= -f2-)
  cert_epoch=$(date -d "$cert_date" +%s 2>/dev/null || date -j -f '%b %d %H:%M:%S %Y %Z' "$cert_date" +%s 2>/dev/null)
  if [ -n "$cert_epoch" ]; then
    days_left=$(( (cert_epoch - now_epoch) / 86400 ))
    if [ "$days_left" -lt "$CERT_DAYS_WARN" ]; then
      problems="${problems}${CERT_HOST} 证书 ${days_left} 天后到期（阈值${CERT_DAYS_WARN}天，过期：${cert_date}）；"
    fi
  fi
else
  problems="${problems}${CERT_HOST} 证书查询失败或超时；"
fi

# 7. 容器重启计数：restart: unless-stopped 会把崩溃容器反复拉起，
#    重启次数 > 阈值说明容器在 crash-loop（running 检查看不出问题）
for pair in "mysql:flowcube-mysql" "backend:flowcube-backend" "frontend:flowcube-frontend"; do
  svc="${pair%%:*}"; expected="${pair##*:}"
  actual=$(resolve_container "$svc" "$expected")
  rc=$(docker inspect -f '{{.RestartCount}}' "$actual" 2>/dev/null | tr -d '\n' || true)
  if [ -n "${rc:-}" ]; then
    [ "$rc" -gt "$RESTART_WARN" ] \
      && problems="${problems}容器 $expected 重启 ${rc} 次（阈值${RESTART_WARN}，疑似 crash-loop）；"
  fi
done

notify() { dingtalk_send "$DINGTALK_WEBHOOK" "$1"; echo "[$(ts)] $1"; }

# 状态文件格式：`ok` 或 `bad <上次通知的 epoch 秒>`
prev="ok"; prev_at=0
if [ -f "$STATE_FILE" ]; then
  read -r prev prev_at < "$STATE_FILE" 2>/dev/null || { prev="ok"; prev_at=0; }
  prev="${prev:-ok}"; prev_at="${prev_at:-0}"
fi

if [ -n "$problems" ]; then
  # ⚠️ 持续异常必须定期重提醒（2026-08-21 事故）：旧版只在 ok→bad 切换时通知一次，
  # MySQL 容器被改名后 monitor 只响了一声就沉默了 12 天，期间备份一直在失败。
  # 故障没修好就该继续吵，否则「告警过了」等同于「没人知道」。
  should_notify=0
  [ "$prev" = "ok" ] && should_notify=1
  if [ "$prev" = "bad" ] && [ "${REMIND_HOURS:-0}" -gt 0 ]; then
    elapsed=$(( now_epoch - prev_at ))
    [ "$elapsed" -ge $(( REMIND_HOURS * 3600 )) ] && should_notify=1
  fi

  if [ "$should_notify" = "1" ]; then
    prefix="🔴 FlowCube 服务异常"
    [ "$prev" = "bad" ] && prefix="🔴 FlowCube 服务仍未恢复"
    notify "${prefix}（$(ts)）：${problems}"
    echo "bad $now_epoch" > "$STATE_FILE"
  else
    echo "bad $prev_at" > "$STATE_FILE"
  fi
else
  [ "$prev" = "bad" ] && notify "✅ FlowCube 服务已恢复正常（$(ts)）"
  echo "ok 0" > "$STATE_FILE"
fi
