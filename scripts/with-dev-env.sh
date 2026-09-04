#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$HOME/.config/flowcube/dev-env.sh" ]]; then
  source "$HOME/.config/flowcube/dev-env.sh"
fi
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  echo '需要 Node 22。请使用项目 .nvmrc 配置版本，或准备 ~/.config/flowcube/dev-env.sh。' >&2
  exit 1
fi
if [[ $# -eq 0 ]]; then
  echo '用法：bash scripts/with-dev-env.sh <命令> [参数...]' >&2
  exit 1
fi
cd "$ROOT"
exec "$@"
