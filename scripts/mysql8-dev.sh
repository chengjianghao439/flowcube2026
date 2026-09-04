#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$HOME/.config/flowcube/mysql8.env"
ACTION="${1:-start}"
case "$ACTION" in start|stop) ;; *) echo '用法：mysql8-dev.sh start|stop' >&2; exit 1 ;; esac

if [[ "$ACTION" = start ]]; then
  command -v colima >/dev/null || { echo '需要先安装 Colima。' >&2; exit 1; }
  if ! colima status flowcube >/dev/null 2>&1; then
    colima start flowcube --activate=false
  fi
  # 随机口令只保存在用户私有目录；不打印、不写进仓库。
  node - "$CONFIG" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const file = process.argv[2]
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
if (!fs.existsSync(file)) {
  const value = ['FLOWCUBE_DEV_MYSQL_ROOT_PASSWORD', 'FLOWCUBE_DEV_MYSQL_PASSWORD', 'FLOWCUBE_DEV_JWT_SECRET']
    .map(key => `${key}=${crypto.randomBytes(32).toString('hex')}`).join('\n') + '\n'
  fs.writeFileSync(file, value, { mode: 0o600, flag: 'wx' })
}
if ((fs.statSync(file).mode & 0o077) !== 0) throw new Error('MySQL 8 配置文件应仅当前用户可读（chmod 600）')
NODE
fi
[[ -f "$CONFIG" ]] || { echo '尚未初始化 MySQL 8，请先运行 npm run dev:mysql8。' >&2; exit 1; }

# context 必须是本机 Unix socket，禁止将开发容器命令发往远程服务器。
ENDPOINT="$(docker context inspect colima-flowcube --format '{{.Endpoints.docker.Host}}')"
[[ "$ENDPOINT" = unix://* ]] || { echo 'colima-flowcube 不是本机 Docker socket，已停止。' >&2; exit 1; }
COMPOSE=(docker --context colima-flowcube compose --env-file "$CONFIG" -f "$ROOT/docker-compose.dev.yml")
if [[ "$ACTION" = stop ]]; then
  "${COMPOSE[@]}" stop
  echo '独立 MySQL 8 已停止，数据卷保留。'
  exit 0
fi
"${COMPOSE[@]}" up -d --wait --wait-timeout 150

# 只对固定的独立开发库执行结构迁移，不改写现有 backend/.env。
set -a
source "$CONFIG"
set +a
cd "$ROOT"
NODE_ENV=development DB_HOST=127.0.0.1 DB_PORT=3307 DB_NAME=flowcube_dev8 DB_USER=flowcube_dev \
  DB_PASSWORD="$FLOWCUBE_DEV_MYSQL_PASSWORD" JWT_SECRET="$FLOWCUBE_DEV_JWT_SECRET" \
  npm --prefix backend run migrate
echo 'MySQL 8 已就绪：127.0.0.1:3307 / flowcube_dev8。本命令只启动数据库并执行结构迁移；后端连接以 backend/.env 及运行中进程为准。'
