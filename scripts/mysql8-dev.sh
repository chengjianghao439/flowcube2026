#!/usr/bin/env bash
set -euo pipefail

# 本机 MySQL 8 开发实例。
#
# 三个动作**职责单一、互不串联**：
#   start   把 colima profile 与容器拉起来（容器复用 + 数据卷保留），**不改动任何库结构**
#   stop    只停容器（保留数据卷）
#   migrate 把结构迁移到开发库 flowcube_dev8（目标硬编码，不受外部 DB_* 影响）
#
# 关键约束：
# - **只有 start 负责"启动"**。migrate **绝不**隐式启动 colima 或容器：未就绪即非 0 并提示先跑 start。
# - docker context 由 colima profile 提供，**首次使用时尚不存在**，故 start 必须先启动 profile、
#   再检查 context；反过来会在全新环境上永远起不来。
# - `start` 曾顺带迁移 `flowcube_dev8`，导致"只想借 3307 实例做隔离测试"时也把迁移写进开发库
#   （同类"目标库边界失效"在 2026-09-26 也发生过，机制不同）。
# 行为由 tests/mysql8-dev-script.test.js 以 stub（colima/docker/npm）契约锁定，不连库、不起容器。

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$HOME/.config/flowcube/mysql8.env"
ACTION="${1:-start}"
COMPOSE_CONTAINER='flowcube-dev-mysql8'

case "$ACTION" in
  start|stop|migrate) ;;
  *) echo '用法：mysql8-dev.sh start|stop|migrate' >&2; exit 1 ;;
esac
# 迁移目标固定，不接受额外参数：防止把结构误打到别的库。
if [[ $# -gt 1 ]]; then
  echo "用法：mysql8-dev.sh $ACTION —— 不接受额外参数（迁移目标固定为 127.0.0.1:3307/flowcube_dev8）" >&2
  exit 1
fi

# 生成随机口令（**只有 start 调用**）：缺失时才创建，**绝不覆盖**既有文件。
# 口令只保存在用户私有目录；不打印、不写进仓库。
generate_credentials_if_missing() {
  node - "$CONFIG" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const file = process.argv[2]
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
if (!fs.existsSync(file)) {
  const value = ['FLOWCUBE_DEV_MYSQL_ROOT_PASSWORD', 'FLOWCUBE_DEV_MYSQL_PASSWORD', 'FLOWCUBE_DEV_JWT_SECRET']
    .map(key => `${key}=${crypto.randomBytes(32).toString('hex')}`).join('\n') + '\n'
  fs.writeFileSync(file, value, { mode: 0o600, flag: 'wx' })
}
NODE
}

# 校验凭据**已存在且仅本人可读**（三个动作都执行）。stop/migrate 不会替用户创建配置。
assert_credentials() {
  if [[ ! -f "$CONFIG" ]]; then
    echo '尚未初始化 MySQL 8（缺少本机凭据文件），请先运行：npm run dev:mysql8' >&2
    exit 1
  fi
  node - "$CONFIG" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
if ((fs.statSync(file).mode & 0o077) !== 0) throw new Error('MySQL 8 配置文件应仅当前用户可读（chmod 600）')
NODE
}

# 只有 start 调用它：按需启动 colima profile（profile 起来后会创建 docker context）。
require_colima() {
  command -v colima >/dev/null || { echo '需要先安装 Colima。' >&2; exit 1; }
  if ! colima status flowcube >/dev/null 2>&1; then
    colima start flowcube --activate=false
  fi
}

# context 必须是本机 Unix socket（禁止把开发容器命令发往远程服务器）。
require_local_context() {
  local endpoint
  endpoint="$(docker context inspect colima-flowcube --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
  if [[ "$endpoint" != unix://* ]]; then
    echo 'colima-flowcube profile 未就绪（本机 Docker socket 不可用）。请先运行：npm run dev:mysql8' >&2
    exit 1
  fi
}

# migrate 专用的就绪检查：**只看不启动**——profile 与指定容器必须已在运行且 healthy。
require_ready_container() {
  local status
  status="$(docker --context colima-flowcube inspect -f '{{.State.Status}}' "$COMPOSE_CONTAINER" 2>/dev/null || true)"
  if [[ "$status" != running ]]; then
    echo "容器 $COMPOSE_CONTAINER 未在运行。请先运行：npm run dev:mysql8" >&2
    exit 1
  fi
  local health
  health="$(docker --context colima-flowcube inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$COMPOSE_CONTAINER" 2>/dev/null || true)"
  if [[ "$health" != healthy ]]; then
    echo "容器 $COMPOSE_CONTAINER 尚未 healthy（当前：${health:-无}）。请先运行：npm run dev:mysql8" >&2
    exit 1
  fi
}

compose() {
  docker --context colima-flowcube compose --env-file "$CONFIG" -f "$ROOT/docker-compose.dev.yml" "$@"
}

# 只有 start 会（按需）生成凭据；stop/migrate 缺少凭据时必须失败，绝不替用户创建随机口令。
if [[ "$ACTION" = start ]]; then
  generate_credentials_if_missing
fi
assert_credentials

if [[ "$ACTION" = start ]]; then
  # 顺序要紧：**先**启动 profile（它会创建 context），**再**检查 context。
  # 反过来的话，在从未启动过的机器上 context 尚不存在 ⇒ 检查失败 ⇒ 永远起不来。
  require_colima
  require_local_context
  compose up -d --wait --wait-timeout 150
  echo 'MySQL 8 已就绪：127.0.0.1:3307（仅启动实例，未改动任何库结构）。'
  echo '如需把结构迁移到开发库 flowcube_dev8，请显式运行：npm run dev:mysql8:migrate'
  exit 0
fi

if [[ "$ACTION" = stop ]]; then
  require_local_context
  compose stop
  echo '独立 MySQL 8 已停止，数据卷保留。'
  exit 0
fi

# migrate：显式动作。**绝不启动** colima/容器；未就绪即非 0 并提示先 start。
# 目标硬编码为本机回环 + flowcube_dev8，**不受外部 DB_* 环境变量影响**。
require_local_context
require_ready_container
echo '正在对开发库 flowcube_dev8 执行结构迁移（目标：127.0.0.1:3307）。'
set -a
source "$CONFIG"
set +a
cd "$ROOT"
# 仅迁移进程使用管理员（binlog 下创建触发器所需）；运行账户不变。
NODE_ENV=development DB_HOST=127.0.0.1 DB_PORT=3307 DB_NAME=flowcube_dev8 DB_USER=root \
  DB_PASSWORD="$FLOWCUBE_DEV_MYSQL_ROOT_PASSWORD" JWT_SECRET="$FLOWCUBE_DEV_JWT_SECRET" \
  npm --prefix backend run migrate
echo '迁移完成：flowcube_dev8。'
