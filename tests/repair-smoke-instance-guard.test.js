#!/usr/bin/env node
'use strict'

/**
 * 修复专项「本批临时实例归属门」契约测试（**不连数据库**）。
 *
 * 背景：2026-09-29 在既有库 `flowcube_repair20260908_test`（回环 3307）上误跑了两个含全表清理的
 * 修复 smoke，把 16 张表清空（`docs/incident-repair-db-2026-09-29.md`）。库名硬断言与 `_test`
 * 后缀都只能证明「库名像测试库」，证明不了「这个库归本批所有」。
 *
 * 两轮独立审查后，本测试**不以源码字符串为主要证据**，而是分四层做行为验证：
 *   ① 纯判定 `evaluateOwnership`：容器/卷/时间窗反例逐条必拒，且逐条断言「输入确实变了」；
 *   ② 真实模块 `assertOwnedRepairInstance`：注入 stub 连接与 stub 容器/卷探针，端到端验证
 *      「伪造文件 / 错配容器 / 复用旧卷 / 探针失败」一律拒绝；
 *   ③ 三个会写入文件的结构契约：门在首次写入之前，且未过门时只关连接、不 cleanup；
 *   ④ **runner 行为**：用 stub 的 docker/npm 运行真实 `scripts/repair-smoke-ephemeral.sh`，
 *      验证「context 检查在最前、拒绝复用、创建成功后才置清理标记、建库前自检、清理失败即非 0」。
 *
 * 运行：npm run test:repair-smoke-instance-guard
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const SCRIPT_SRC = path.join(ROOT, 'scripts', 'repair-smoke-ephemeral.sh')
const RUNNER_SRC = fs.readFileSync(SCRIPT_SRC, 'utf8')
const {
  SHARED_INSTANCE_PORTS,
  OWNERSHIP_FILE_ENV,
  OWNERSHIP_WINDOW_MS,
  BATCH_LABEL,
  ROLE_LABEL,
  ROLE_VALUE,
  normalizeInspect,
  normalizeVolumeInspect,
  evaluateOwnership,
  assertOwnedRepairInstance,
} = require('./helpers/repairInstanceOwnership')

// ══════════════════════════════════════════════════════════════════════════════════════
// ① 纯判定反例矩阵
// ══════════════════════════════════════════════════════════════════════════════════════

const DB = 'flowcube_repair20260908_test'
const BATCH = '20260929235959-abcdef'
const CONTAINER_ID = 'c'.repeat(64)
const CONTAINER_NAME = `flowcube-repair-ephemeral-${BATCH}`
const VOLUME = `flowcube-repair-ephemeral-${BATCH}-data`
const CONTAINER_CREATED = '2026-09-29T23:58:00.000Z'
const VOLUME_CREATED = '2026-09-29T23:57:30.000Z'
const FILE_CREATED = '2026-09-29T23:59:59.000Z'
const NOW = Date.parse(FILE_CREATED) + 60_000
const RUNNER_PID = 4242
const RUNNER_STARTED = 'Mon Sep 29 23:47:00 2026'

function goodInput(overrides = {}) {
  const evidence = {
    batchId: BATCH, containerId: CONTAINER_ID, containerName: CONTAINER_NAME,
    containerCreatedAt: CONTAINER_CREATED, volumeName: VOLUME, volumeCreatedAt: VOLUME_CREATED,
    host: '127.0.0.1', hostPort: 49153, serverUuid: 'uuid-本批', database: DB, createdAt: FILE_CREATED,
    runnerPid: RUNNER_PID, runnerStarted: RUNNER_STARTED,
    ...(overrides.evidence || {}),
  }
  const container = {
    id: CONTAINER_ID, name: CONTAINER_NAME, running: true, created: CONTAINER_CREATED,
    labels: { [BATCH_LABEL]: BATCH, [ROLE_LABEL]: ROLE_VALUE },
    mounts: [{ name: VOLUME, destination: '/var/lib/mysql' }],
    ports: [{ containerPort: 3306, hostIp: '127.0.0.1', hostPort: '49153' }],
    ...(overrides.container || {}),
  }
  const volume = {
    name: VOLUME, labels: { [BATCH_LABEL]: BATCH, [ROLE_LABEL]: ROLE_VALUE }, createdAt: VOLUME_CREATED,
    ...(overrides.volume || {}),
  }
  return {
    config: { host: '127.0.0.1', port: 49153, database: DB, ...(overrides.config || {}) },
    evidenceFile: 'evidenceFile' in overrides ? overrides.evidenceFile : '/tmp/x.json',
    evidence,
    fileStat: { mode: 0o600, uid: 501, ...(overrides.fileStat || {}) },
    instance: overrides.instance === null ? null : { serverUuid: 'uuid-本批', ...(overrides.instance || {}) },
    container: overrides.container === null ? null : container,
    volume: overrides.volume === null ? null : volume,
    runner: overrides.runner === null ? null : { alive: true, startedAt: RUNNER_STARTED, ...(overrides.runner || {}) },
    containerProbeError: overrides.containerProbeError || null,
    volumeProbeError: overrides.volumeProbeError || null,
    uid: 501,
    now: overrides.now === undefined ? NOW : overrides.now,
  }
}

test('判定：只有「本批容器 + 本批卷 + 时间窗 + 实例身份」全部对上才放行', () => {
  assert.deepEqual(evaluateOwnership(goodInput()), { ok: true }, '合规基线必须放行')

  const rejects = [
    ['共享端口 3307（事故现场）', { config: { port: 3307 } }],
    ['共享端口 3306（旧实例）', { config: { port: 3306 } }],
    ['非回环主机', { config: { host: '10.0.0.5' } }],
    ['未提供归属文件路径（可自填 env 不算证据）', { evidenceFile: undefined }],
    ['归属文件缺失/不可解析', { evidence: null, fileStat: null, container: null, volume: null }],
    ['归属文件缺字段', { evidence: { containerId: undefined } }],
    ['归属文件缺卷创建时间', { evidence: { volumeCreatedAt: undefined } }],
    ['归属文件权限过宽（0644）', { fileStat: { mode: 0o644, uid: 501 } }],
    ['归属文件属主不是当前用户', { fileStat: { mode: 0o600, uid: 999 } }],
    ['归属文件 hostPort 与实际连接不符', { evidence: { hostPort: 49154 } }],
    ['归属文件 database 与实际连接不符', { evidence: { database: 'flowcube_other_test' } }],
    // 时间窗：拒绝上次运行残留的旧证明文件。
    ['归属文件过旧（疑似上次运行残留）', { now: NOW + OWNERSHIP_WINDOW_MS + 1000 }],
    // 本轮活跃归属：时间窗内但 runner 已经不在的残留证明也必须拒绝。
    ['归属文件缺 runnerPid', { evidence: { runnerPid: undefined } }],
    ['归属文件 runnerPid 非法', { evidence: { runnerPid: 'abc' } }],
    ['runner 进程已不存活（本轮已终止的残留证明）', { runner: { alive: false, startedAt: null } }],
    ['runner 探针为空', { runner: null }],
    ['runner 启动身份不匹配（PID 被复用）', { runner: { startedAt: 'Mon Sep 29 20:00:00 2026' } }],
    // 容器交叉核验。
    ['容器探针失败（既有实例被转发到别的端口）', { container: null, containerProbeError: 'No such container', volume: null }],
    ['未取得容器信息', { container: null }],
    ['容器 Id 与归属文件不一致', { container: { id: 'd'.repeat(64) } }],
    ['容器未在运行', { container: { running: false } }],
    ['容器名不符', { container: { name: 'some-existing-container' } }],
    ['容器 Created 与归属文件不一致', { container: { created: '2026-09-29T23:00:00.000Z' } }],
    ['容器创建时间超出时间窗（残留旧容器）', { evidence: { containerCreatedAt: '2026-09-29T20:00:00.000Z' }, container: { created: '2026-09-29T20:00:00.000Z' } }],
    ['容器缺少本批 label', { container: { labels: { [BATCH_LABEL]: '别的批次', [ROLE_LABEL]: ROLE_VALUE } } }],
    ['容器缺少本批角色 label', { container: { labels: { [BATCH_LABEL]: BATCH, [ROLE_LABEL]: 'other' } } }],
    ['容器未挂载本批数据卷', { container: { mounts: [{ name: '别人的卷', destination: '/var/lib/mysql' }] } }],
    ['容器未把本批卷挂到 /var/lib/mysql', { container: { mounts: [{ name: VOLUME, destination: '/tmp' }] } }],
    ['容器端口映射 hostPort 与归属文件不符', { container: { ports: [{ containerPort: 3306, hostIp: '127.0.0.1', hostPort: '49154' }] } }],
    ['容器端口未绑回环', { container: { ports: [{ containerPort: 3306, hostIp: '0.0.0.0', hostPort: '49153' }] } }],
    // 数据卷交叉核验（防「新容器挂旧卷」）。
    ['卷探针失败', { volume: null, volumeProbeError: 'No such volume' }],
    ['卷名不符', { volume: { name: '别人的卷' } }],
    ['卷缺少本批 label（新容器挂旧卷）', { volume: { labels: {} } }],
    ['卷 CreatedAt 与归属文件不一致', { volume: { createdAt: '2026-09-29T22:00:00.000Z' } }],
    // 实例实时身份。
    ['实例 server_uuid 与归属文件不符', { instance: { serverUuid: 'uuid-别的实例' } }],
    ['实例身份查询失败', { instance: null }],
  ]

  const base = goodInput()
  for (const [label, patch] of rejects) {
    const input = goodInput(patch)
    assert.notDeepEqual(input, base, `负例「${label}」并没有真正改变输入（overrides 未生效）`)
    const verdict = evaluateOwnership(input)
    assert.equal(verdict.ok, false, `必须拒绝：${label}`)
    assert.ok(verdict.reason && verdict.reason.length > 0, `拒绝时应给出原因：${label}`)
  }

  // 库名合规不能替代归属证据。
  assert.equal(
    evaluateOwnership(goodInput({ config: { database: 'flowcube_anything_test' }, evidence: null, fileStat: null, container: null, volume: null })).ok,
    false,
    '库名合规不能替代归属证据',
  )
  assert.ok(SHARED_INSTANCE_PORTS.includes(3307) && SHARED_INSTANCE_PORTS.includes(3306))
})

test('判定：docker inspect / volume inspect 原始结构归一化正确', () => {
  const normalized = normalizeInspect({
    Id: CONTAINER_ID,
    Name: `/${CONTAINER_NAME}`,
    State: { Running: true },
    Config: { Labels: { [BATCH_LABEL]: BATCH, [ROLE_LABEL]: ROLE_VALUE } },
    Mounts: [{ Name: VOLUME, Destination: '/var/lib/mysql' }],
    NetworkSettings: { Ports: { '3306/tcp': [{ HostIp: '127.0.0.1', HostPort: '49153' }] } },
    Created: CONTAINER_CREATED,
  })
  assert.equal(normalized.name, CONTAINER_NAME, '前导斜杠必须去掉')
  assert.equal(normalized.running, true)
  assert.equal(normalized.created, CONTAINER_CREATED)
  assert.deepEqual(normalized.ports, [{ containerPort: 3306, hostIp: '127.0.0.1', hostPort: '49153' }])
  assert.deepEqual(normalized.mounts, [{ name: VOLUME, destination: '/var/lib/mysql' }])

  const vol = normalizeVolumeInspect({
    Name: VOLUME, Labels: { [BATCH_LABEL]: BATCH }, CreatedAt: VOLUME_CREATED, Driver: 'local',
  })
  assert.deepEqual(vol, { name: VOLUME, labels: { [BATCH_LABEL]: BATCH }, createdAt: VOLUME_CREATED, driver: 'local' })
})

// ══════════════════════════════════════════════════════════════════════════════════════
// ② 真实模块端到端（stub 连接 + stub 探针；不连库、不连 docker）
// ══════════════════════════════════════════════════════════════════════════════════════

test('真实模块：伪造/错配/残留证据一律在写入前拒绝', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-repair-guard-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const config = { host: '127.0.0.1', port: 49153, database: DB }
  const evidence = goodInput().evidence
  const writeEvidence = (name, obj, mode = 0o600) => {
    const file = path.join(dir, name)
    fs.writeFileSync(file, JSON.stringify(obj), { mode, flag: 'wx' })
    return file
  }
  const conn = (uuid) => ({ query: async () => [[{ serverUuid: uuid }]] })
  const inspectOk = async () => goodInput().container
  const volumeOk = async () => goodInput().volume
  const runnerAlive = async () => ({ alive: true, startedAt: RUNNER_STARTED })
  const file = writeEvidence('ok.json', evidence)
  const env = { [OWNERSHIP_FILE_ENV]: file }
  const opts = { env, config, inspectContainer: inspectOk, inspectVolume: volumeOk, probeRunner: runnerAlive, now: NOW }

  const ok = await assertOwnedRepairInstance(conn('uuid-本批'), opts)
  assert.equal(ok.batchId, BATCH)
  assert.equal(ok.volumeName, VOLUME)

  // 「既有实例被转发到别的端口 + 自填一份合规文件」：容器探针查不到 → 必须拒绝。
  await assert.rejects(
    assertOwnedRepairInstance(conn('uuid-本批'), {
      ...opts, inspectContainer: async () => { throw new Error('Error: No such object') },
    }),
    /拒绝写入/, '探针失败（伪造/错配证据）必须拒绝',
  )
  await assert.rejects(
    assertOwnedRepairInstance(conn('uuid-本批'), { ...opts, inspectContainer: async () => null }),
    /拒绝写入/, '容器探针返回空必须拒绝',
  )
  // 「新容器挂旧卷」：容器一切正常，但卷不带本批 label → 必须拒绝。
  await assert.rejects(
    assertOwnedRepairInstance(conn('uuid-本批'), { ...opts, inspectVolume: async () => ({ ...goodInput().volume, labels: {} }) }),
    /拒绝写入/, '卷缺少本批 label 必须拒绝',
  )
  await assert.rejects(
    assertOwnedRepairInstance(conn('uuid-本批'), { ...opts, inspectVolume: async () => { throw new Error('No such volume') } }),
    /拒绝写入/, '卷探针失败必须拒绝',
  )
  // 残留旧证明：把「现在」推到时间窗之外。
  await assert.rejects(
    assertOwnedRepairInstance(conn('uuid-本批'), { ...opts, now: NOW + OWNERSHIP_WINDOW_MS + 1000 }),
    /拒绝写入/, '超出时间窗的旧证明必须拒绝',
  )
  // 本轮活跃归属：证明文件仍在窗口内，但 runner 进程已不在（本轮中止的残留）→ 必须拒绝。
  await assert.rejects(
    assertOwnedRepairInstance(conn('uuid-本批'), { ...opts, probeRunner: async () => ({ alive: false, startedAt: null }) }),
    /拒绝写入/, 'runner 不存活的残留证明必须拒绝',
  )
  await assert.rejects(
    assertOwnedRepairInstance(conn('uuid-本批'), { ...opts, probeRunner: async () => ({ alive: true, startedAt: 'Mon Sep 29 20:00:00 2026' }) }),
    /拒绝写入/, 'runner 启动身份不匹配（PID 复用）必须拒绝',
  )
  await assert.rejects(
    assertOwnedRepairInstance(conn('uuid-本批'), {
      ...opts, inspectContainer: async () => ({ ...goodInput().container, labels: { [BATCH_LABEL]: '别的批次', [ROLE_LABEL]: ROLE_VALUE } }),
    }),
    /拒绝写入/, '容器 label 不符必须拒绝',
  )
  await assert.rejects(
    assertOwnedRepairInstance(conn('uuid-别的实例'), opts),
    /拒绝写入/, '实例身份不符必须拒绝',
  )
  await assert.rejects(
    assertOwnedRepairInstance(conn('uuid-本批'), { ...opts, env: {} }),
    /拒绝写入/, '未提供归属文件路径必须拒绝',
  )

  const wide = writeEvidence('wide.json', evidence, 0o644)
  await assert.rejects(
    assertOwnedRepairInstance(conn('uuid-本批'), { ...opts, env: { [OWNERSHIP_FILE_ENV]: wide } }),
    /权限过宽/, '权限过宽的归属文件必须拒绝',
  )
  await assert.rejects(
    assertOwnedRepairInstance(conn('uuid-本批'), { ...opts, config: { ...config, port: 3307 } }),
    /共享\/长期实例端口/, '共享端口必须拒绝',
  )
})

// ══════════════════════════════════════════════════════════════════════════════════════
// ③ 三个会写入文件的结构契约（含变异反向验证）
// ══════════════════════════════════════════════════════════════════════════════════════

const GUARDED_FILES = [
  { file: 'tests/legacy-purchase-repair.smoke.test.js', firstWrite: /await\s+cleanup\(\)/ },
  { file: 'tests/legacy-receivable-repair.smoke.test.js', firstWrite: /await\s+seed\(\)/ },
  { file: 'tests/audit-business-consistency.smoke.test.js', firstWrite: /INSERT\s+INTO/ },
]

const HARD_DB_ASSERT = /assert\.equal\(\s*config\.database\s*,\s*'flowcube_repair20260908_test'\s*\)/
const GUARD_REQUIRE = /require\(\s*'\.\/helpers\/repairInstanceOwnership'\s*\)/
const CONN_DECL = /const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+mysql\.createConnection/
const GUARD_CALL = /await\s+assertOwnedRepairInstance\(\s*([A-Za-z_$][\w$]*)\s*,/
const AUTH_FLAG = /let\s+authorized\s*=\s*false/
const AUTH_GUARDED_CLEANUP = /if\s*\(\s*authorized\s*\)/

/** 只剔**整行**注释（按 `//` 全剔会砍掉 `http://127.0.0.1` 的后半行——AGENTS.md 红线）。 */
function stripComments(src) {
  return src.split('\n').map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? '' : line)).join('\n')
}

