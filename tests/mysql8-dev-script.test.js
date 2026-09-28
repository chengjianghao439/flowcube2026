// MySQL 8 本地实例脚本（scripts/mysql8-dev.sh）的 shell 行为契约。
//
// 背景：该脚本的 `start` 曾会在**起容器之后顺带对固定开发库 `flowcube_dev8` 执行结构迁移**，
// 导致"只想借 3307 实例做隔离测试"时也把迁移写进了开发库（同类"目标库边界失效"在 2026-09-26
// 也发生过，机制不同：那次是 source 失败 → dotenv 回退 backend/.env）。因此约定：
//   - 只有 `start` 负责"启动"（colima profile + 容器），且**必须先把 profile 起起来再检查 context**
//     （context 由 profile 创建，全新机器上尚不存在）；
//   - `migrate` **绝不隐式启动**任何东西，只检查"profile + 指定容器已 running/healthy"，未就绪即非 0；
//   - `migrate` 的目标固定，不受外部 DB_* 影响，也不接受额外库名；
//   - 只有 `start` 会（按需）**生成**凭据；`stop`/`migrate` 缺凭据即非 0，**不替用户创建**。
//
// 隔离方式：**不修改 HOME、不读真实配置**。把真实脚本复制到任务自建临时目录，只把 `CONFIG=`
// 一行替换为该目录下的伪凭据文件，再通过 stub 掉的 colima/docker/npm 运行**同一份脚本逻辑**。
// 每个用例自建的临时目录在 `finally` 里清理（只删本测试创建的 `fc-m8-*`）。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const SCRIPT_SRC = path.join(ROOT, 'scripts', 'mysql8-dev.sh')
const CRED_MARK = 'FLOWCUBE_DEV_MYSQL_ROOT_PASSWORD=fake-root-do-not-touch'

