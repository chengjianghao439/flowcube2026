#!/usr/bin/env bash
# Installed trusted executor. Receiver owns authentication; no Git, engine changes or rollback.
set -Eeuo pipefail
SCRIPT_DIR="${RELEASE_TOOLS_DIR:?fixed installed tools required}"
ROOT="${PROJECT_DIR:?actual Compose project directory required}"
cd "$ROOT"
# shellcheck source=scripts/lib/runtime-guards.sh
. "$SCRIPT_DIR/lib/runtime-guards.sh"
: "${EXPECTED_COMMIT:?verified full SHA required}" "${COMPOSE_FILE:?actual Compose combination required}"
: "${COMPOSE_PROJECT_NAME:?actual Compose project required}" "${COMPOSE_ENV_FILES:?private environment file required}"
: "${MYSQL_EXPECTED_VERSION:?existing engine version required}" "${MYSQL_EXPECTED_IMAGE_ID:?existing engine image required}"
: "${RELEASE_STATE_DIR:?receiver state directory required}"
[[ "$EXPECTED_COMMIT" =~ ^[a-f0-9]{40}$ ]]
[[ "$EXPECTED_BACKEND_ID" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ "$EXPECTED_FRONTEND_ID" =~ ^sha256:[a-f0-9]{64}$ ]]
exec 9>"$RELEASE_STATE_DIR/application.lock"
flock -w 1800 9 || { echo '!! 等待应用部署锁超时' >&2; exit 1; }
if [ -n "${RELEASE_GATE_ENV_FILE:-}" ]; then
  set -a
  # Operator-owned secret file; never sourced from an upload.
  # shellcheck source=/dev/null
  . "$RELEASE_GATE_ENV_FILE"
  set +a
fi
for name in SMOKE_USERNAME SMOKE_PASSWORD SMOKE_LIMITED_USERNAME SMOKE_LIMITED_PASSWORD; do
  [ -n "${!name:-}" ] || { echo "!! 缺少 ${name}，不开始加载、停写或迁移" >&2; exit 1; }
