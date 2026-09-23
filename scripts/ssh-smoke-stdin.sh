#!/usr/bin/env bash
# 最后一个参数是无口令的远程命令；stdin 是部署脚本，四个口令字段走 NUL 分隔流。
set -euo pipefail
: "${SMOKE_USERNAME:?缺少 SMOKE_USERNAME}"
: "${SMOKE_PASSWORD:?缺少 SMOKE_PASSWORD}"
: "${SMOKE_LIMITED_USERNAME:?缺少 SMOKE_LIMITED_USERNAME}"
: "${SMOKE_LIMITED_PASSWORD:?缺少 SMOKE_LIMITED_PASSWORD}"
(($# >= 2)) || exit 2
args=("$@")
command=${args[${#args[@]}-1]}
unset 'args[${#args[@]}-1]'
bootstrap='set -euo pipefail
for name in SMOKE_USERNAME SMOKE_PASSWORD SMOKE_LIMITED_USERNAME SMOKE_LIMITED_PASSWORD; do
  IFS= read -r -d "" "$name"
  [ -n "${!name}" ]
  export "$name"
done
exec bash -c "$1"'
printf -v wrapped '%q ' bash -c "$bootstrap" flowcube-smoke "$command"
{ printf '%s\0' "$SMOKE_USERNAME" "$SMOKE_PASSWORD" "$SMOKE_LIMITED_USERNAME" "$SMOKE_LIMITED_PASSWORD"; cat; } | ssh "${args[@]}" "$wrapped"
