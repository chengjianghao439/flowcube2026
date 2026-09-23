#!/usr/bin/env bash
set -euo pipefail
: "${FLOWCUBE_SSH_HOST:?缺少 SSH 主机}"
: "${FLOWCUBE_SSH_PORT:?缺少 SSH 端口}"
: "${FLOWCUBE_SSH_KNOWN_HOSTS:?缺少可信 FLOWCUBE_SSH_KNOWN_HOSTS，须经独立渠道核对服务器公钥}"
[[ "$FLOWCUBE_SSH_HOST" =~ ^[a-zA-Z0-9_.:-]+$ ]] || { echo 'SSH 主机格式无效' >&2; exit 1; }
[[ "$FLOWCUBE_SSH_PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$FLOWCUBE_SSH_PORT > 0 && 10#$FLOWCUBE_SSH_PORT <= 65535)) || { echo 'SSH 端口无效' >&2; exit 1; }
ssh_dir=${1:-"$HOME/.ssh"}
mkdir -p "$ssh_dir"
chmod 700 "$ssh_dir"
umask 077
candidate=$(mktemp "$ssh_dir/.trusted-hosts.XXXXXX")
config=$(mktemp "$ssh_dir/.trusted-config.XXXXXX")
trap 'rm -f "$candidate" "$config"' EXIT
printf '%s\n' "$FLOWCUBE_SSH_KNOWN_HOSTS" > "$candidate"
lookup="$FLOWCUBE_SSH_HOST"
if ((10#$FLOWCUBE_SSH_PORT != 22)); then lookup="[$FLOWCUBE_SSH_HOST]:$FLOWCUBE_SSH_PORT"; fi
# 离线检查匹配主机且存在有效公钥；不从当前网络学习身份。
matched=$(ssh-keygen -F "$lookup" -f "$candidate")
[ -n "$matched" ] || { echo '可信主机键中未找到目标主机和端口' >&2; exit 1; }
printf '%s\n' "$matched" > "$candidate"
ssh-keygen -lf "$candidate" >/dev/null
{
  printf 'Host %s\n  StrictHostKeyChecking yes\n  UserKnownHostsFile "%s/flowcube_known_hosts"\n  GlobalKnownHostsFile /dev/null\n  UpdateHostKeys no\n' "$FLOWCUBE_SSH_HOST" "$ssh_dir"
  if [ -f "$ssh_dir/config" ]; then cat "$ssh_dir/config"; fi
} > "$config"
mv "$candidate" "$ssh_dir/flowcube_known_hosts"
mv "$config" "$ssh_dir/config"
