#!/usr/bin/env bash
# 生成本机与 GitHub Actions 共用的 deploy key，并为本机写入 SSH Host 别名。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"

KEY_PATH="${DEPLOY_KEY_PATH:-$HOME/.ssh/flowcube_deploy_ed25519}"
HOST_ALIAS="${DEPLOY_HOST_ALIAS:-flowcube-prod}"
HOST_NAME="$(node scripts/read-deploy-config.js server.host)"
HOST_USER="$(node scripts/read-deploy-config.js server.user)"
HOST_PORT="$(node scripts/read-deploy-config.js server.sshPort)"

if [ ! -f "$KEY_PATH" ]; then
  ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "flowcube-deploy@$(hostname)"
  chmod 600 "$KEY_PATH"
  chmod 644 "${KEY_PATH}.pub"
  echo "==> 已生成 deploy key: $KEY_PATH"
else
  echo "==> 复用现有 deploy key: $KEY_PATH"
fi

CONFIG_FILE="$HOME/.ssh/config"
touch "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"

if ! grep -q "^Host ${HOST_ALIAS}$" "$CONFIG_FILE" 2>/dev/null; then
  cat >> "$CONFIG_FILE" <<EOF

Host ${HOST_ALIAS}
  HostName ${HOST_NAME}
  User ${HOST_USER}
  Port ${HOST_PORT}
  IdentityFile ${KEY_PATH}
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
  echo "==> 已写入 ~/.ssh/config Host ${HOST_ALIAS}"
else
  echo "==> ~/.ssh/config 已存在 Host ${HOST_ALIAS}，保留现有配置"
fi

echo
echo "==> 下一步："
echo "1. 把下面这把公钥追加到服务器 ~/.ssh/authorized_keys"
echo "2. 把私钥内容填入 GitHub Actions Secret: SSH_PRIVATE_KEY"
echo
echo "----- BEGIN FLOWCUBE DEPLOY PUBLIC KEY -----"
cat "${KEY_PATH}.pub"
echo
echo "----- END FLOWCUBE DEPLOY PUBLIC KEY -----"
