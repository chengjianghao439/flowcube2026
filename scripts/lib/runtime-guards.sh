#!/usr/bin/env bash
# 显式 source 才启用；给 Docker 客户端请求加时限，不做整盘统计或自动清理。
TIMEOUT_BIN="$(type -P timeout || type -P gtimeout || true)"
DOCKER_BIN="$(type -P docker || true)"
if [ -z "$TIMEOUT_BIN" ] || [ -z "$DOCKER_BIN" ]; then
  echo '!! 需要 Docker 和 GNU timeout（macOS 可安装 coreutils）；拒绝无时限执行' >&2
  exit 1
fi
bounded() {
  local seconds="$1"
  shift
  # 外层部署 deadline 必须能同时结束等待中的 CLI，让 Bash 执行回退 trap。
  # 独立监控保持 timeout 的默认独立组，单次超时时一起结束其子进程。
  if [ "${FLOWCUBE_DEPLOY_TIMEOUT_GROUP:-0}" = '1' ] || [ "${FLOWCUBE_TIMEOUT_GROUP:-0}" = '1' ]; then
    "$TIMEOUT_BIN" --foreground -k 10 "$seconds" "$@"
  else
    "$TIMEOUT_BIN" -k 10 "$seconds" "$@"
  fi
}
docker() { bounded "${DOCKER_COMMAND_TIMEOUT:-30}" "$DOCKER_BIN" "$@"; }
