#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
node "$ROOT/scripts/check-node-version.cjs"
for package_dir in backend frontend desktop; do
  echo "安装 $package_dir 依赖（按 lockfile）"
  npm --prefix "$package_dir" ci --no-audit --no-fund
done
echo '依赖准备完成。开发数据库凭据需单独配置；本脚本不复制任何真实 .env。'
