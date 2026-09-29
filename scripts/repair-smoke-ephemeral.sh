#!/usr/bin/env bash
set -euo pipefail

# 修复专项 smoke 的「本批专属临时 MySQL 实例」runner（2026-09-29 越界写入事故后新增）。
#
# 为什么需要它：`npm run smoke:purchase-repair` 与 `npm run smoke:legacy-receivable-repair`
# （后者含 `audit-business-consistency.smoke.test.js`）会对 16 张表做全表清理与写入，且硬要求
# 库名 `flowcube_repair20260908_test`。同一库名在本机回环 3307 的既有实例上同样成立 —— 2026-09-29
# 就是这样误清了旧库（见 docs/incident-repair-db-2026-09-29.md）。因此这两条命令**只允许**跑在
# 本脚本新建的一次性实例上；测试侧 `tests/helpers/repairInstanceOwnership.js` 会用 `docker inspect`
# /`docker volume inspect` 交叉核验容器与数据卷的本批 label、创建时间与实时端口映射，不通过即在
# 写入前拒绝。
#
# 硬约束：
#   · 所有 docker 操作之前先验证 docker context 是本机 Unix socket；
#   · 容器与数据卷**由本脚本显式创建**并带本批随机标识与 label，同名资源已存在即拒绝复用；
#   · 清理标记**只在拿到 docker 实际返回的容器 ID 之后**才置位——绝不在「打算创建」时就置位，
#     否则创建失败时会按名字去删可能属于别人的同名资源；
#   · 建库前先断言目标库不存在，再 `CREATE DATABASE`（**不用** `IF NOT EXISTS` —— 它不证明新建）；
#   · 建库与迁移之前，核验「我连的就是本批刚建的容器与卷」（ID/名/label/端口映射/卷挂载/卷 label）；
#   · 退出时按**精确 ID/卷名**只清理本批资源，并逐项复核确实已退出；任一项无法确认即**非 0**。
#
# 不使用本脚本、直接跑那两条 smoke 会在测试内被归属门拒绝（写入之前失败）——这是预期行为。
#
# 用法：npm run repair:smoke-ephemeral
# 前置：本机 colima `flowcube` profile 已启动（`npm run dev:mysql8` 可拉起），且已有 `mysql:8.0` 镜像。
# 约束：不触碰共享 3307 实例、不迁移 flowcube_dev8、不回显任何口令（随机口令只传给本批临时容器与
#       迁移/smoke 子进程，不写入归属文件、仓库文件或日志；容器退出时删除）。

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CTX='colima-flowcube'
IMAGE='mysql:8.0'
DB_NAME='flowcube_repair20260908_test'
DB_COLLATION='utf8mb4_0900_ai_ci'   # 与 CI 默认一致，避免在开发实例的 unicode_ci 上跑出假差异
CONFIG_DIR="$HOME/.config/flowcube"

BATCH_ID="$(date +%Y%m%d%H%M%S)-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(3).toString("hex"))')"
CTR="flowcube-repair-ephemeral-${BATCH_ID}"
VOL="flowcube-repair-ephemeral-${BATCH_ID}-data"
OWNERSHIP_FILE="$CONFIG_DIR/repair-ephemeral-${BATCH_ID}.json"

# 清理标记：**只有在 docker 实际创建成功之后才置位**。资源名虽含本批随机 batchId，但绝不在
# 「打算创建」时就置位——那样在并发同名创建或创建失败时会误删不属于本批的资源。
CTR_CREATED=0
VOL_CREATED=0
FILE_CREATED=0
CTR_ID=''

log() { echo "[repair-ephemeral] $*"; }

d() { docker --context "$CTX" "$@"; }

