#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FlowCube 服务健康监控（宿主机 cron 每 5 分钟调用）
#
# 检查项：
#   1. 三个容器是否 running（mysql / backend / frontend）
#   2. 磁盘使用率是否超阈值
#   3. 后端 /api/ready 是否 200（使用应用连接池探测数据库）
#   4. MySQL 深检：连接可用性 + 最近 24 小时慢查询 + 连接数
#   5. 公网 HTTPS 探测（走 Caddy 全链路）
#   6. TLS 证书到期检查（剩余 <14 天告警）
#   7. 近30分钟采样新增重启，容器重建后重新取基线
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
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/ready}"
# 公网探测地址：走 Caddy 全链路（DNS → Caddy → backend），能发现回环检查看不到的
# 域名解析 / Caddy 挂掉 / 证书链等问题（2026-08-22 新增）
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://jixuflow.com/api/ready}"
# TLS 证书到期告警阈值（天）。Caddy 内置 ACME 通常提前 30 天自动续期，
# 连续几天告警说明续期链路有问题，需人工介入
CERT_HOST="${CERT_HOST:-jixuflow.com}"
CERT_DAYS_WARN="${CERT_DAYS_WARN:-14}"
# 容器重启计数告警阈值：restart: unless-stopped 会把崩溃容器反复拉起，
# 近期新增重启过多需核对，不能拿历史累计次数持续报警。
RESTART_WARN="${RESTART_WARN:-3}"
STATE_FILE="${STATE_FILE:-/opt/flowcube/backups/.monitor.state}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
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
alert_rows=()
add_alert() { alert_rows+=("alert"$'\t'"$1"$'\t'"$2"$'\t'"$3"); }
metric() { alert_rows+=("metric"$'\t'"$1"$'\t'"$2"); }

# 1. 容器存活。名字经 resolve_container 解析：Docker 在 container_name 冲突时
#    会把容器改名为 <短id>_<原名>，硬编码名字会误报 missing（2026-08-21 事故）
for pair in "mysql:flowcube-mysql" "backend:flowcube-backend" "frontend:flowcube-frontend"; do
  svc="${pair%%:*}"; expected="${pair##*:}"
  actual=$(resolve_container "$svc" "$expected")
  st=$(docker inspect -f '{{.State.Status}}' "$actual" 2>/dev/null | tr -d '\n' || true)
  st=${st:-missing}
  [ "$st" != "running" ] && add_alert "container-$svc" critical "容器 $expected 异常($st)"
done

# 2. 磁盘使用率
use=$(df / | awk 'NR==2{gsub("%","",$5); print $5}')
if [ -n "$use" ] && [ "$use" -ge "$DISK_THRESHOLD" ]; then
  add_alert disk warning "磁盘使用率 ${use}%(阈值${DISK_THRESHOLD}%)"
fi
[[ "${use:-}" =~ ^[0-9]+$ ]] || add_alert disk-probe warning "磁盘指标查询失败或无效"

# 3. 后端健康
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>/dev/null)
code=${code:-000}
[ "$code" != "200" ] && add_alert backend critical "后端健康检查 HTTP ${code}"

# 4. MySQL 深检（P2-14）：连接可用性 + 最近 24 小时慢查询
MYSQL_CONTAINER="${MYSQL_CONTAINER:-$(resolve_container mysql flowcube-mysql)}"
if docker inspect "$MYSQL_CONTAINER" >/dev/null 2>&1; then
  if ! docker exec "$MYSQL_CONTAINER" mysqladmin ping --silent >/dev/null 2>&1; then
    add_alert mysql critical "MySQL 无法连接"
  else
    # 慢日志是历史追加文件，不能用全文件累计条数代表当前故障：旧峰值会每天重报。
    # MySQL 8 的 # Time 为 UTC ISO 时间；只数最近 24 小时，格式变化/读取失败要告警。
    if ! slow_file_state=$(docker exec "$MYSQL_CONTAINER" sh -c \
      'if test -f /var/log/mysql/slow.log; then echo present; else echo absent; fi' 2>/dev/null); then
      add_alert slow-probe warning "慢查询日志探测失败"
    elif [ "$slow_file_state" = present ]; then
      if ! slow_cutoff=$(date -u -d '24 hours ago' '+%Y-%m-%dT%H:%M:%S' 2>/dev/null \
        || date -u -v-24H '+%Y-%m-%dT%H:%M:%S' 2>/dev/null); then
        add_alert slow-window warning "慢查询时间窗口计算失败"
      elif ! slow_recent=$(docker exec "$MYSQL_CONTAINER" awk -v "cutoff=$slow_cutoff" '
        /^# Time:/ {
          stamp = $3
          if (stamp !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9](\.[0-9]+)?Z$/) invalid = 1
          else if (substr(stamp, 1, 19) >= cutoff) recent++
        }
        END { if (invalid) exit 2; print recent + 0 }
      ' /var/log/mysql/slow.log 2>/dev/null); then
        add_alert slow-read warning "慢查询日志读取或时间格式异常"
      elif [[ ! "$slow_recent" =~ ^[0-9]+$ ]]; then
        add_alert slow-count warning "慢查询日志计数无效"
      fi
    elif [ "$slow_file_state" = absent ]; then
      slow_recent=0
    elif [ "$slow_file_state" != absent ]; then
      add_alert slow-probe warning "慢查询日志探测结果无效"
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
      add_alert connections-probe warning "MySQL 连接数查询失败"
    elif [[ ! "$threads" =~ ^[0-9]+$ ]]; then
      add_alert connections-probe warning "MySQL 连接数指标无效"
    elif [ "$threads" -ge "$MAX_CONN_WARN" ]; then
      add_alert connections warning "MySQL 活跃连接 ${threads}（阈值${MAX_CONN_WARN}）"
    fi
  fi
