#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$HOME/.config/flowcube/dev-env.sh" ]]; then
  source "$HOME/.config/flowcube/dev-env.sh"
fi
if ! command -v node >/dev/null 2>&1; then
  echo '找不到 Node。请按 .nvmrc 安装或加载项目开发环境。' >&2
  exit 1
fi
node "$ROOT/scripts/check-node-version.cjs"
if [[ $# -eq 0 ]]; then
  echo '用法：bash scripts/with-dev-env.sh <命令> [参数...]' >&2
  exit 1
fi
cd "$ROOT"
exec "$@"
