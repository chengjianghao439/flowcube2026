#!/usr/bin/env bash
# 服务器部署：构建/迁移先于应用切换；失败统一恢复旧应用镜像并验证健康。
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SCRIPT_DIR="$ROOT/scripts"
PROJECT_DIR="${PROJECT_DIR:-$ROOT}"
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/flowcube-deploy.lock}"
LOCK_TIMEOUT="${DEPLOY_LOCK_TIMEOUT:-1800}"

# CI 在 checkout/reset 前持同一把锁，并把已打开的 fd 9 传给本脚本。
if [ "${DEPLOY_LOCK_FD:-}" = "9" ]; then
  flock -n 9 || { echo '!! 无法继承部署锁 fd 9' >&2; exit 1; }
else
  exec 9>"$LOCK_FILE"
  flock -w "$LOCK_TIMEOUT" 9 || { echo '!! 等待部署锁超时' >&2; exit 1; }
fi
trap 'DEPLOY_EXIT_CODE=$?; flock -u 9; exit "$DEPLOY_EXIT_CODE"' EXIT
echo "==> 获得部署锁，开始部署（PID $$）"
. "$SCRIPT_DIR/lib/ops-common.sh"

DOCKER_DEPLOY=0
APPLICATION_SWITCHED=0
PREVIOUS_BACKEND_IMAGE=''
PREVIOUS_FRONTEND_IMAGE=''
ROLLBACK_RESULT='应用容器未切换'

wait_for_health() {
  local attempts="${HEALTH_CHECK_ATTEMPTS:-30}" delay="${HEALTH_CHECK_DELAY:-2}" i
  for ((i=1; i<=attempts; i++)); do
    if curl -fsS --max-time 5 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then return 0; fi
    sleep "$delay"
  done
  echo '!! 后端健康检查超时' >&2
  return 1
}

