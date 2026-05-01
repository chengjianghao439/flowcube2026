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

ensure_docker_space() {
  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi
  local avail_mb
  avail_mb="$(df -Pm / | awk 'NR==2 {print $4}')"
  if [ "${avail_mb:-0}" -lt 2500 ]; then
    echo "==> Docker 磁盘空间偏低，预先清理 builder cache / 未使用镜像..."
    docker builder prune -af >/dev/null
    docker image prune -af >/dev/null
  fi
}

SKIP_GIT_PULL="${SKIP_GIT_PULL:-0}"
if [ "$SKIP_GIT_PULL" = "1" ]; then
  CURRENT_COMMIT="$(git rev-parse HEAD)"
  EXPECTED_DEPLOY_COMMIT="${EXPECTED_COMMIT:-${GITHUB_SHA:-}}"
  echo "!! WARNING: 当前处于跳过 git pull 模式（SKIP_GIT_PULL=1）"
  echo "!! WARNING: 该模式仅建议 CI / GitHub Actions 在已精确 checkout/reset 到发布提交后使用"
  echo "==> 当前服务器代码 commit: $CURRENT_COMMIT"
  if [ -n "$EXPECTED_DEPLOY_COMMIT" ]; then
    echo "==> 期望部署 commit: $EXPECTED_DEPLOY_COMMIT"
    if [ "$CURRENT_COMMIT" != "$EXPECTED_DEPLOY_COMMIT" ]; then
      echo "!! WARNING: 当前 commit 与期望 commit 不一致；继续部署可能会重建错误版本"
    fi
  else
    echo "!! WARNING: 未提供 EXPECTED_COMMIT 或 GITHUB_SHA，无法校验跳过 pull 后的部署提交是否正确"
  fi
else
  echo "==> 拉取代码..."
  git pull --rebase --autostash origin main
fi

SKIP_RELEASE_GATE="${SKIP_RELEASE_GATE:-0}"

if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
  ensure_docker_space
  echo "==> Docker：重建并启动 backend / frontend..."
  docker compose up -d --build backend frontend
  wait_for_health
  if [ "$SKIP_RELEASE_GATE" = "1" ]; then
    echo "==> 已跳过发布门禁（SKIP_RELEASE_GATE=1）"
  else
    echo "==> 运行发布门禁..."
    bash scripts/release-gate.sh
  fi
  echo "==> 完成。请确认仓库根 .env 已设置 APP_PUBLIC_URL=https://你的API域名"
  exit 0
fi

echo "==> 非 Docker：仅安装依赖，请自行重启 Node（pm2/systemd 等）"
cd backend
if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
echo "==> 请在 backend 目录配置 .env 中的 APP_PUBLIC_URL=https://你的API域名 后执行你的重启命令"
echo "    例：pm2 restart flowcube-api"
