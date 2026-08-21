#!/usr/bin/env bash
# 在「服务器上」项目根目录执行：bash scripts/server-update.sh
# 作用：拉最新代码并重建/重启后端（Docker 或本机 Node 二选一）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 部署互斥锁（2026-08-11 并发踩踏事故修复）：同一台服务器同一时刻只允许一个部署进程。
# 场景：CI Deploy + 手动部署同时跑，多个 `docker compose up --build` 并发互相抢容器，
# 谁也无法完成重建。flock 让后来的进程等待（最长 DEPLOY_LOCK_TIMEOUT 秒），前一个完成才继续。
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/flowcube-deploy.lock}"
LOCK_TIMEOUT="${DEPLOY_LOCK_TIMEOUT:-1800}"   # 默认等 30 分钟（构建镜像通常 5-10 分钟）
exec 9>"$LOCK_FILE"
if ! flock -w "$LOCK_TIMEOUT" 9; then
  echo "!! 上一个部署仍在进行（$LOCK_FILE），等待超过 ${LOCK_TIMEOUT}s 仍未获得锁，放弃本次部署"
  echo "!! 若确认无部署在跑，可删除锁文件后重试：rm -f $LOCK_FILE"
  exit 1
fi
echo "==> 获得部署锁，开始部署（PID $$）"
trap 'echo "==> 部署结束，释放锁"; flock -u 9' EXIT

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
  # 迁移回滚兜底（2026-08-21 审计修复）：记录当前运行镜像 tag，migrate 失败时
  # 回滚到旧镜像，避免「新代码跑在旧 schema 上」的半死状态。
  ROLLBACK_TAG="flowcube-backend:rollback-$(date +%s)"
  docker tag flowcube-backend:latest "$ROLLBACK_TAG" 2>/dev/null || true
  docker compose up -d --build backend frontend
  # 数据库迁移是显式步骤（后端不在启动时自动迁移）。
  # 必须在容器重建后、用新镜像里的迁移文件执行，否则新代码会跑在旧表结构上。
  # 失败即中断部署（set -e）——宁可部署失败并告警，也不要静默上线一个坏 schema。
  echo "==> 执行数据库迁移（应用本次发布新增的迁移文件）..."
  if ! docker compose exec -T backend npm run migrate; then
    echo "!! 迁移失败，回滚 backend 到旧镜像 $ROLLBACK_TAG ..." >&2
    docker compose up -d --no-build --force-recreate backend --quiet-pull 2>/dev/null || true
    # force-recreate 用当前 compose 配置的镜像（latest）重建——先回退 tag 再重建
    docker tag "$ROLLBACK_TAG" flowcube-backend:latest 2>/dev/null || true
    docker compose up -d --no-build --force-recreate backend || true
    echo "!! 回滚完成，请检查服务状态与告警" >&2
    exit 1
  fi
  wait_for_health
  if [ "$SKIP_RELEASE_GATE" = "1" ]; then
    echo "==> 已跳过发布门禁（SKIP_RELEASE_GATE=1）"
  else
    echo "==> 运行发布门禁..."
    bash scripts/release-gate.sh
  fi
  # 运维 cron 同步（2026-08-21 审计 F 修复）：install-cron.sh 的改动不会自动生效，
  # 此前需手动跑。部署后幂等核对一次（新增任务会装上，已有任务跳过）。
  echo "==> 同步运维 cron（幂等）..."
  bash scripts/install-cron.sh >/dev/null 2>&1 || echo "!! cron 同步失败（不影响部署，请手动检查）"
  echo "==> 完成。请确认仓库根 .env 已设置 APP_PUBLIC_URL=https://你的API域名"
  exit 0
fi

echo "==> 非 Docker：仅安装依赖，请自行重启 Node（pm2/systemd 等）"
cd backend
if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
echo "==> 执行数据库迁移..."
npm run migrate
echo "==> 请在 backend 目录配置 .env 中的 APP_PUBLIC_URL=https://你的API域名 后执行你的重启命令"
echo "    例：pm2 restart flowcube-api"