function runScript(action, opts = {}) {
  const {
    extraArgs = [], env = {}, profileUp = false, containerStatus = 'running', containerHealth = 'healthy',
    composeUpRc = 0, npmRc = 0, withCred = true, contextEndpoint = 'unix', credMode = 0o600,
  } = opts

  const created = []
  const mkTmp = prefix => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    created.push(d)
    return d
  }

  // 复制真实脚本 → 只替换 CONFIG 指向伪凭据；不改 HOME、不碰真实 ~/.config
  const tmpRoot = mkTmp('fc-m8-run-')
  const scriptDir = path.join(tmpRoot, 'scripts')
  fs.mkdirSync(scriptDir, { recursive: true })
  const credPath = path.join(tmpRoot, 'fake-creds.env')
  const body = fs.readFileSync(SCRIPT_SRC, 'utf8').replace(/^CONFIG=".*"$/m, `CONFIG="${credPath}"`)
  assert.match(body, new RegExp(`^CONFIG="${credPath}"$`, 'm'), '未能把 CONFIG 指向伪凭据（脚本结构是否变化？）')
  const scriptPath = path.join(scriptDir, 'mysql8-dev.sh')
  fs.writeFileSync(scriptPath, body, { mode: 0o755 })
  if (withCred) {
    fs.writeFileSync(credPath, `${CRED_MARK}\nFLOWCUBE_DEV_MYSQL_PASSWORD=fake-user\nFLOWCUBE_DEV_JWT_SECRET=fake-jwt\n`, { mode: credMode })
  }

  // stub colima / docker / npm：记录每次调用；context 只在 profile 起来后才可用（保护真实顺序）
  const bin = mkTmp('fc-m8-bin-')
  const log = path.join(bin, 'calls.log')
  fs.writeFileSync(log, '')
  const marker = path.join(tmpRoot, 'profile.marker')
  if (profileUp) fs.writeFileSync(marker, '')
  const write = (name, lines) => fs.writeFileSync(path.join(bin, name), ['#!/usr/bin/env bash', `echo "${name} $*" >> "$FC_CALL_LOG"`, ...lines, ''].join('\n'), { mode: 0o755 })

  write('colima', [
    'if [[ "$1" == "status" ]]; then [[ -f "$FC_PROFILE_MARKER" ]] && exit 0 || exit 1; fi',
    'if [[ "$1" == "start" ]]; then touch "$FC_PROFILE_MARKER"; exit 0; fi',
    'exit 0',
  ])
  write('docker', [
    'if [[ "$*" == *"context inspect"* ]]; then',
    '  [[ -f "$FC_PROFILE_MARKER" ]] || { echo "context colima-flowcube not found" >&2; exit 1; }',
    '  [[ "${FC_CONTEXT_ENDPOINT:-unix}" == "tcp" ]] && { echo "tcp://10.0.0.9:2376"; exit 0; }',
    '  echo "unix:///tmp/fc-fake.sock"; exit 0',
    'fi',
    'if [[ "$*" == *"State.Status"* ]]; then echo "${FC_CONTAINER_STATUS:-running}"; exit 0; fi',
    'if [[ "$*" == *"State.Health"* ]]; then echo "${FC_CONTAINER_HEALTH:-healthy}"; exit 0; fi',
    'if [[ "$*" == *"compose"* && "$*" == *"up"* ]]; then exit "${FC_COMPOSE_UP_RC:-0}"; fi',
    'exit 0',
  ])
  write('npm', [
    'echo "npm-db: DB_NAME=${DB_NAME:-} DB_HOST=${DB_HOST:-} DB_PORT=${DB_PORT:-} DB_USER=${DB_USER:-}" >> "$FC_CALL_LOG"',
    'exit "${FC_NPM_RC:-0}"',
  ])

  const res = spawnSync('bash', [scriptPath, action, ...extraArgs], {
    env: {
      ...process.env,
      ...env,
      PATH: `${bin}:${process.env.PATH}`,
      FC_CALL_LOG: log,
      FC_PROFILE_MARKER: marker,
      FC_CONTEXT_ENDPOINT: contextEndpoint,
      FC_CONTAINER_STATUS: containerStatus,
      FC_CONTAINER_HEALTH: containerHealth,
      FC_COMPOSE_UP_RC: String(composeUpRc),
      FC_NPM_RC: String(npmRc),
    },
    encoding: 'utf8',
  })
  return {
    res,
    calls: fs.readFileSync(log, 'utf8'),
    credPath,
    credExists: fs.existsSync(credPath),
    cleanup: () => { for (const d of created) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* 只清本用例自建路径 */ } } },
  }
}

/** 每个用例统一 finally 自洁（只清本次生成路径）。 */
function withScript(action, opts, fn) {
  const r = runScript(action, opts)
  try { return fn(r) } finally { r.cleanup() }
}

const calledNpm = c => /^npm /m.test(c)
const calledMigrate = c => /backend run migrate/.test(c)
const calledColimaStart = c => /^colima start/m.test(c)
const calledColima = c => /^colima /m.test(c)
const calledComposeUp = c => /docker .*compose .*up/.test(c)
const calledComposeStop = c => /docker .*compose .*stop/.test(c)

// ── start：唯一负责启动；顺序必须先起 profile 再验 context ──────────────────

test('★ 全新环境 start：先 colima start 再检查 context，最后 compose up（顺序保护）', () => withScript('start', { profileUp: false }, ({ res, calls }) => {
  assert.equal(res.status, 0, `全新环境 start 应成功（context 尚不存在时不得提前失败），stderr=${res.stderr}`)
  assert.ok(calledColimaStart(calls), `应先启动 profile，实际：\n${calls}`)
  assert.ok(
    calls.indexOf('colima start') < calls.indexOf('context inspect'),
    `必须先启动 profile 再检查 context（context 由 profile 创建），实际顺序：\n${calls}`,
  )
  assert.ok(calledComposeUp(calls), '应执行 compose up')
}))

test('★ start 只启动实例：绝不调用 npm/migrate', () => withScript('start', {}, ({ res, calls }) => {
  assert.equal(res.status, 0, `stderr=${res.stderr}`)
  assert.ok(!calledNpm(calls), `start 不得调用 npm，实际：\n${calls}`)
  assert.ok(!calledMigrate(calls), `start 不得迁移开发库，实际：\n${calls}`)
}))

