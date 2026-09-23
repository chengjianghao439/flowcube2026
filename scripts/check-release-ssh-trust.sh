#!/usr/bin/env bash
# 在 push 前用 CI 的主机名/端口检查仓库变量，不修改本机 SSH 配置。
set -euo pipefail
: "${GITHUB_REPOSITORY:?缺少 GitHub 仓库}"

host="$(node scripts/read-deploy-config.js server.host)"
port="$(node scripts/read-deploy-config.js server.sshPort)"
if ! known_hosts="$(gh variable get FLOWCUBE_SSH_KNOWN_HOSTS --repo "$GITHUB_REPOSITORY")" || [ -z "$known_hosts" ]; then
  echo '!! 无法读取 CI 可信主机键变量 FLOWCUBE_SSH_KNOWN_HOSTS，拒绝发布' >&2
  exit 1
fi

trust_dir="$(mktemp -d "${TMPDIR:-/tmp}/flowcube-ssh-trust.XXXXXX")"
trap 'rm -rf -- "$trust_dir"' EXIT
if ! FLOWCUBE_SSH_HOST="$host" FLOWCUBE_SSH_PORT="$port" FLOWCUBE_SSH_KNOWN_HOSTS="$known_hosts" \
    bash scripts/setup-ci-ssh-trust.sh "$trust_dir" >/dev/null; then
  echo '!! CI 可信主机键中未找到部署配置的目标主机/端口，拒绝发布' >&2
  exit 1
fi
echo '==> CI SSH 主机键与部署目标匹配'
