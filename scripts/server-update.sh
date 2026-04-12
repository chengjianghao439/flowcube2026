#!/usr/bin/env bash
# 在「服务器上」项目根目录执行：bash scripts/server-update.sh
# 作用：拉最新代码并重建/重启后端（Docker 或本机 Node 二选一）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

wait_for_health() {
  local attempts=30
  local delay=2
  local url="http://127.0.0.1:3000/api/health"
  echo "==> 等待后端健康检查通过..."
  for ((i=1; i<=attempts; i++)); do
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS "$url" >/dev/null 2>&1; then
        echo "==> 后端健康检查通过"
        return 0
      fi
    else
      if node -e "const http=require('http');http.get('$url',res=>{process.exit(res.statusCode===200?0:1)}).on('error',()=>process.exit(1))" >/dev/null 2>&1; then
        echo "==> 后端健康检查通过"
        return 0
      fi
    fi
    sleep "$delay"
  done
  echo "!! 后端健康检查超时：$url"
  return 1
}

echo "==> 拉取代码..."
git pull --rebase --autostash origin main

if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
  echo "==> Docker：重建并启动 backend / frontend..."
  docker compose up -d --build backend frontend
  wait_for_health
  echo "==> 运行报表烟雾检查..."
  docker compose exec -T backend npm run smoke:reports
  echo "==> 运行页面烟雾检查（backend 容器内）..."
  docker compose exec -T backend env PAGE_SMOKE_BASE_URL=http://frontend node scripts/smoke-pages.node.js
  echo "==> 运行对账回跳烟雾检查（backend 容器内）..."
  docker compose exec -T backend env PAGE_SMOKE_BASE_URL=http://frontend node scripts/smoke-reconciliation-jumps.node.js
  echo "==> 完成。请确认仓库根 .env 已设置 APP_PUBLIC_URL=https://你的API域名"
  exit 0
fi

echo "==> 非 Docker：仅安装依赖，请自行重启 Node（pm2/systemd 等）"
cd backend
if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
echo "==> 请在 backend 目录配置 .env 中的 APP_PUBLIC_URL=https://你的API域名 后执行你的重启命令"
echo "    例：pm2 restart flowcube-api"