fi

metric disk "${use:-未知}"
metric backend "$code"
metric connections "${threads:-未知}"
metric slow "${slow_recent:-未知}"
echo "[$(ts)] 最近24小时慢查询 ${slow_recent:-未知} 条（仅性能摘要，不按数量触发即时报警）"

# 当前时间戳提前计算（证书到期检查要算剩余天数；后面状态去抖也用它）
now_epoch=$(date +%s)

# 5. 公网 HTTPS 探测：与第 3 项的区别是走公网域名全链路（DNS→Caddy→backend），
#    回环检查无法发现 Caddy 挂掉、证书链异常、域名解析失败等问题
pub_code=$(curl -fsS -m 5 -o /dev/null -w '%{http_code}' "$PUBLIC_HEALTH_URL" 2>/dev/null)
pub_code=${pub_code:-000}
[ "$pub_code" != "200" ] && add_alert public critical "公网探测 HTTP ${pub_code}"

metric public "$pub_code"

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
      add_alert certificate warning "${CERT_HOST} 证书 ${days_left} 天后到期（阈值${CERT_DAYS_WARN}天）"
    fi
  else
    add_alert certificate-probe warning "${CERT_HOST} 证书到期时间解析失败"
  fi
else
  add_alert certificate-probe warning "${CERT_HOST} 证书查询失败或超时"
fi

# 7. 记录容器ID和累计次数，由公共模块计算近30分钟采样新增次数。
for pair in "mysql:flowcube-mysql" "backend:flowcube-backend" "frontend:flowcube-frontend"; do
  svc="${pair%%:*}"; expected="${pair##*:}"
  actual=$(resolve_container "$svc" "$expected")
  rc=$(docker inspect -f '{{.RestartCount}}' "$actual" 2>/dev/null | tr -d '\n' || true)
  cid=$(docker inspect -f '{{.Id}}' "$actual" 2>/dev/null | tr -d '\n' || true)
  if [[ "${rc:-}" =~ ^[0-9]+$ ]] && [ -n "$cid" ]; then
    alert_rows+=("restart"$'\t'"$svc"$'\t'"$cid"$'\t'"$rc")
  else
    add_alert "restart-probe-$svc" warning "容器 $expected 重启指标查询失败"
  fi
done

# 观察状态与已通知状态分开保存；失败不确认，下轮重试。公共模块兼容旧状态。
if ! message=$(printf '%s\n' "${alert_rows[@]}" | node "$SCRIPT_DIR/lib/ops-alerts.js" \
    monitor "$STATE_FILE" "$now_epoch" "$REMIND_HOURS" "$RESTART_WARN" "$BACKUP_DIR"); then
  dingtalk_send "$DINGTALK_WEBHOOK" "🔴 极序 Flow｜监控状态读写失败，请检查监控日志与文件权限。" || true
  exit 1
fi
if [ -n "$message" ]; then
  printf '[%s] %s\n' "$(ts)" "$message"
  if dingtalk_send "$DINGTALK_WEBHOOK" "$message"; then
    node "$SCRIPT_DIR/lib/ops-alerts.js" ack "$STATE_FILE" "$now_epoch" || exit 1
  fi
fi
