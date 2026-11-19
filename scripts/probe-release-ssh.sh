#!/usr/bin/env bash
set -euo pipefail

: "${FLOWCUBE_SSH_HOST:?缺少 SSH 主机}"
: "${FLOWCUBE_SSH_USER:?缺少 SSH 用户}"
: "${FLOWCUBE_SSH_PORT:?缺少 SSH 端口}"
: "${FLOWCUBE_WG_SERVER_IP:?缺少隧道目标}"
: "${FLOWCUBE_WG_CLIENT_IP:?缺少隧道来源}"

target="$FLOWCUBE_SSH_USER@$FLOWCUBE_SSH_HOST"
# shellcheck disable=SC2016
connection=$(timeout -k 5 35 ssh -o ConnectTimeout=20 -p "$FLOWCUBE_SSH_PORT" "$target" \
  'printf "%s\n" "$SSH_CONNECTION"')
read -r source source_port destination destination_port <<< "$connection"
if [[ "$source" != "$FLOWCUBE_WG_CLIENT_IP" || "$destination" != "$FLOWCUBE_WG_SERVER_IP" ||
      "$destination_port" != "$FLOWCUBE_SSH_PORT" || ! "$source_port" =~ ^[0-9]+$ ]]; then
  echo 'SSH 会话未使用指定的发布隧道' >&2
  exit 1
fi

# 新版 OpenSSH 的 SCP 也通过 SFTP。pwd 验证子系统，全程无需写入远端。
timeout -k 5 35 sftp -q -o ConnectTimeout=20 -P "$FLOWCUBE_SSH_PORT" -b - "$target" <<< 'pwd' >/dev/null
echo '发布隧道 SSH 和 SFTP 只读检查通过'
