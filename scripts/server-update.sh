#!/usr/bin/env bash
# 在「服务器上」项目根目录执行：bash scripts/server-update.sh
# 作用：拉最新代码并重建/重启后端（Docker 或本机 Node 二选一）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> 拉取代码..."
git pull origin main

if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
  echo "==> Docker：重建并启动 backend..."
  docker compose up -d --build backend
  echo "==> 完成。请确认仓库根 .env 已设置 APP_PUBLIC_URL=https://你的API域名"
  exit 0
fi

echo "==> 非 Docker：仅安装依赖，请自行重启 Node（pm2/systemd 等）"
cd backend
if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
echo "==> 请在 backend 目录配置 .env 中的 APP_PUBLIC_URL=https://你的API域名 后执行你的重启命令"
echo "    例：pm2 restart flowcube-api"