# 所有 docker 操作的第一道门：context 必须是本机 Unix socket（禁止把这些写库命令发往远程 Docker）。
require_local_context() {
  command -v docker >/dev/null 2>&1 || { echo '[repair-ephemeral] 未安装 docker。' >&2; exit 1; }
  local endpoint
  endpoint="$(docker context inspect "$CTX" --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
  if [[ "$endpoint" != unix://* ]]; then
    echo "[repair-ephemeral] colima-flowcube profile 未就绪（本机 Docker socket 不可用）。请先运行：npm run dev:mysql8" >&2
    exit 1
  fi
}

# 0=存在、1=确认不存在、2=无法确认（查询本身失败，不得当作「不存在」）。
container_exists() {
  local out
  if ! out="$(d ps -aq --filter "id=${1}" 2>/dev/null)"; then return 2; fi
  if [[ -n "$out" ]]; then return 0; fi
  return 1
}
volume_exists() {
  local out
  if ! out="$(d volume ls -q --filter "name=^${1}$" 2>/dev/null)"; then return 2; fi
  if [[ -n "$out" ]]; then return 0; fi
  return 1
}

# docker 的时间戳带纳秒，统一规范到毫秒 ISO，便于两侧机械比较。
norm_time() {
  node -e 'const d = new Date(process.argv[1]); if (Number.isNaN(d.getTime())) process.exit(1); process.stdout.write(d.toISOString())' "$1"
}

# 清理只操作本批资源，并逐项复核「确实已退出」；无法确认即失败，最终以非 0 结束。
cleanup() {
  local rc=$? st=0 failed=0
  if [[ "$CTR_CREATED" = 1 ]]; then
    st=0; container_exists "$CTR_ID" || st=$?
    if [[ "$st" = 0 ]]; then
      d rm -f "$CTR_ID" >/dev/null 2>&1 || true
      st=0; container_exists "$CTR_ID" || st=$?
    fi
    if [[ "$st" != 1 ]]; then
      echo "[repair-ephemeral] 清理失败：容器 ${CTR_ID} 未确认退出（状态码 ${st}）" >&2; failed=1
    fi
  fi
  if [[ "$VOL_CREATED" = 1 ]]; then
    st=0; volume_exists "$VOL" || st=$?
    if [[ "$st" = 0 ]]; then
      d volume rm "$VOL" >/dev/null 2>&1 || true
      st=0; volume_exists "$VOL" || st=$?
    fi
    if [[ "$st" != 1 ]]; then
      echo "[repair-ephemeral] 清理失败：数据卷 ${VOL} 未确认退出（状态码 ${st}）" >&2; failed=1
    fi
  fi
  if [[ "$FILE_CREATED" = 1 ]]; then
    rm -f "$OWNERSHIP_FILE" 2>/dev/null || true
    if [[ -e "$OWNERSHIP_FILE" ]]; then
      echo "[repair-ephemeral] 清理失败：归属文件 ${OWNERSHIP_FILE} 仍在" >&2; failed=1
    fi
  fi
  if [[ "$failed" != 0 && "$rc" = 0 ]]; then rc=1; fi
  exit "$rc"
}
trap cleanup EXIT

# —— 1. 先验 context，再做任何 docker 操作 ——
require_local_context

# —— 2. 拒绝复用任何同名资源（实例必须全新，否则归属证据退化为上次运行的残留）——
if ! taken_ctr="$(d ps -aq --filter "name=^${CTR}$" 2>/dev/null)"; then
  echo '[repair-ephemeral] 无法查询容器（docker context 异常），中止。' >&2; exit 1
fi
if [[ -n "$taken_ctr" ]]; then
  echo "[repair-ephemeral] 拒绝：同名容器已存在（${CTR}）。不复用、不覆盖，请先人工核实。" >&2; exit 1
fi
st=0; volume_exists "$VOL" || st=$?
if [[ "$st" != 1 ]]; then
  echo "[repair-ephemeral] 拒绝：同名数据卷已存在或无法确认（${VOL}，状态码 ${st}）。" >&2; exit 1
fi
if [[ -e "$OWNERSHIP_FILE" ]]; then
  echo "[repair-ephemeral] 拒绝：归属文件已存在（${OWNERSHIP_FILE}）。不复用旧证据。" >&2; exit 1
fi

ROOT_PW="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"

# —— 3. 显式创建本批数据卷与容器；**验证归属之后才置清理标记** ——
log "创建本批数据卷与容器（${CTR}，随机回环端口）…"
d volume create \
  --label "flowcube.repair.batch=${BATCH_ID}" \
  --label "flowcube.repair.role=ephemeral-smoke" \
  "$VOL" >/dev/null

# `docker volume create` 对**已存在的卷是幂等成功**（不报错，也不会改其 label）。因此预检与创建
# 之间若被别人占用了同名卷，这里仍会「成功」返回。必须在验证「卷确实带本批 label」之后才置
# 清理标记，否则退出时会删掉不属于本批的卷。验证不通过时**保留现场，不删除**。
VOL_BATCH="$(d volume inspect -f '{{index .Labels "flowcube.repair.batch"}}' "$VOL" 2>/dev/null || true)"
VOL_ROLE="$(d volume inspect -f '{{index .Labels "flowcube.repair.role"}}' "$VOL" 2>/dev/null || true)"
if [[ "$VOL_BATCH" != "$BATCH_ID" || "$VOL_ROLE" != 'ephemeral-smoke' ]]; then
  echo "[repair-ephemeral] 拒绝：数据卷 ${VOL} 不是本批新建（label 不符）。保留现场，不删除。" >&2
  exit 1
fi
VOL_CREATED=1

CTR_ID="$(d create \
  --name "$CTR" \
  -e MYSQL_ROOT_PASSWORD="$ROOT_PW" \
  -p 127.0.0.1::3306 \
  -v "${VOL}:/var/lib/mysql" \
  --label "flowcube.repair.batch=${BATCH_ID}" \
  --label "flowcube.repair.role=ephemeral-smoke" \
  "$IMAGE")"
if [[ -z "$CTR_ID" ]]; then
  echo '[repair-ephemeral] docker create 未返回容器 ID。' >&2
  exit 1
fi
# 同理：只有确认这个 ID 指向的容器确实带本批 label 之后，才允许在退出时删除它。
CTR_BATCH="$(d inspect -f '{{index .Config.Labels "flowcube.repair.batch"}}' "$CTR_ID" 2>/dev/null || true)"
CTR_ROLE="$(d inspect -f '{{index .Config.Labels "flowcube.repair.role"}}' "$CTR_ID" 2>/dev/null || true)"
if [[ "$CTR_BATCH" != "$BATCH_ID" || "$CTR_ROLE" != 'ephemeral-smoke' ]]; then
  echo "[repair-ephemeral] 拒绝：容器 ${CTR_ID} 不是本批新建（label 不符）。保留现场，不删除。" >&2
  exit 1
fi
CTR_CREATED=1
d start "$CTR_ID" >/dev/null

# 等待实例可连接（首启需初始化数据目录，最长约 180 秒）。
for _ in $(seq 1 90); do
  if d exec -e MYSQL_PWD="$ROOT_PW" "$CTR_ID" mysqladmin ping -uroot --silent >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
if ! d exec -e MYSQL_PWD="$ROOT_PW" "$CTR_ID" mysqladmin ping -uroot --silent >/dev/null 2>&1; then
  echo '[repair-ephemeral] 临时实例未能在预期时间内就绪。' >&2
  exit 1
fi

HOST_PORT="$(d port "$CTR_ID" 3306/tcp | head -n1 | sed -E 's/.*:([0-9]+)$/\1/')"
if [[ ! "$HOST_PORT" =~ ^[0-9]+$ ]]; then
  echo "[repair-ephemeral] 无法解析宿主回环端口：$(d port "$CTR_ID" 3306/tcp)" >&2
  exit 1
fi
# 双保险：临时实例端口绝不允许落在共享/长期实例端口上（3307 开发实例、3306 旧实例）。
if [[ "$HOST_PORT" = 3306 || "$HOST_PORT" = 3307 ]]; then
  echo "[repair-ephemeral] 临时实例分到了共享端口 ${HOST_PORT}，拒绝继续。" >&2
  exit 1
fi

SERVER_UUID="$(d exec -e MYSQL_PWD="$ROOT_PW" "$CTR_ID" mysql -uroot -N -B -e 'SELECT @@server_uuid' | tr -d '[:space:]')"
if [[ -z "$SERVER_UUID" ]]; then
  echo '[repair-ephemeral] 无法读取实例 @@server_uuid。' >&2
  exit 1
fi

# —— 4. 建库/迁移之前，核验「我连的就是本批刚建的容器与卷」——
VERIFY_ID="$(d inspect -f '{{.Id}}' "$CTR_ID")"
VERIFY_NAME="$(d inspect -f '{{.Name}}' "$CTR_ID" | sed 's#^/##')"
VERIFY_BATCH="$(d inspect -f '{{index .Config.Labels "flowcube.repair.batch"}}' "$CTR_ID")"
VERIFY_ROLE="$(d inspect -f '{{index .Config.Labels "flowcube.repair.role"}}' "$CTR_ID")"
VERIFY_PORT="$(d port "$CTR_ID" 3306/tcp | head -n1)"
VERIFY_VOL="$(d inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{.Name}}{{end}}{{end}}' "$CTR_ID")"
VERIFY_VOL_BATCH="$(d volume inspect -f '{{index .Labels "flowcube.repair.batch"}}' "$VOL")"
VERIFY_VOL_ROLE="$(d volume inspect -f '{{index .Labels "flowcube.repair.role"}}' "$VOL")"
if [[ "$VERIFY_ID" != "$CTR_ID" || "$VERIFY_NAME" != "$CTR" || "$VERIFY_BATCH" != "$BATCH_ID" \
   || "$VERIFY_ROLE" != 'ephemeral-smoke' || "$VERIFY_PORT" != "127.0.0.1:${HOST_PORT}" \
   || "$VERIFY_VOL" != "$VOL" || "$VERIFY_VOL_BATCH" != "$BATCH_ID" || "$VERIFY_VOL_ROLE" != 'ephemeral-smoke' ]]; then
  echo "[repair-ephemeral] 目标归属自检未通过（容器/卷的 ID、名、label、端口映射或挂载与本批不符），拒绝建库与迁移。" >&2
  exit 1
fi

# —— 5. 先断言库不存在，再新建 ——
EXISTS="$(d exec -e MYSQL_PWD="$ROOT_PW" "$CTR_ID" mysql -uroot -N -B -e \
  "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${DB_NAME}'")"
if [[ -n "$EXISTS" ]]; then
  echo "[repair-ephemeral] 拒绝：临时实例上已存在库 ${DB_NAME}（实例并非全新）。" >&2
  exit 1
fi
d exec -e MYSQL_PWD="$ROOT_PW" "$CTR_ID" mysql -uroot -e \
  "CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE ${DB_COLLATION}" >/dev/null

# —— 6. 归属文件：绑定容器与卷的精确身份、创建时间、端口映射与**本轮 runner 进程身份**；不含口令 ——
CONTAINER_CREATED_AT="$(norm_time "$(d inspect -f '{{.Created}}' "$CTR_ID")")"
VOLUME_CREATED_AT="$(norm_time "$(d volume inspect -f '{{.CreatedAt}}' "$VOL")")"
# 本轮的活跃标记：测试侧会用同一条 `ps -o lstart=` 复核该 PID 仍存活且启动身份一致。
# 这样「runner 已退出/异常中止留下的残留证明文件」即使还在时间窗内也会被拒绝。
RUNNER_PID=$$
RUNNER_STARTED="$(ps -p $$ -o lstart= | tr -s ' ' | sed -e 's/^ *//' -e 's/ *$//')"
mkdir -p "$CONFIG_DIR"
node - "$OWNERSHIP_FILE" "$BATCH_ID" "$CTR_ID" "$CTR" "$CONTAINER_CREATED_AT" "$VOL" "$VOLUME_CREATED_AT" \
  "$HOST_PORT" "$SERVER_UUID" "$DB_NAME" "$RUNNER_PID" "$RUNNER_STARTED" <<'NODE'
const fs = require('node:fs')
const [file, batchId, containerId, containerName, containerCreatedAt,
  volumeName, volumeCreatedAt, hostPort, serverUuid, database, runnerPid, runnerStarted] = process.argv.slice(2)
fs.writeFileSync(file, JSON.stringify({
  batchId, containerId, containerName, containerCreatedAt,
  volumeName, volumeCreatedAt,
  host: '127.0.0.1', hostPort: Number(hostPort), serverUuid, database,
  runnerPid: Number(runnerPid), runnerStarted,
  createdAt: new Date().toISOString(),
}, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
NODE
FILE_CREATED=1

log "迁移 ${DB_NAME}（目标：127.0.0.1:${HOST_PORT}）…"
cd "$ROOT"
NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT="$HOST_PORT" DB_NAME="$DB_NAME" DB_USER=root \
  DB_PASSWORD="$ROOT_PW" npm --prefix backend run migrate

run_smoke() {
  NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT="$HOST_PORT" DB_NAME="$DB_NAME" DB_USER=root \
    DB_PASSWORD="$ROOT_PW" \
    FLOWCUBE_REPAIR_INSTANCE_FILE="$OWNERSHIP_FILE" FLOWCUBE_REPAIR_DOCKER_CONTEXT="$CTX" \
    npm run "$1"
}

log '执行采购修复 smoke（串行第一项）…'
run_smoke smoke:purchase-repair
log '执行应收修复 + 一致性扫描 smoke（串行第二项）…'
run_smoke smoke:legacy-receivable-repair

log '全部通过。清理本批容器/数据卷/归属文件…'
