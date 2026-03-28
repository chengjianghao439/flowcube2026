#!/usr/bin/env bash
# 将桌面安装包与 latest.json 上传到生产服务器的 downloads 目录（与 nginx/docker 中 /downloads 一致）。
#
# 用法（在已配置 SSH 免密的终端执行）：
#   export DEPLOY_HOST=47.93.228.251
#   export DEPLOY_USER=root
#   export DEPLOY_PATH=/opt/flowcube/backend/downloads   # 服务器上实际路径，须与容器/静态挂载一致
#   # 可选：export DEPLOY_PORT=22
#   # 可选：export DEPLOY_IDENTITY=~/.ssh/id_ed25519
#   bash scripts/upload-downloads-to-server.sh
#
# 若本机没有对应版本的 .exe，可设置从 GitHub Release 拉取（须能访问 github.com）：
#   export DOWNLOAD_RELEASE_TAG=v0.3.41
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${DEPLOY_HOST:?请先 export DEPLOY_HOST}"
: "${DEPLOY_USER:?请先 export DEPLOY_USER}"
: "${DEPLOY_PATH:?请先 export DEPLOY_PATH（服务器上 downloads 目录绝对路径）}"

PORT="${DEPLOY_PORT:-22}"
SSH_OPTS=(-P "$PORT" -o StrictHostKeyChecking=accept-new)
if [ -n "${DEPLOY_IDENTITY:-}" ]; then
  SSH_OPTS+=(-i "$DEPLOY_IDENTITY")
fi

LATEST="$ROOT/backend/downloads/latest.json"
if [ ! -f "$LATEST" ]; then
  echo "缺少 $LATEST"
  exit 1
fi

VERSION="$(python3 -c "import json;print(json.load(open('$LATEST'))['version'])")"
FILENAME="$(python3 -c "import json;print(json.load(open('$LATEST'))['filename'])")"
EXE_LOCAL="$ROOT/backend/downloads/$FILENAME"

if [ ! -f "$EXE_LOCAL" ]; then
  if [ -n "${DOWNLOAD_RELEASE_TAG:-}" ]; then
    URL="https://github.com/chengjianghao439/flowcube2026/releases/download/${DOWNLOAD_RELEASE_TAG}/${FILENAME}"
    echo "正在下载: $URL"
    curl -fL --retry 3 --connect-timeout 20 --max-time 600 -o "$EXE_LOCAL" "$URL"
  else
    echo "缺少安装包: $EXE_LOCAL"
    echo "请先放入该文件，或设置 DOWNLOAD_RELEASE_TAG（例如 v${VERSION}）自动从 GitHub Release 下载。"
    exit 1
  fi
fi

echo "=== SCP → ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/ ==="
scp "${SSH_OPTS[@]}" "$LATEST" "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/"
scp "${SSH_OPTS[@]}" "$EXE_LOCAL" "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/"
echo "=== 完成。请验证: curl -sS http://${DEPLOY_HOST}/downloads/latest.json ==="