wait_for_frontend() {
  local attempts="${HEALTH_CHECK_ATTEMPTS:-30}" delay="${HEALTH_CHECK_DELAY:-2}" i html
  for ((i=1; i<=attempts; i++)); do
    if html=$(curl -fsS --max-time 5 http://127.0.0.1:8080/) && [[ "$html" == *'<title>极序 Flow</title>'* ]]; then return 0; fi
    sleep "$delay"
  done
  echo '!! 前端响应检查超时' >&2
  return 1
}

rollback_deployment() {
  [ "$DOCKER_DEPLOY" = '1' ] || return 0
  local failed=0 services=() legacy_manifest
  # 首次回退可能仍是只认识 version.json 的旧镜像；该旧 API 已支持 filename。
  # published 指向实际已发布的不可变包，不能让 Git 目标版本配上旧固定 APK。
  if [ -f backend/apk/published-version.json ]; then
    legacy_manifest=$(mktemp backend/apk/.publish-pda-XXXXXX) || failed=1
    if [ -n "${legacy_manifest:-}" ]; then
      if cp backend/apk/published-version.json "$legacy_manifest" && chmod 644 "$legacy_manifest" && mv "$legacy_manifest" backend/apk/version.json; then :
      else failed=1; rm -f "$legacy_manifest"; fi
    fi
  fi
  if [ -n "$PREVIOUS_BACKEND_IMAGE" ]; then
    docker tag "$PREVIOUS_BACKEND_IMAGE" flowcube-backend:latest || failed=1
    services+=(backend)
  elif [ "$APPLICATION_SWITCHED" = '1' ]; then
    docker compose rm -s -f backend || failed=1
  fi
  if [ -n "$PREVIOUS_FRONTEND_IMAGE" ]; then
    docker tag "$PREVIOUS_FRONTEND_IMAGE" flowcube-frontend:latest || failed=1
    services+=(frontend)
  elif [ "$APPLICATION_SWITCHED" = '1' ]; then
    docker compose rm -s -f frontend || failed=1
  fi
  if [ "${#services[@]}" -gt 0 ]; then
    if [ "$APPLICATION_SWITCHED" = '1' ]; then
      docker compose up -d --no-build --no-deps --force-recreate "${services[@]}" || failed=1
    fi
    if [ -n "$PREVIOUS_BACKEND_IMAGE" ]; then wait_for_health || failed=1; fi
    if [ -n "$PREVIOUS_FRONTEND_IMAGE" ]; then wait_for_frontend || failed=1; fi
    ROLLBACK_RESULT='已恢复部署前应用镜像并检查健康；数据库迁移未回滚'
  else
    ROLLBACK_RESULT='首次部署没有旧应用镜像；本次应用容器已停止或尚未启动'
  fi
  if [ "$failed" != '0' ]; then
    ROLLBACK_RESULT='应用回退或回退后健康检查失败，需要人工恢复；数据库迁移未回滚'
    return 1
  fi
}

fail_deploy() {
  local reason="$1"
  trap - ERR
  rollback_deployment || true
  echo "!! 部署失败：${reason}；${ROLLBACK_RESULT}" >&2
  dingtalk_send "$(read_dingtalk_webhook "$PROJECT_DIR")" "🔴 FlowCube 部署失败（$(ts)）：${reason}；${ROLLBACK_RESULT}"
  exit 1
}
trap 'fail_deploy "第 ${LINENO} 行执行失败（exit=$?）"' ERR

assert_expected_commit() {
  local expected="${EXPECTED_COMMIT:-${GITHUB_SHA:-}}" current
  [ -n "$expected" ] || fail_deploy '部署必须提供通过门禁的 EXPECTED_COMMIT'
  if [ -n "$expected" ]; then
    [[ "$expected" =~ ^[a-fA-F0-9]{40}$ ]] || fail_deploy 'EXPECTED_COMMIT 格式无效'
    current=$(git rev-parse HEAD)
    [ "$current" = "$expected" ] || fail_deploy '服务器提交与通过门禁的提交不一致'
  fi
}

expected="${EXPECTED_COMMIT:-${GITHUB_SHA:-}}"
[[ "$expected" =~ ^[a-fA-F0-9]{40}$ ]] || fail_deploy '必须提供合法 EXPECTED_COMMIT'
# CI 已在连接服务器之前检查，只有它继承已持有的 fd 9；人工入口重新查询 GitHub。
if [ "${DEPLOY_LOCK_FD:-}" != '9' ]; then
  GITHUB_REF=refs/heads/main GITHUB_SHA="$expected" node scripts/wait-release-checks.js
fi
if [ "${SKIP_GIT_PULL:-0}" != '1' ]; then git pull --rebase --autostash origin main; fi
assert_expected_commit

if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
  DOCKER_DEPLOY=1
  # 保存容器真正运行的 image ID，不能假设 latest 仍指向旧镜像。
  backend_id=$(docker compose ps -aq backend)
  frontend_id=$(docker compose ps -aq frontend)
  if [ -n "$backend_id" ]; then PREVIOUS_BACKEND_IMAGE=$(docker inspect -f '{{.Image}}' "$backend_id"); fi
  if [ -n "$frontend_id" ]; then PREVIOUS_FRONTEND_IMAGE=$(docker inspect -f '{{.Image}}' "$frontend_id"); fi

  echo '==> 构建新应用镜像（旧应用仍在运行）...'
  docker compose build backend frontend
  assert_expected_commit
  docker compose up -d --no-build --wait --wait-timeout 120 mysql
  echo '==> 用新镜像的一次性容器执行迁移...'
  docker compose run --rm --no-deps backend npm run migrate
  assert_expected_commit

  echo '==> 切换 backend / frontend...'
  APPLICATION_SWITCHED=1
  docker compose up -d --no-build backend frontend
  wait_for_health
  wait_for_frontend
  if [ "${SKIP_RELEASE_GATE:-0}" = '1' ]; then
    echo '!! 已显式跳过页面门禁；常规 CI 部署不可使用此选项'
  else
    PRESERVE_DEPLOY_IMAGES=1 bash scripts/release-gate.sh
  fi

  # 公网证书/页面检查也在部署事务内，失败走同一回退路径。
  if [ -n "${DEPLOY_PUBLIC_ORIGIN:-}" ]; then
    [[ "$DEPLOY_PUBLIC_ORIGIN" == https://* ]] || fail_deploy '公网部署地址必须使用 HTTPS'
    curl -fsS --max-time 20 "${DEPLOY_PUBLIC_ORIGIN%/}/api/health" >/dev/null
    public_html=$(curl -fsS --max-time 20 "${DEPLOY_PUBLIC_ORIGIN%/}/")
    [[ "$public_html" == *'<title>极序 Flow</title>'* ]] || fail_deploy '公网前端页面检查失败'
  fi
  assert_expected_commit
  bash scripts/install-cron.sh >/dev/null 2>&1 || echo '!! cron 同步失败，请手动检查'
  echo '==> 部署完成，健康检查与发布门禁已通过'
  exit 0
fi

echo '==> 非 Docker：安装依赖并迁移，进程重启由现有进程管理器负责'
cd backend
if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
npm run migrate
echo '==> 请通过现有 pm2/systemd 重启并验证；本分支不提供自动镜像回退'