done
WRITE_WINDOW=0
MIGRATION_CONTAINER=''
fail_deploy() {
  trap - ERR INT TERM HUP
  # A failed migration or switched application must never resume writes automatically.
  if [ "$WRITE_WINDOW" = 1 ]; then
    DOCKER_COMMAND_TIMEOUT=90 docker compose stop -t 60 backend || echo '!! 停写失败，运维须立即阻断写入' >&2
  fi
  if [ -n "$MIGRATION_CONTAINER" ]; then
    DOCKER_COMMAND_TIMEOUT=20 docker rm -f "$MIGRATION_CONTAINER" >/dev/null 2>&1 || true
  fi
  echo '!! 发布失败，已停止；不自动回滚、不恢复旧镜像。由运维核对收据并用备份恢复。' >&2
  exit 1
}
trap fail_deploy ERR INT TERM HUP
compose() { docker compose --project-directory "$ROOT" "$@"; }
assert_mysql_ready() {
  local id state identity sql
  id=$(compose ps -aq mysql)
  [ -n "$id" ] && [[ "$id" != *$'\n'* ]] || { echo '!! 现有 MySQL 不唯一或缺失，不自动首次启动或重建' >&2; return 1; }
  state=$(DOCKER_COMMAND_TIMEOUT=5 docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$id")
  [ "$state" = 'running healthy' ]
  identity=$(docker inspect -f '{{.Image}}' "$id")
  [ "$identity" = "$MYSQL_EXPECTED_IMAGE_ID" ]
  sql=$(DOCKER_COMMAND_TIMEOUT=5 docker exec "$id" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --no-defaults --protocol=TCP -h127.0.0.1 -P3306 --connect-timeout=2 -uroot --database="$MYSQL_DATABASE" --batch --skip-column-names -e "SELECT CONCAT(1, CHAR(9), VERSION())"' 2>/dev/null)
  [ "$sql" = "$(printf '1\t%s' "$MYSQL_EXPECTED_VERSION")" ]
  if [ -n "${MYSQL_ID:-}" ]; then [ "$id" = "$MYSQL_ID" ]; fi
  MYSQL_ID=$id
}
assert_images() {
  local service expected actual revision contract
  for service in backend frontend; do
    if [ "$service" = backend ]; then expected=$EXPECTED_BACKEND_ID; else expected=$EXPECTED_FRONTEND_ID; fi
    actual=$(docker image inspect -f '{{.Id}}' "flowcube-$service:$EXPECTED_COMMIT")
    revision=$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$actual")
    [ "$actual" = "$expected" ] || return 1
    [ "$revision" = "$EXPECTED_COMMIT" ] || return 1
  done
  contract=$(docker image inspect -f '{{index .Config.Labels "io.flowcube.quantity-return-cash-contract"}}' "$EXPECTED_BACKEND_ID")
  [ "$contract" = 1 ] || { echo '!! 目标后端缺少数量/退货/资金写入契约，拒绝停写和迁移' >&2; return 1; }
}
check_health() {
  local attempt html
  for attempt in {1..30}; do
    if curl -fsS --max-time 5 http://127.0.0.1:3000/api/ready >/dev/null; then break; fi
    [ "$attempt" -lt 30 ]; sleep 2
  done
  for attempt in {1..30}; do
    html=$(curl -fsS --max-time 5 http://127.0.0.1:8080/) || html=''
    if [[ "$html" == *'<title>极序 Flow</title>'* ]]; then break; fi
    [ "$attempt" -lt 30 ]; sleep 2
  done
}
assert_mysql_ready
if [ "${1:-}" = verify-current ]; then
  for service in backend frontend; do
    id=$(compose ps -q "$service"); [ -n "$id" ]
    if [ "$service" = backend ]; then expected=$EXPECTED_BACKEND_ID; else expected=$EXPECTED_FRONTEND_ID; fi
    [ "$(docker inspect -f '{{.Image}}' "$id")" = "$expected" ]
    [ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$expected")" = "$EXPECTED_COMMIT" ]
  done
  check_health
  exit 0
fi
[ "$#" -eq 0 ]
: "${DEPLOY_IMAGE_ARCHIVE:?authenticated CI archive required}" "${DEPLOY_IMAGE_SHA256:?authenticated archive digest required}"
: "${RELEASE_SOURCE_DIR:?authenticated target smoke scripts required}" "${BACKUP_DIR:?operator-approved backup path required}"
avail_mb=$(df -Pm "$ROOT" | awk 'NR==2 {print $4}')
echo "==> 应用目录可用空间：${avail_mb} MB；最低 4096 MB"
[[ "$avail_mb" =~ ^[0-9]+$ ]] || fail_deploy
[ "$avail_mb" -ge 4096 ] || fail_deploy
checksum=$(bounded 120 sha256sum "$DEPLOY_IMAGE_ARCHIVE")
[ "${checksum%% *}" = "$DEPLOY_IMAGE_SHA256" ]
DOCKER_COMMAND_TIMEOUT=1800 docker load -i "$DEPLOY_IMAGE_ARCHIVE"
assert_images
# Never change log_bin_trust_function_creators or any other database parameter.
# If existing privileges cannot run the target's own migrations, fail and request separate maintenance approval.
docker image inspect "$PLAYWRIGHT_IMAGE" >/dev/null
assert_mysql_ready
WRITE_WINDOW=1
DOCKER_COMMAND_TIMEOUT=90 compose stop -t 60 backend
backup_run_dir=$(umask 077; mktemp -d "$BACKUP_DIR/pre-migrate-${EXPECTED_COMMIT}-XXXXXXXX")
# Fresh snapshot/independent receipt verification, same 300-second budget; never borrow a cron backup.
# Inner bash expands only its fixed positional arguments.
# shellcheck disable=SC2016
bounded 300 bash -c 'node "$1" create "$2" "$3" "$4" && node "$1" verify "$2" "$3" "$4"' \
  sh "$SCRIPT_DIR/lib/pre-migrate-backup.js" "$EXPECTED_COMMIT" "$MYSQL_ID" "$backup_run_dir"
MIGRATION_CONTAINER="flowcube-migrate-$$-$(date +%s)"
DOCKER_COMMAND_TIMEOUT=300 compose run --rm --no-deps --pull never --name "$MIGRATION_CONTAINER" backend npm run migrate
MIGRATION_CONTAINER=''
assert_mysql_ready
DOCKER_COMMAND_TIMEOUT=120 compose up -d --no-build --no-deps --pull never backend frontend
check_health
# Resource-bounded automatic smoke remains distinct from operations and human browser QA.
bash "$SCRIPT_DIR/release-gate.sh"
[[ "$DEPLOY_PUBLIC_ORIGIN" == https://* ]]
curl -fsS --max-time 20 "${DEPLOY_PUBLIC_ORIGIN%/}/api/ready" >/dev/null
public_html=$(curl -fsS --max-time 20 "${DEPLOY_PUBLIC_ORIGIN%/}/")
[[ "$public_html" == *'<title>极序 Flow</title>'* ]]
assert_mysql_ready
echo '==> 执行器与自动 smoke 完成；仍待运维检查和 QA 真浏览器人工验收'