/** shell 版：只剔整行 `#` 注释（runner 的注释里会**引用**被禁写法来解释为什么不使用它）。 */
function stripBashComments(src) {
  return src.split('\n').map((line) => (/^\s*#/.test(line) ? '' : line)).join('\n')
}

/** 返回 `null`（合规）或原因字符串；抽成函数以便对**变异源码**做反向验证。 */
function findOrderViolation(src, firstWriteRe) {
  const body = stripComments(src)
  if (!GUARD_REQUIRE.test(body)) return '未 require 归属门 helper'
  if (!HARD_DB_ASSERT.test(body)) return '硬库名断言被删改（不得为跑测试而放宽）'
  if (!AUTH_FLAG.test(body)) return '缺少 authorized 标志（无法保证未过门时不 cleanup）'
  if (!AUTH_GUARDED_CLEANUP.test(body)) return 'cleanup 未被 authorized 守卫'

  const conn = CONN_DECL.exec(body)
  if (!conn) return '找不到 mysql.createConnection 声明（结构变化？）'
  const call = GUARD_CALL.exec(body)
  if (!call) return '找不到 assertOwnedRepairInstance 调用'
  if (call[1] !== conn[1]) return `门调用用的连接变量 ${call[1]} 与 createConnection 的 ${conn[1]} 不一致`

  const firstWrite = firstWriteRe.exec(body)
  if (!firstWrite) return '找不到预期的首次写入动作（结构变化？本测试需要同步更新）'
  if (call.index > firstWrite.index) return '归属门调用晚于首次写入动作——cleanup/写入会先落地'
  return null
}

test('三个会写入文件：门在首次写入之前，且未过门只关连接不 cleanup', () => {
  for (const { file, firstWrite } of GUARDED_FILES) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
    assert.equal(findOrderViolation(src, firstWrite), null, `${file} 结构契约不满足`)

    const removeLine = (re) => {
      const out = src.replace(re, '')
      assert.notEqual(out, src, `${file} 变异失败：未匹配到目标行`)
      return out
    }
    assert.match(
      findOrderViolation(removeLine(/^[ \t]*await\s+assertOwnedRepairInstance\([^\n]*\n/m), firstWrite) || '',
      /找不到 assertOwnedRepairInstance 调用/, `${file} 删除门调用后必须被判违规`,
    )
    assert.match(
      findOrderViolation(removeLine(/^[ \t]*let authorized = false\n/m), firstWrite) || '',
      /缺少 authorized 标志/, `${file} 删除 authorized 标志后必须被判违规`,
    )
    const moved = (() => {
      const m = src.match(/^[ \t]*await\s+assertOwnedRepairInstance\([^\n]*\n/m)
      return src.replace(m[0], '') + `\n${m[0]}`
    })()
    assert.match(
      findOrderViolation(moved, firstWrite) || '',
      /晚于首次写入动作/, `${file} 门调用后移必须被判违规`,
    )
  }
})

// ══════════════════════════════════════════════════════════════════════════════════════
// ④ runner 行为（stub docker/npm 运行真实脚本）
// ══════════════════════════════════════════════════════════════════════════════════════

/**
 * docker stub：记录调用、按 FC_STUB_* 改变行为。
 * 容器名形如 `flowcube-repair-ephemeral-<batchId>`，stub 从中派生出「本批」的 batchId 与卷名，
 * 让 `docker inspect` / `docker volume inspect` 的答案与 runner 自己生成的标识一致。
 */
const DOCKER_STUB = `#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const crypto = require('node:crypto')
const args = process.argv.slice(2)
if (process.env.FC_STUB_LOG) fs.appendFileSync(process.env.FC_STUB_LOG, JSON.stringify(args) + '\\n')
const sp = process.env.FC_STUB_STATE
const st = JSON.parse(fs.readFileSync(sp, 'utf8'))
const save = () => fs.writeFileSync(sp, JSON.stringify(st))
const flag = (n) => { const i = args.lastIndexOf(n); return i >= 0 ? args[i + 1] : null }
const labelsOf = () => {
  const out = {}
  args.forEach((a, i) => { if (a === '--label' && args[i + 1] && String(args[i + 1]).includes('=')) {
    const idx = String(args[i + 1]).indexOf('='); out[String(args[i + 1]).slice(0, idx)] = String(args[i + 1]).slice(idx + 1)
  } })
  return out
}
const batchOf = (name) => String(name || '').replace(/^flowcube-repair-ephemeral-/, '')
const volOf = (name) => 'flowcube-repair-ephemeral-' + batchOf(name) + '-data'

if (args[0] === 'context' && args[1] === 'inspect') {
  process.stdout.write(process.env.FC_STUB_BAD_CONTEXT === '1' ? 'tcp://1.2.3.4:2375' : 'unix:///tmp/fc-test.sock')
  process.exit(0)
}
const rest = args[0] === '--context' ? args.slice(2) : args
const cmd = rest[0]
const findCtr = (key) => st.containers.find((c) => c.exists && (c.id === key || c.name === key))

if (cmd === 'ps') {
  const f = flag('--filter') || ''
  const m = /^name=\\^(.+)\\$$/.exec(f)
  const id = f.startsWith('id=') ? f.slice(3) : null
  if (m && process.env.FC_STUB_NAME_TAKEN === '1') { process.stdout.write('f'.repeat(64) + '\\n'); process.exit(0) }
  const hit = id ? st.containers.find((c) => c.exists && c.id === id) : st.containers.find((c) => c.exists && c.name === (m && m[1]))
  process.stdout.write(hit ? hit.id + '\\n' : '')
  process.exit(0)
}
if (cmd === 'volume' && rest[1] === 'ls') {
  const m = /^name=\\^(.+)\\$$/.exec(flag('--filter') || '')
  const hit = m && st.volumes.find((v) => v.name === m[1])
  process.stdout.write(hit ? hit.name + '\\n' : '')
  process.exit(0)
}
if (cmd === 'volume' && rest[1] === 'create') {
  const name = rest[rest.length - 1]
  // docker 真实语义：卷已存在时 create 幂等成功，且**不会**改其 label。
  if (st.volumes.some((v) => v.name === name)) { process.stdout.write(name + '\\n'); process.exit(0) }
  const foreign = process.env.FC_STUB_VOLUME_PREEXISTING === '1'
  st.volumes.push({
    name,
    labels: foreign ? { 'flowcube.repair.batch': 'someone-else' } : labelsOf(),
    createdAt: new Date().toISOString(),
  })
  save(); process.stdout.write(name + '\\n'); process.exit(0)
}
if (cmd === 'volume' && rest[1] === 'rm') {
  if (process.env.FC_STUB_STUCK_VOLUME === '1') process.exit(0)
  st.volumes = st.volumes.filter((v) => v.name !== rest[2]); save(); process.exit(0)
}
if (cmd === 'volume' && rest[1] === 'inspect') {
  const tpl = flag('-f') || ''
  const name = rest[rest.length - 1]
  const v = st.volumes.find((x) => x.name === name)
  if (!v) { process.stderr.write('Error: No such volume: ' + name + '\\n'); process.exit(1) }
  let out = ''
  const keyMatch = /\\.Labels\\s+"([^"]+)"/.exec(tpl)
  if (keyMatch) out = process.env.FC_STUB_VOLUME_LABEL_MISMATCH === '1' ? 'wrong-batch' : (v.labels[keyMatch[1]] || '')
  else if (tpl.includes('.CreatedAt')) out = v.createdAt
  else if (tpl.includes('.Name')) out = v.name
  process.stdout.write(out + '\\n'); process.exit(0)
}
if (cmd === 'create') {
  if (process.env.FC_STUB_CREATE_FAIL === '1') { process.stderr.write('Error: create failed\\n'); process.exit(1) }
  const name = flag('--name')
  const password = args.find((value) => value.startsWith('MYSQL_ROOT_PASSWORD=')) || ''
  st.passwordHash = crypto.createHash('sha256').update(password.slice('MYSQL_ROOT_PASSWORD='.length)).digest('hex')
  st.containers.push({ id: 'c'.repeat(64), name, exists: true, labels: labelsOf(), createdAt: new Date().toISOString() })
  save(); process.stdout.write('c'.repeat(64) + '\\n'); process.exit(0)
}
if (cmd === 'start') { process.exit(0) }
if (cmd === 'rm') {
  if (process.env.FC_STUB_STUCK_CONTAINER === '1') process.exit(0)
  const key = rest[rest.length - 1]
  st.containers = st.containers.filter((c) => c.id !== key && c.name !== key); save(); process.exit(0)
}
if (cmd === 'port') {
  const c = findCtr(rest[1]); if (!c) process.exit(1)
  process.stdout.write((process.env.FC_STUB_PORT || '127.0.0.1:49153') + '\\n'); process.exit(0)
}
if (cmd === 'inspect') {
  const tpl = flag('-f') || ''
  const target = rest[rest.length - 1]
  const c = findCtr(target)
  if (!c) { process.stderr.write('Error: No such object: ' + target + '\\n'); process.exit(1) }
  let out = ''
  if (tpl.includes('.Mounts')) out = volOf(c.name)
  else if (tpl.includes('.Id')) out = c.id
  else if (tpl.includes('.Name')) out = '/' + c.name
  else if (tpl.includes('.Created')) out = c.createdAt
  else if (tpl.includes('flowcube.repair.batch')) out = process.env.FC_STUB_LABEL_MISMATCH === '1' ? 'wrong-batch' : (c.labels['flowcube.repair.batch'] || '')
  else if (tpl.includes('flowcube.repair.role')) out = c.labels['flowcube.repair.role'] || ''
  process.stdout.write(out + '\\n'); process.exit(0)
}
if (cmd === 'exec') {
  const sql = rest.join(' ')
  if (rest.includes('SELECT 1')) {
    st.readinessAttempts = (st.readinessAttempts || 0) + 1
    const password = rest.find((value) => value.startsWith('MYSQL_PWD=')) || ''
    const authenticated = password && crypto.createHash('sha256').update(password.slice('MYSQL_PWD='.length)).digest('hex') === st.passwordHash
    const tcp = rest.includes('--protocol=TCP') && rest.includes('--host=127.0.0.1') && rest.includes('--port=3306')
    st.transportRejected = !tcp
    save()
    if (!tcp || !rest.includes('--connect-timeout=2') || process.env.FC_STUB_SOCKET_ONLY === '1' || st.readinessAttempts <= Number(process.env.FC_STUB_READY_AFTER || 0)) process.exit(1)
    if (!authenticated || process.env.FC_STUB_AUTH_DENIED === '1') { process.stderr.write('ERROR 1045: Access denied (using password: YES)\\n'); process.exit(1) }
    st.authenticated = true; save(); process.stdout.write('1\\n'); process.exit(0)
  }
  // mysqladmin ping reports a running server even when authentication is denied.
  if (rest.includes('mysqladmin')) process.exit(0)
  if (process.env.FC_STUB_STRICT_READINESS === '1' && !st.authenticated) { process.stderr.write('ERROR 1045: Access denied (using password: YES)\\n'); process.exit(1) }
  if (sql.includes('@@server_uuid')) { process.stdout.write('uuid-本批\\n'); process.exit(0) }
  if (sql.includes('SCHEMA_NAME')) { process.stdout.write(process.env.FC_STUB_DB_EXISTS === '1' ? 'flowcube_repair20260908_test\\n' : ''); process.exit(0) }
  process.exit(0)
}
process.exit(0)
`

function runRunner(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-repair-runner-'))
  const stubDir = path.join(dir, 'stub')
  const configDir = path.join(dir, 'config')
  const tmpRoot = path.join(dir, 'root')
  fs.mkdirSync(stubDir, { recursive: true })
  fs.mkdirSync(configDir, { recursive: true })
  fs.mkdirSync(tmpRoot, { recursive: true })

  fs.writeFileSync(path.join(stubDir, 'docker'), DOCKER_STUB, { mode: 0o755 })
  // npm stub：模拟迁移与 smoke 成功，同时把归属文件复制一份供测试检查（真实 smoke 运行时该文件
  // 由归属门读取，这里只验证字段是否齐全且形如真实 runner 写入的内容）。
  fs.writeFileSync(path.join(stubDir, 'npm'), NPM_STUB, { mode: 0o755 })
  fs.writeFileSync(path.join(stubDir, 'sleep'), '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.FC_STUB_SLEEP_LOG, JSON.stringify(process.argv.slice(2)) + "\\n")\n', { mode: 0o755 })

  const log = path.join(dir, 'calls.log')
  const statePath = path.join(dir, 'state.json')
  const ownershipCopy = path.join(dir, 'ownership-copy.json')
  const sleepLog = path.join(dir, 'sleep.log')
  fs.writeFileSync(log, '')
  fs.writeFileSync(sleepLog, '')
  fs.writeFileSync(statePath, JSON.stringify({ containers: [], volumes: [] }))

  // 只替换三处「与环境绑定」的行；其余逻辑原样运行。
  const raw = fs.readFileSync(SCRIPT_SRC, 'utf8')
  let body = raw
    .replace(/^CTX=.*$/m, "CTX='fc-test-ctx'")
    .replace(/^CONFIG_DIR=.*$/m, `CONFIG_DIR="${configDir}"`)
    .replace(/^ROOT=.*$/m, `ROOT="${tmpRoot}"`)
  assert.notEqual(body, raw, 'runner 脚本结构变化：三处环境绑定的替换未生效')
  assert.match(body, new RegExp(`^CONFIG_DIR="${configDir}"$`, 'm'), 'CONFIG_DIR 未被替换')
  if (opts.withoutTcp) {
    const mutant = body.replace('--protocol=TCP ', '')
    assert.notEqual(mutant, body, 'TCP 反证必须确实移除就绪命令的协议绑定')
    body = mutant
  }
  const script = path.join(dir, 'runner.sh')
  fs.writeFileSync(script, body, { mode: 0o755 })

  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      FC_STUB_LOG: log,
      FC_STUB_STATE: statePath,
      FC_STUB_BAD_CONTEXT: opts.badContext ? '1' : '0',
      FC_STUB_CREATE_FAIL: opts.createFail ? '1' : '0',
      FC_STUB_STUCK_CONTAINER: opts.stuckContainer ? '1' : '0',
      FC_STUB_STUCK_VOLUME: opts.stuckVolume ? '1' : '0',
      FC_STUB_LABEL_MISMATCH: opts.labelMismatch ? '1' : '0',
      FC_STUB_VOLUME_LABEL_MISMATCH: opts.volumeLabelMismatch ? '1' : '0',
      FC_STUB_VOLUME_PREEXISTING: opts.volumePreexisting ? '1' : '0',
      FC_STUB_NAME_TAKEN: opts.nameTaken ? '1' : '0',
      FC_STUB_DB_EXISTS: opts.dbExists ? '1' : '0',
      FC_STUB_OWNERSHIP_COPY: ownershipCopy,
      FC_STUB_SLEEP_LOG: sleepLog,
      FC_STUB_STRICT_READINESS: opts.strictReadiness ? '1' : '0',
      FC_STUB_READY_AFTER: String(opts.readyAfter || 0),
      FC_STUB_SOCKET_ONLY: opts.socketOnly ? '1' : '0',
      FC_STUB_AUTH_DENIED: opts.authDenied ? '1' : '0',
    },
  })
  return {
    result, dir,
    calls: fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    state: () => JSON.parse(fs.readFileSync(statePath, 'utf8')),
    configFiles: () => fs.readdirSync(configDir),
    ownership: () => JSON.parse(fs.readFileSync(ownershipCopy, 'utf8')),
    sleeps: () => fs.readFileSync(sleepLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}

const NPM_STUB = [
  '#!/usr/bin/env node',
  "const fs = require('node:fs')",
  'const src = process.env.FLOWCUBE_REPAIR_INSTANCE_FILE',
  'const dst = process.env.FC_STUB_OWNERSHIP_COPY',
  'if (src && dst) { try { fs.copyFileSync(src, dst) } catch {} }',
  'process.exit(0)',
  '',
].join('\n')

/** stub 记录的是原始 argv（可能带 `--context CTX`）；取出其中的 docker 子命令。 */
const cmdOf = (call) => (call[0] === '--context' ? call[2] : call[0])
const subOf = (call) => (call[0] === '--context' ? call[3] : call[1])
const failed = (run) => `status=${run.result.status} stderr=${run.result.stderr}`

test('runner：临时socket服务不算就绪，TCP使用本批口令认证后才读取身份及建库', (t) => {
  const run = runRunner({ strictReadiness: true, readyAfter: 2 })
  t.after(() => run.cleanup())
  assert.equal(run.result.status, 0, failed(run))
  assert.equal(run.state().readinessAttempts, 4, '两次未就绪、一次成功及最后认证确认')
  assert.deepEqual(run.sleeps(), [['2'], ['2']])
  const readiness = run.calls.filter((call) => call.includes('SELECT 1'))
  assert.ok(readiness.every((call) => call.includes('--protocol=TCP') && call.includes('--host=127.0.0.1') && call.includes('--port=3306') && call.includes('--connect-timeout=2')))
  assert.ok(!run.calls.some((call) => call.includes('mysqladmin')))
  const firstIdentity = run.calls.findIndex((call) => call.join(' ').includes('@@server_uuid'))
  assert.ok(firstIdentity > run.calls.findLastIndex((call) => call.includes('SELECT 1')))
  assert.equal(run.state().containers.length, 0)
  assert.equal(run.state().volumes.length, 0)
})

for (const opts of [{ authDenied: true }, { socketOnly: true }, { withoutTcp: true }]) test(`runner：认证/TCP未就绪有限重试后拒绝且清理：${Object.keys(opts)[0]}`, (t) => {
  const run = runRunner({ strictReadiness: true, ...opts })
  t.after(() => run.cleanup())
  assert.notEqual(run.result.status, 0)
  assert.match(run.result.stderr, /TCP.*认证/)
  assert.equal(run.state().readinessAttempts, 91, '90轮重试及最后一次认证确认')
  assert.equal(run.sleeps().length, 90)
  assert.ok(run.sleeps().every((args) => args.length === 1 && args[0] === '2'))
  assert.ok(!run.calls.some((call) => /@@server_uuid|SCHEMA_NAME|CREATE DATABASE/.test(call.join(' '))))
  assert.equal(run.state().containers.length, 0)
  assert.equal(run.state().volumes.length, 0)
  assert.deepEqual(run.configFiles(), [])
  const create = run.calls.find((call) => cmdOf(call) === 'create')
  const password = create.find((value) => value.startsWith('MYSQL_ROOT_PASSWORD=')).slice('MYSQL_ROOT_PASSWORD='.length)
  assert.ok(!(run.result.stdout + run.result.stderr).includes(password), '口令不得出现在runner输出')
  if (opts.withoutTcp) assert.equal(run.state().transportRejected, true)
})

test('runner：正常路径先验 context、先建卷再建容器、建库前自检、结束清理并复查为空', (t) => {
  const run = runRunner()
  t.after(() => run.cleanup())
  assert.equal(run.result.status, 0, `runner 应成功：${failed(run)}`)

  assert.deepEqual(run.calls[0].slice(0, 2), ['context', 'inspect'], '第一个 docker 操作必须是 context 校验')
  const firstVolumeCreate = run.calls.findIndex((c) => cmdOf(c) === 'volume' && subOf(c) === 'create')
  const firstCreate = run.calls.findIndex((c) => cmdOf(c) === 'create')
  const firstStart = run.calls.findIndex((c) => cmdOf(c) === 'start')
  const firstDb = run.calls.findIndex((c) => c.join(' ').includes('CREATE DATABASE'))
  assert.ok(firstVolumeCreate >= 0, '必须显式创建本批数据卷')
  assert.ok(firstCreate > firstVolumeCreate, '数据卷必须先于容器创建')
  assert.ok(firstStart > firstCreate, '容器必须先 create 再 start')
  assert.ok(firstDb > firstStart, '建库必须在容器起来之后')
  assert.ok(
    run.calls.slice(0, firstDb).some((c) => c.includes('inspect') && c.includes('-f')),
    '建库之前必须已做容器/卷归属自检（inspect -f）',
  )
  const containerRm = run.calls.filter((c) => cmdOf(c) === 'rm')
  assert.ok(containerRm.length > 0, '必须清理容器')
  // 清理必须按 `docker create` 返回的精确 ID，绝不能按名字删除（预检「不存在」挡不住并发同名创建）。
  assert.ok(
    containerRm.every((c) => /^[0-9a-f]{64}$/.test(String(c[c.length - 1]))),
    `容器清理必须使用 64 位容器 ID，实际：${JSON.stringify(containerRm)}`,
  )
  assert.ok(run.calls.some((c) => cmdOf(c) === 'volume' && subOf(c) === 'rm'), '必须清理本批数据卷')

  const state = run.state()
  assert.equal(state.containers.filter((c) => c.exists).length, 0, '容器必须已退出')
  assert.equal(state.volumes.length, 0, '数据卷必须已删除')
  assert.deepEqual(run.configFiles(), [], '归属文件必须已删除')

  // 归属文件必须携带真实的本轮身份（容器 ID / 卷名 / runner 进程），供归属门核验。
  const ownership = run.ownership()
  assert.equal(ownership.batchId, ownership.containerName.replace('flowcube-repair-ephemeral-', ''))
  assert.match(String(ownership.containerId), /^[0-9a-f]{64}$/, 'containerId 必须是 docker 返回的精确 ID')
  assert.equal(ownership.volumeName, `${ownership.containerName}-data`)
  assert.equal(ownership.database, 'flowcube_repair20260908_test')
  assert.equal(typeof ownership.runnerPid, 'number')
  assert.ok(ownership.runnerPid > 0, 'runnerPid 必须是真实 POSIX PID')
  assert.ok(ownership.runnerStarted && ownership.runnerStarted.length > 0, 'runnerStarted 必须记录进程启动身份')
})

test('runner：预检为空、create 时却出现异属卷 → 拒绝且不删除别人的卷', (t) => {
  const run = runRunner({ volumePreexisting: true })
  t.after(() => run.cleanup())
  assert.notEqual(run.result.status, 0, '必须失败')
  assert.match(run.result.stderr, /不是本批新建/, '应报告卷归属不符')
  assert.ok(!run.calls.some((c) => cmdOf(c) === 'volume' && subOf(c) === 'rm'), '不得删除不属于本批的卷')
  assert.ok(!run.calls.some((c) => cmdOf(c) === 'create'), '不得创建容器')
  assert.equal(run.state().volumes.length, 1, '异属卷必须保留现场')
  assert.deepEqual(run.configFiles(), [], '不得留下归属文件')
})

test('runner：同名容器已存在时拒绝复用，且不创建任何资源', (t) => {
  const run = runRunner({ nameTaken: true })
  t.after(() => run.cleanup())
  assert.notEqual(run.result.status, 0, '必须失败')
  assert.match(run.result.stderr, /拒绝：同名容器已存在/, '应明确拒绝复用')
  assert.ok(!run.calls.some((c) => cmdOf(c) === 'create'), '拒绝路径不得创建容器')
  assert.ok(!run.calls.some((c) => cmdOf(c) === 'volume' && subOf(c) === 'create'), '拒绝路径不得创建数据卷')
  assert.equal(run.state().volumes.length, 0, '拒绝路径不得留下数据卷')
})

test('runner：context 不是本机 socket 时立刻失败，且不做任何其它 docker 操作', (t) => {
  const run = runRunner({ badContext: true })
  t.after(() => run.cleanup())
  assert.notEqual(run.result.status, 0)
  assert.match(run.result.stderr, /未就绪|Docker socket/, '应提示 context 未就绪')
  assert.equal(run.calls.filter((c) => c[0] !== 'context').length, 0, 'context 校验之前不得做任何其它 docker 操作')
})

test('runner：容器 label 与预期不符时拒绝建库，并保留现场不删除', (t) => {
  const run = runRunner({ labelMismatch: true })
  t.after(() => run.cleanup())
  assert.notEqual(run.result.status, 0, '必须失败')
  assert.match(run.result.stderr, /不是本批新建/, '应报告容器归属不符')
  assert.ok(!run.calls.some((c) => c.join(' ').includes('CREATE DATABASE')), '归属未确认不得建库')
  assert.ok(!run.calls.some((c) => cmdOf(c) === 'rm'), '归属未确认时不得删除容器')
  assert.equal(run.state().containers.filter((c) => c.exists).length, 1, '容器必须保留现场')
})

test('runner：数据卷 label 与预期不符时拒绝建库，并保留现场不删除', (t) => {
  const run = runRunner({ volumeLabelMismatch: true })
  t.after(() => run.cleanup())
  assert.notEqual(run.result.status, 0, '必须失败')
  assert.match(run.result.stderr, /不是本批新建/, '应报告卷归属不符')
  assert.ok(!run.calls.some((c) => c.join(' ').includes('CREATE DATABASE')), '归属未确认不得建库')
  assert.ok(!run.calls.some((c) => cmdOf(c) === 'volume' && subOf(c) === 'rm'), '归属未确认时不得删除卷')
  assert.equal(run.state().volumes.length, 1, '卷必须保留现场')
})

test('runner：docker create 失败时不得按名字去删容器（清理标记只在拿到 ID 后置位）', (t) => {
  const run = runRunner({ createFail: true })
  t.after(() => run.cleanup())
  assert.notEqual(run.result.status, 0, 'create 失败必须非 0')
  assert.ok(!run.calls.some((c) => cmdOf(c) === 'rm'), '未取得容器 ID 时不得执行容器删除')
  assert.ok(run.calls.some((c) => cmdOf(c) === 'volume' && subOf(c) === 'rm'), '本批数据卷仍须清理')
  assert.equal(run.state().volumes.length, 0, '本批数据卷必须已删除')
})

test('runner：清理未能确认退出时必须非 0（不吞失败）', (t) => {
  const run = runRunner({ stuckContainer: true })
  t.after(() => run.cleanup())
  assert.notEqual(run.result.status, 0, '清理失败必须反映为非 0')
  assert.match(run.result.stderr, /清理失败：容器/, '应明确报告清理失败')
})

test('runner：清理标记只在 docker 实际创建成功之后置位', () => {
  const body = stripBashComments(RUNNER_SRC)
  const createIdx = body.indexOf('CTR_ID="$(d create')
  const ctrFlagIdx = body.indexOf('CTR_CREATED=1')
  assert.ok(createIdx >= 0, '找不到 docker create')
  assert.ok(ctrFlagIdx > createIdx, 'CTR_CREATED=1 必须出现在 docker create 之后（否则创建失败会误删同名资源）')
  const volCreateIdx = body.indexOf('d volume create')
  const volFlagIdx = body.indexOf('VOL_CREATED=1')
  assert.ok(volCreateIdx >= 0, '找不到 docker volume create')
  assert.ok(volFlagIdx > volCreateIdx, 'VOL_CREATED=1 必须出现在 docker volume create 之后')
  // 清理不得按名字兜底：所有容器删除都必须以 ID 变量为目标。
  assert.doesNotMatch(body, /d rm -f "\$CTR"/, '不得按容器名兜底删除')
})

// bash 把非 ASCII 单词字符也算作标识符的一部分：`$CTR，` 会被解析成变量 `CTR，` ⇒ `set -u` 下
// `unbound variable`，脚本在真实运行时直接失败。上面「正常路径」的 stub 测试正是这样抓到该缺陷的
// （纯 `bash -n` 语法检查发现不了）。这里补一条静态守卫，防止再犯。
test('runner：$VAR 之后不得紧跟非 ASCII 字符（必须写 ${VAR}）', () => {
  const offenders = []
  stripBashComments(RUNNER_SRC).split('\n').forEach((line, i) => {
    const re = /\$([A-Za-z_][A-Za-z0-9_]*)(?=[^\x00-\x7F])/g
    let m
    while ((m = re.exec(line))) offenders.push(`第 ${i + 1} 行 $${m[1]}（${line.trim()}）`)
  })
  assert.deepEqual(offenders, [], `以下位置在全角字符前直接引用变量，真实运行会 unbound variable：\n${offenders.join('\n')}`)
})