test('★ start 时容器启动失败即非 0，且绝不继续迁移', () => withScript('start', { composeUpRc: 1 }, ({ res, calls }) => {
  assert.notEqual(res.status, 0, 'compose up 失败时 start 必须非 0')
  assert.ok(!calledMigrate(calls), `start 失败后不得迁移，实际：\n${calls}`)
}))

test('★ start 缺凭据时会生成配置（这是唯一允许生成的动作用例）', () => withScript('start', { withCred: false }, ({ res, credPath, credExists }) => {
  assert.equal(res.status, 0, `无凭据时应由 start 生成并成功，stderr=${res.stderr}`)
  assert.ok(credExists, 'start 应创建凭据文件')
  assert.match(fs.readFileSync(credPath, 'utf8'), /FLOWCUBE_DEV_MYSQL_ROOT_PASSWORD=/)
}))

test('★ start 拒绝远程 tcp context（禁止把开发容器命令发往远程）', () => withScript('start', { contextEndpoint: 'tcp' }, ({ res, calls }) => {
  assert.notEqual(res.status, 0, 'tcp context 必须被拒绝')
  assert.ok(!calledComposeUp(calls), `不得执行 compose up，实际：\n${calls}`)
  assert.ok(!calledMigrate(calls), '不得迁移')
}))

test('★ 凭据权限不是 600 时 start 非 0（各 action 都做权限检查）', () => withScript('start', { credMode: 0o644 }, ({ res }) => {
  assert.notEqual(res.status, 0, '权限不合规必须非 0')
}))

// ── stop ──────────────────────────────────────────────────────────────────

test('★ stop 只停容器（保留数据卷），不启动、不迁移', () => withScript('stop', { profileUp: true }, ({ res, calls }) => {
  assert.equal(res.status, 0, `stderr=${res.stderr}`)
  assert.ok(calledComposeStop(calls), `应执行 compose stop，实际：\n${calls}`)
  assert.ok(!calledColima(calls), `stop 不得调用 colima，实际：\n${calls}`)
  assert.ok(!calledNpm(calls), 'stop 不得调用 npm')
}))

test('★ stop 缺凭据时非 0：不创建随机凭据、不停容器', () => withScript('stop', { withCred: false, profileUp: true }, ({ res, calls, credExists }) => {
  assert.notEqual(res.status, 0, '缺凭据时 stop 必须失败')
  assert.equal(credExists, false, 'stop 不得创建凭据文件')
  assert.ok(!calledComposeStop(calls), `不得停容器，实际：\n${calls}`)
  assert.ok(!calledNpm(calls), '不得调用 npm')
}))

test('★ 凭据权限不是 600 时 stop 非 0', () => withScript('stop', { profileUp: true, credMode: 0o644 }, ({ res, calls }) => {
  assert.notEqual(res.status, 0, '权限不合规必须非 0')
  assert.ok(!calledComposeStop(calls), '不得继续停容器')
}))

// ── migrate：显式、只检查不启动、目标固定 ─────────────────────────────────

test('★ migrate 就绪时只做迁移：不启动 colima、不 compose up', () => withScript('migrate', { profileUp: true }, ({ res, calls }) => {
  assert.equal(res.status, 0, `stderr=${res.stderr}`)
  assert.ok(calledMigrate(calls), `应执行 backend migrate，实际：\n${calls}`)
  assert.match(calls, /npm-db: DB_NAME=flowcube_dev8 DB_HOST=127\.0\.0\.1 DB_PORT=3307 DB_USER=root/)
  assert.ok(!calledColima(calls), `migrate 绝不得调用 colima，实际：\n${calls}`)
  assert.ok(!calledComposeUp(calls), `migrate 绝不得 compose up，实际：\n${calls}`)
}))

test('★ migrate 的目标不能被外部 DB_* 环境变量改掉', () => withScript('migrate', {
  profileUp: true,
  env: { DB_NAME: 'evil_prod', DB_HOST: '10.0.0.9', DB_PORT: '3306', DB_USER: 'evil' },
}, ({ res, calls }) => {
  assert.equal(res.status, 0, `stderr=${res.stderr}`)
  assert.match(calls, /npm-db: DB_NAME=flowcube_dev8 DB_HOST=127\.0\.0\.1 DB_PORT=3307 DB_USER=root/)
  assert.doesNotMatch(calls, /evil_prod/)
}))

