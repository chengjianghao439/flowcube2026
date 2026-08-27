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
dingtalk_send() {
  local webhook="$1" msg="$2"
  [ -z "$webhook" ] && return 0
  # 钉钉 text 消息体；msg 里的换行统一用字面 \n 由钉钉渲染
  curl -s -m 10 -H 'Content-Type: application/json' \
    -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"${msg}\"}}" \
    "$webhook" >/dev/null 2>&1 || true
}
