#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  echo '请通过 npm run dev:setup 使用 Node 22 安装依赖。' >&2
  exit 1
fi
for package_dir in backend frontend desktop; do
  echo "安装 $package_dir 依赖（按 lockfile）"
  npm --prefix "$package_dir" ci --no-audit --no-fund
done
echo '依赖准备完成。开发数据库凭据需单独配置；本脚本不复制任何真实 .env。'
