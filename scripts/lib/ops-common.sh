#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 运维脚本公共函数（backup-db.sh / monitor.sh / daily-report.sh 共享）
#
# 本文件只定义函数，不执行副作用，供 source 使用：
#   source "$(dirname "$0")/lib/ops-common.sh"
#
# 背景（2026-08-21 事故）：MySQL 容器曾被 Docker 重命名为
# `<短id>_flowcube-mysql`（`docker compose up` 遇到 container_name 冲突时的
# 既定行为），而三个脚本都硬编码容器名 `flowcube-mysql`，导致 mysqldump 连续
# 12 天失败却无人察觉。容器名不再当作常量，一律经 resolve_container() 解析。
# ─────────────────────────────────────────────────────────────────────────────

# 解析 compose 服务对应的真实容器名。
#   用法：resolve_container <service> <期望容器名>
#   输出：真实容器名（解析不到时输出期望名，由调用方自行报错）
#
# 三级回退，容忍容器被 Docker 改名：
#   1. docker compose ps -q <service>  —— 最权威，直接问 compose 要容器 ID
#   2. 期望名精确存在                  —— compose 不可用时的常规路径
#   3. 名字以 _<期望名> 结尾的运行中容器 —— 捞被加了 hash 前缀的那个
resolve_container() {
  local service="$1" expected="$2" cid name

  # 1. 问 compose（需在 compose 项目目录下执行）
  if cid=$(docker compose ps -q "$service" 2>/dev/null) && [ -n "$cid" ]; then
    if name=$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null); then
      printf '%s\n' "${name#/}"
      return 0
    fi
  fi

  # 2. 期望名直接存在
  if docker inspect -f '{{.State.Status}}' "$expected" >/dev/null 2>&1; then
    printf '%s\n' "$expected"
    return 0
  fi

  # 3. 被 Docker 加了 hash 前缀（<短id>_<原名>）
  name=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E "_${expected}\$" | head -1)
  if [ -n "$name" ]; then
    printf '%s\n' "$name"
    return 0
  fi

  printf '%s\n' "$expected"
  return 1
}

# 读取钉钉 webhook（敏感信息只存 .env，不入库）。
#   用法：webhook=$(read_dingtalk_webhook "$PROJECT_DIR")
read_dingtalk_webhook() {
  local project_dir="${1:-/opt/flowcube}"
  if [ -n "${DINGTALK_WEBHOOK:-}" ]; then
    printf '%s\n' "$DINGTALK_WEBHOOK"
    return 0
  fi
  if [ -f "$project_dir/.env" ]; then
    grep -E '^DINGTALK_WEBHOOK=' "$project_dir/.env" 2>/dev/null | head -1 | cut -d= -f2- || true
  fi
}

# 推送到钉钉的消息/日志统一时间戳（2026-08-27 部署时发现缺失：ops-common.sh 里没有
# ts() 定义，而 server-update.sh 的 fail_deploy 经公共库调 $(ts) 会 command not found，
# 部署失败告警的时间戳缺失。各运维脚本内置的同名 ts() 会覆盖此定义，行为不变）
ts() { date '+%Y-%m-%d %H:%M:%S'; }

# 推送钉钉文本消息；未配置 webhook 时静默跳过（仍由调用方写日志）。
#   用法：dingtalk_send "$webhook" "消息内容"
# JSON 字符串净化（2026-09-18 审计）：钉钉 text 消息体是手工拼接的 JSON，消息里的引号/反斜杠
# 会让整个请求体非法、钉钉直接拒绝。旧实现把这种失败一起吞掉，等于告警静默失效。
# 采用与 restore-check.sh 一致的「剥离」策略（去引号/反斜杠、换行折叠、截断），
# 保证任何调用方送进来的文本都能变成合法 JSON 字符串。
#   用法：json_escape "文本" [最大长度，默认 500]
json_escape() {
  printf '%s' "$1" | tr '\n\r\t' '   ' | sed 's/["\\]//g' | cut -c1-"${2:-500}"
}

# 推送钉钉文本消息。
#   用法：dingtalk_send "$webhook" "消息内容"
#   返回：0 = 钉钉已确认接收（errcode=0）；1 = 发送失败或钉钉拒绝；
#         2 = 未配置 webhook（**刻意不算失败**，这是部署方的配置选择，避免 cron 空报错）
#
# 2026-09-18 审计修复：旧实现是 `curl ... >/dev/null 2>&1 || true`——**任何失败都返回 0**，
# webhook 写错、被限流、网络不通对外全都表现为「已发送」。这正是「备份连续 12 天失败无人
# 察觉」的同一条路径。现在校验 HTTP 状态码与响应体里的 errcode，失败写 stderr 并非 0 返回，
# 由调用方决定是否升级；未配置时打 WARN 而不是静默跳过。
dingtalk_send() {
  local webhook="$1" msg="$2"
  if [ -z "$webhook" ]; then
    echo "[$(ts)] [WARN] 未配置钉钉 webhook，告警未发送（见 .env.example 的 DINGTALK_WEBHOOK）：${msg}" >&2
    return 2
  fi
  local body resp http_code payload
  body="$(json_escape "$msg" 500)"
  # 末行是 HTTP 状态码，其余是响应体
  if ! resp="$(curl -s -m 10 -w '\n%{http_code}' -H 'Content-Type: application/json' \
      -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"${body}\"}}" \
      "$webhook" 2>/dev/null)"; then
    echo "[$(ts)] [ERROR] 钉钉告警发送失败（curl 未能完成，检查网络与 webhook 可达性）：${msg}" >&2
    return 1
  fi
  http_code="$(printf '%s' "$resp" | tail -n1)"
  payload="$(printf '%s' "$resp" | sed '$d')"
  case "$http_code" in
    2*) ;;
    *) echo "[$(ts)] [ERROR] 钉钉告警 HTTP ${http_code}：${payload}" >&2; return 1 ;;
  esac
  # 钉钉即使 HTTP 200 也会用 errcode 表达业务失败（如 invalid webhook / 限流）
  case "$payload" in
    *'"errcode":0'*) return 0 ;;
    *) echo "[$(ts)] [ERROR] 钉钉告警被拒：${payload}" >&2; return 1 ;;
  esac
}
