#!/usr/bin/env bash
# 仅测试机使用官方旧CLI；不安装系统插件、不连接生产、不升级Compose。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) asset=docker-compose-darwin-aarch64; checksum=83c6527089f438599f82e9ea97f60af206d241159df8c12a408f4a459d9ddae3 ;;
  Darwin/x86_64) asset=docker-compose-darwin-x86_64; checksum=c4affd2981e5a91c34076f8e1231be79f9c96d82397874db5a4f72a5398585c0 ;;
  Linux/x86_64) asset=docker-compose-linux-x86_64; checksum=f3ba3bf1e4ab18e96c2d36526a075a02a78fb5f8e80d3e3ca9c5bf256d81d0a0 ;;
  Linux/aarch64) asset=docker-compose-linux-aarch64; checksum=37a1c197fef5fda2a3df2d5ae0d7762ad2a00e30946ad06d4ad9fa8cef16d9e7 ;;
  *) echo '不支持的测试机平台，不能跳过Compose兼容性检查' >&2; exit 1 ;;
esac
temp_dir=''
cleanup() { if [ -n "$temp_dir" ]; then rm -rf "$temp_dir"; fi; }
trap cleanup EXIT
if [ -z "${FLOWCUBE_COMPAT_COMPOSE_BIN:-}" ]; then
  temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/flowcube-compose227-cli-XXXXXXXX")
  FLOWCUBE_COMPAT_COMPOSE_BIN="$temp_dir/$asset"
  curl -fsSL --retry 2 --max-time 180 "https://github.com/docker/compose/releases/download/v2.27.0/$asset" -o "$FLOWCUBE_COMPAT_COMPOSE_BIN"
fi
actual=$(shasum -a 256 "$FLOWCUBE_COMPAT_COMPOSE_BIN")
[ "${actual%% *}" = "$checksum" ] || { echo '官方Compose2.27.0二进制摘要不符，拒绝执行' >&2; exit 1; }
chmod u+x "$FLOWCUBE_COMPAT_COMPOSE_BIN"
export FLOWCUBE_COMPAT_COMPOSE_BIN
cd "$ROOT"
node --test tests/compose-preflight-compat.test.js