test('★ migrate 不接受任意库名（多余参数即拒绝，且不启动不迁移）', () => withScript('migrate', { profileUp: true, extraArgs: ['some_other_db'] }, ({ res, calls }) => {
  assert.notEqual(res.status, 0, '传入额外库名应被拒绝')
  assert.ok(!calledMigrate(calls), `被拒绝时不得执行迁移，实际：\n${calls}`)
  assert.ok(!calledColima(calls) && !calledComposeUp(calls), '被拒绝时不得启动任何东西')
}))

test('★ profile 未启动时 migrate 非 0：不迁移、且绝不自作主张去启动', () => withScript('migrate', { profileUp: false }, ({ res, calls }) => {
  assert.notEqual(res.status, 0, 'profile 未就绪时 migrate 必须失败')
  assert.ok(!calledMigrate(calls), `不得执行迁移，实际：\n${calls}`)
  assert.ok(!calledColima(calls), `不得调用 colima，实际：\n${calls}`)
  assert.ok(!calledComposeUp(calls), `不得 compose up，实际：\n${calls}`)
  assert.match(res.stderr, /npm run dev:mysql8/, '应提示先运行 start')
}))

test('★ 容器非 running 时 migrate 非 0：不迁移、不启动', () => withScript('migrate', { profileUp: true, containerStatus: 'exited' }, ({ res, calls }) => {
  assert.notEqual(res.status, 0, '容器未运行时应失败')
  assert.ok(!calledMigrate(calls), `不得执行迁移，实际：\n${calls}`)
  assert.ok(!calledColima(calls) && !calledComposeUp(calls), '不得启动任何东西')
}))

test('★ 容器未 healthy 时 migrate 非 0：不迁移', () => withScript('migrate', { profileUp: true, containerHealth: 'starting' }, ({ res, calls }) => {
  assert.notEqual(res.status, 0, '容器未 healthy 时应失败')
  assert.ok(!calledMigrate(calls), `不得执行迁移，实际：\n${calls}`)
}))

test('★ migrate 缺凭据时非 0：不创建随机凭据、不迁移', () => withScript('migrate', { withCred: false, profileUp: true }, ({ res, calls, credExists }) => {
  assert.notEqual(res.status, 0, '缺凭据时 migrate 必须失败')
  assert.equal(credExists, false, 'migrate 不得创建凭据文件')
  assert.ok(!calledMigrate(calls), `不得迁移，实际：\n${calls}`)
  assert.ok(!calledColima(calls) && !calledComposeUp(calls), '不得启动任何东西')
}))

test('★ migrate 拒绝远程 tcp context', () => withScript('migrate', { profileUp: true, contextEndpoint: 'tcp' }, ({ res, calls }) => {
  assert.notEqual(res.status, 0, 'tcp context 必须被拒绝')
  assert.ok(!calledMigrate(calls), '不得迁移')
}))

test('★ 凭据权限不是 600 时 migrate 非 0，且不迁移', () => withScript('migrate', { profileUp: true, credMode: 0o644 }, ({ res, calls }) => {
  assert.notEqual(res.status, 0, '权限不合规必须非 0')
  assert.ok(!calledMigrate(calls), '不得迁移')
}))

test('★ migrate 自身失败即非 0（不吞错误）', () => withScript('migrate', { profileUp: true, npmRc: 1 }, ({ res }) => {
  assert.notEqual(res.status, 0, 'migrate 失败必须透传非 0')
}))

// ── 已有凭据不被覆盖 ──────────────────────────────────────────────────────

test('★ 已有凭据文件时，start 不改写其内容', () => withScript('start', {}, ({ res, credPath }) => {
  assert.equal(res.status, 0, `stderr=${res.stderr}`)
  assert.ok(fs.readFileSync(credPath, 'utf8').includes(CRED_MARK), '既有凭据不得被覆盖')
}))
