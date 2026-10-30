#!/usr/bin/env bash
# 服务器只加载 CI 镜像、迁移和切换；失败停止并保留证据，不自动回退或改数据库全局参数。
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
MIGRATION_CONTAINER=''
MIGRATION_STARTED=0
MIGRATION_COMPLETED=0
DEPLOY_PHASE='前置检查'
backup_run_dir=''
PREFLIGHT_OVERRIDE=''
PREFLIGHT_CONTAINER=''

wait_for_health() {
  local attempts="${HEALTH_CHECK_ATTEMPTS:-30}" delay="${HEALTH_CHECK_DELAY:-2}" i endpoint="${1:-/api/ready}"
  for ((i=1; i<=attempts; i++)); do
    if curl -fsS --max-time 5 "http://127.0.0.1:3000${endpoint}" >/dev/null 2>&1; then return 0; fi
    sleep "$delay"
  done
  echo '!! 后端业务就绪检查超时' >&2
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

assert_mysql_ready() {
  local mysql_id="$1" mysql_state sql_result
  mysql_state=$(DOCKER_COMMAND_TIMEOUT=5 docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$mysql_id") || return 1
  [ "$mysql_state" = 'running healthy' ] || return 1
  # The image healthcheck can accept a temporary socket-only server or denied
  # authentication. Require TCP and SQL on this exact container; secrets expand
  # only inside it, never into host arguments or deployment output.
  sql_result=$(DOCKER_COMMAND_TIMEOUT=5 docker exec "$mysql_id" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=TCP -h127.0.0.1 -P3306 --connect-timeout=2 -uroot --database="$MYSQL_DATABASE" --batch --skip-column-names -e "SELECT 1"' 2>/dev/null) || return 1
  [ "$sql_result" = '1' ]
}

ensure_mysql_ready() {
  local mysql_id mysql_image attempt deadline
  mysql_id=$(docker compose ps -aq mysql) || fail_deploy '无法核实 MySQL 容器，业务保持原状态'
  [[ "$mysql_id" != *$'\n'* ]] || fail_deploy 'MySQL 存在多个容器，须维护窗口核对；不自动恢复或重建'
  if [ -n "$mysql_id" ]; then
    assert_mysql_ready "$mysql_id" || fail_deploy '现有 MySQL 未同时通过 running/healthy 与 TCP 认证 SQL，须维护窗口核对；不自动恢复或重建'
    echo '==> 保留现有 MySQL 容器，健康与 TCP 认证 SQL 已通过'
    return 0
  fi
  # A routine application deployment never reconciles a running database with
  # a newer Compose pin. Only first start may use the declared locally cached pin.
  mysql_image=$(docker compose config --images mysql) || fail_deploy '无法读取首次启动的 MySQL 固定镜像引用'
  [[ "$mysql_image" =~ ^[a-zA-Z0-9._/:+-]+@sha256:[a-f0-9]{64}$ ]] || fail_deploy '首次启动 MySQL 必须声明唯一固定摘要镜像'
  docker image inspect "$mysql_image" >/dev/null 2>&1 || fail_deploy '本机缺少首次启动 MySQL 的固定镜像，请在维护窗口预装；部署期间禁止联网拉取或降级 tag'
  DOCKER_COMMAND_TIMEOUT=150 docker compose up -d --no-build --no-deps --pull never --wait --wait-timeout 120 mysql
  mysql_id=$(docker compose ps -aq mysql) || fail_deploy '无法核实首次启动后的 MySQL 容器'
  [ -n "$mysql_id" ] && [[ "$mysql_id" != *$'\n'* ]] || fail_deploy '首次启动后须存在唯一 MySQL 容器'
  # Initial image health can precede final TCP/auth readiness. This bounded wait
  # only observes the first-started container; it never starts or repairs it again.
  deadline=$((SECONDS + 30))
  for ((attempt=1; attempt<=15; attempt++)); do
    if assert_mysql_ready "$mysql_id"; then return 0; fi
    if [ "$attempt" -ge 15 ] || [ "$SECONDS" -ge "$deadline" ]; then break; fi
    sleep 2
  done
  fail_deploy '首次启动 MySQL 未通过健康与 TCP 认证 SQL，须维护窗口核对；不自动恢复或重建'
}

# 仅查询现有配置；发布脚本不修改数据库全局参数或权限。
assert_migration_conditions() {
  PREFLIGHT_OVERRIDE=$(mktemp "$ROOT/.migration-preflight-XXXXXXXX.yml") || fail_deploy '无法创建迁移条件预检配置'
  # Compose 2.27.0 的 run 没有 --pull；在服务层禁止拉取并移除继承的 build。
  # 候选镜像已在前面加载并按 SHA 验证；缺失时只能失败，不能改为联网拉取/宿主构建。
  printf 'services:\n  backend:\n    image: flowcube-backend:%s\n    pull_policy: never\n    build: !reset null\n    read_only: true\n' "$expected" > "$PREFLIGHT_OVERRIDE"
  PREFLIGHT_CONTAINER="flowcube-preflight-$$-$(date +%s)"
  DOCKER_COMMAND_TIMEOUT=60 docker compose -f "$ROOT/docker-compose.yml" -f "$PREFLIGHT_OVERRIDE" run --rm --no-deps --name "$PREFLIGHT_CONTAINER" --user node --entrypoint node backend scripts/migration-preflight.js \
    || fail_deploy '数据库迁移条件只读预检失败；保持原应用，不修改全局参数'
  PREFLIGHT_CONTAINER=''
  rm -f "$PREFLIGHT_OVERRIDE"
  PREFLIGHT_OVERRIDE=''
}

fail_deploy() {
  local reason="$1"
  trap - ERR INT TERM HUP
  if [ -n "$PREFLIGHT_CONTAINER" ]; then
    DOCKER_COMMAND_TIMEOUT=20 docker rm -f "$PREFLIGHT_CONTAINER" >/dev/null 2>&1 \
      || echo '!! 只读预检容器清理失败，需人工核对状态' >&2
  fi
  if [ -n "$PREFLIGHT_OVERRIDE" ]; then rm -f "$PREFLIGHT_OVERRIDE"; fi
  if [ -n "$MIGRATION_CONTAINER" ]; then
    DOCKER_COMMAND_TIMEOUT=20 docker rm -f "$MIGRATION_CONTAINER" >/dev/null 2>&1 \
      || echo '!! 迁移容器清理失败，需人工核对其状态与迁移记录' >&2
  fi
  if [ "$APPLICATION_SWITCHED" = '1' ]; then
    if DOCKER_COMMAND_TIMEOUT=90 docker compose stop -t 60 backend frontend; then
      FAILURE_RESULT='保持业务停写，需要人工核查并向前修复；不自动恢复旧应用'
    else
      echo '!! 应用停止失败，须立即人工阻断写入并核实实际容器状态' >&2
      FAILURE_RESULT='应用停写未确认，须人工阻断写入；不自动恢复旧应用'
    fi
  else
    FAILURE_RESULT='前置失败，保持原应用状态；不自动恢复或切换应用'
  fi
  echo "!! 部署失败：${reason}；${FAILURE_RESULT}" >&2
  echo "!! 部署证据：SHA=${expected:-未知}；阶段=${DEPLOY_PHASE}；迁移开始=${MIGRATION_STARTED}；迁移完成=${MIGRATION_COMPLETED}；备份=${backup_run_dir:-未创建}；原后端镜像=${PREVIOUS_BACKEND_IMAGE:-无}；原前端镜像=${PREVIOUS_FRONTEND_IMAGE:-无}" >&2
  # 告警发送结果**不得改变本脚本的退出码**：这里是 set -e，而 dingtalk_send 在未配置 webhook
  # 或发送失败时会返回非 0（2026-09-18 审计修复）。不显式吞掉的话，调用失败会在下面 exit 1
  # 之前中断，把「部署失败」的退出码从 1 变成 2（CI 的 audit-deployment 用例就按 1 断言）。
  # 告警失败本身已由 dingtalk_send 写 stderr，运维在部署日志里看得到。
  dingtalk_send "$(read_dingtalk_webhook "$PROJECT_DIR")" "🔴 FlowCube 部署失败（$(ts)）：${reason}；${FAILURE_RESULT}" || true
  exit 1
}
trap 'fail_deploy "第 ${LINENO} 行执行失败（exit=$?）"' ERR
trap 'fail_deploy "部署收到中断或超时信号"' INT TERM HUP

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
  . "$SCRIPT_DIR/lib/runtime-guards.sh"
  DOCKER_DEPLOY=1
  # 保存容器真正运行的 image ID，不能假设 latest 仍指向旧镜像。
  backend_id=$(docker compose ps -aq backend)
  frontend_id=$(docker compose ps -aq frontend)
  if [ -n "$backend_id" ]; then PREVIOUS_BACKEND_IMAGE=$(docker inspect -f '{{.Image}}' "$backend_id"); fi
  if [ -n "$frontend_id" ]; then PREVIOUS_FRONTEND_IMAGE=$(docker inspect -f '{{.Image}}' "$frontend_id"); fi

  # 不允许回退到宿主编译：2 核生产机只接收 CI 已构建的产物。
  archive="${DEPLOY_IMAGE_ARCHIVE:-}"
  checksum="${DEPLOY_IMAGE_SHA256:-}"
  [ -n "$archive" ] && [ -s "$archive" ] || fail_deploy '缺少 CI 镜像归档，请通过 Deploy Browser App 发布'
  [[ "$checksum" =~ ^[a-f0-9]{64}$ ]] || fail_deploy '镜像归档摘要无效'
  avail_mb=$(df -Pm "$ROOT" | awk 'NR==2 {print $4}')
  [[ "$avail_mb" =~ ^[0-9]+$ ]] && [ "$avail_mb" -ge 4096 ] || fail_deploy '可用磁盘不足 4096 MB，拒绝加载；不自动清理回退镜像'
  actual_checksum=$(bounded 120 sha256sum "$archive")
  [ "${actual_checksum%% *}" = "$checksum" ] || fail_deploy 'CI 镜像归档摘要不匹配'
  echo '==> 加载并验证 CI 应用镜像（旧应用仍在运行）...'
  # docker load 要解压全部层：首次加载一个新镜像时在慢盘上可能超过 10 分钟。
  # 2026-09-16 发 v0.9.17 时就卡在这里——600 秒整被 bounded 强杀（exit code 124，
  # 日志停在"加载并验证 CI 应用镜像"之后、没有任何 docker 输出），重跑时层已存在所以只要 9 秒。
  # 放宽到 1800 秒：外层部署 timeout 为 2700 秒（另留 -k 600 停写清理），含独立 300 秒备份窗口。
  DOCKER_COMMAND_TIMEOUT=1800 docker load -i "$archive"
  for service in backend frontend; do
    image_ref="flowcube-${service}:${expected}"
    revision=$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_ref")
    [ "$revision" = "$expected" ] || fail_deploy "${service} 镜像提交与待发布 SHA 不一致"
  done
  target_write_contract=$(docker image inspect -f '{{index .Config.Labels "io.flowcube.quantity-return-cash-contract"}}' "flowcube-backend:${expected}")
  [ "$target_write_contract" = '1' ] || fail_deploy '目标后端缺少迁移 288–292 的数量、退货与资金写入契约，拒绝停写和迁移'
  if [ "${SKIP_RELEASE_GATE:-0}" != '1' ]; then
    docker image inspect "${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.55.0-noble}" >/dev/null \
      || fail_deploy '缺少预装的浏览器门禁镜像，请在维护窗口准备；部署期间禁止拉取大型浏览器镜像'
  fi
  assert_expected_commit
  ensure_mysql_ready
  assert_migration_conditions
  for service in backend frontend; do docker tag "flowcube-${service}:${expected}" "flowcube-${service}:latest"; done
  # 停写标记先于停止请求；请求结果未知也不得自动恢复写入。
  APPLICATION_SWITCHED=1
  DEPLOY_PHASE='暂停写入'
  echo '==> 暂停业务写入，建立数据库迁移窗口...'
  DOCKER_COMMAND_TIMEOUT=90 docker compose stop -t 60 backend
  # 本次全新目录及回执绑定候选 SHA、实际 MySQL 和迁移前记录；不借用 cron 旧备份。
  backup_dir="${BACKUP_DIR:-$ROOT/backups}"
  mkdir -p "$backup_dir" || fail_deploy '无法创建迁移前备份目录；不得继续迁移'
  backup_run_dir=$(umask 077; mktemp -d "$backup_dir/pre-migrate-${expected}-XXXXXXXX") \
    || fail_deploy '无法创建本次私有迁移前备份目录；不得继续迁移'
  backup_mysql_id=$(docker compose ps -aq mysql)
  [ -n "$backup_mysql_id" ] && [[ "$backup_mysql_id" != *$'\n'* ]] || fail_deploy '迁移前备份来源 MySQL 不唯一'
  # create 和 verify 合用 300 秒；内部 240/20 秒截止预留子进程结束时间。
  if ! bounded 300 bash -c 'node "$1" create "$2" "$3" "$4" && node "$1" verify "$2" "$3" "$4"' \
      sh "$SCRIPT_DIR/lib/pre-migrate-backup.js" "$expected" "$backup_mysql_id" "$backup_run_dir"; then
    fail_deploy '本次迁移前备份或备份回执失败；旧备份不能替代，不执行迁移；未证明可恢复'
  fi
  echo '==> 用新镜像的一次性容器执行迁移...'
  MIGRATION_CONTAINER="flowcube-migrate-$$-$(date +%s)"
  MIGRATION_STARTED=1
  DEPLOY_PHASE='数据库迁移'
  DOCKER_COMMAND_TIMEOUT=300 docker compose run --rm --no-deps --name "$MIGRATION_CONTAINER" backend npm run migrate
  MIGRATION_COMPLETED=1
  MIGRATION_CONTAINER=''
  assert_expected_commit

  DEPLOY_PHASE='应用切换与验收'
  echo '==> 切换 backend / frontend...'
  APPLICATION_SWITCHED=1
  DOCKER_COMMAND_TIMEOUT=120 docker compose up -d --no-build --no-deps backend frontend
  wait_for_health
  wait_for_frontend
  if [ "${SKIP_RELEASE_GATE:-0}" = '1' ]; then
    echo '!! 已显式跳过页面门禁；常规 CI 部署不可使用此选项'
  else
    PRESERVE_DEPLOY_IMAGES=1 bash scripts/release-gate.sh
  fi

  # 公网证书/页面检查也在部署事务内，失败停止应用并保留证据。
  if [ -n "${DEPLOY_PUBLIC_ORIGIN:-}" ]; then
    [[ "$DEPLOY_PUBLIC_ORIGIN" == https://* ]] || fail_deploy '公网部署地址必须使用 HTTPS'
    curl -fsS --max-time 20 "${DEPLOY_PUBLIC_ORIGIN%/}/api/ready" >/dev/null
    public_html=$(curl -fsS --max-time 20 "${DEPLOY_PUBLIC_ORIGIN%/}/")
    [[ "$public_html" == *'<title>极序 Flow</title>'* ]] || fail_deploy '公网前端页面检查失败'
  fi
  assert_expected_commit
  bash scripts/install-cron.sh >/dev/null 2>&1 || echo '!! cron 同步失败，请手动检查'
  echo '==> 部署完成，健康检查与发布门禁已通过'
  exit 0
fi

fail_deploy '非 Docker 部署尚无可核实的迁移前备份来源与回执契约；拒绝自动安装或迁移，请在维护窗口建立并验证专用流程'
