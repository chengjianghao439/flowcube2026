#!/usr/bin/env bash
# 在 CI 中交付同一份 APK/EXE：HTTPS 或受信中转优先，完整性门禁相同，失败回退 SCP。
set -euo pipefail
file="${1:?missing local artifact}"; target="${2:?missing SSH target}"
port="${3:?missing SSH port}"; destination="${4:?missing remote artifact}"
[[ "$destination" == /tmp/* && "$destination" != *"'"* ]] || exit 2
base=$(basename "$file")
[[ "$base" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || exit 2
sha=$(node -e 'const fs=require("fs"),c=require("crypto"); console.log(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$file")
bytes=$(node -e 'console.log(require("fs").statSync(process.argv[1]).size)' "$file")
helper="/tmp/flowcube-asset-receiver-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}.py"
opts=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ServerAliveCountMax=6)
cleanup() {
  timeout -k 5 30 ssh "${opts[@]}" -p "$port" "$target" \
    "rm -f '$helper' '$destination.relay.pending' '$destination.relay.partial' '$destination.relay'" >/dev/null 2>&1 || true
}
trap cleanup EXIT
printf -v receive_command '%q ' python3 "$helper" "$destination" "$sha" "$bytes" "$base"
if [ -n "${DEPLOY_ARTIFACT_ID:-}" ] && timeout -k 5 30 scp "${opts[@]}" -P "$port" scripts/receive-deploy-artifact.py "$target:$helper"; then
  if node scripts/deploy-artifact-url.js | timeout -k 10 500 ssh "${opts[@]}" -p "$port" "$target" "$receive_command"; then
    exit 0
  fi
fi
echo '::warning::安装包 HTTPS/中转不可用，回退 SCP'
timeout -k 10 1800 scp "${opts[@]}" -P "$port" "$file" "$target:$destination"
# SCP 也核对同一 runner 摘要，不仅依赖传输协议成功。
printf -v verify_command "test \"\$(sha256sum %q | cut -d ' ' -f1)\" = %q" "$destination" "$sha"
timeout -k 5 120 ssh "${opts[@]}" -p "$port" "$target" "$verify_command"
