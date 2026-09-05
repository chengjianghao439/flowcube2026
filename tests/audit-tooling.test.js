'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const testEnv = () => ({ NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USER: 'test_user', DB_PASSWORD: 'fixture-only', DB_NAME: 'flowcube_test' })

test('数据库回归只接受显式本机测试库，拒绝默认业务库与生产环境', () => {
  const { validateTestEnvironment } = require('./helpers/testEnvironment')
  assert.equal(validateTestEnvironment(testEnv()).database, 'flowcube_test')
  assert.equal(validateTestEnvironment({ ...testEnv(), DB_NAME: 'flowcube_inventory_test' }).port, 3306)
  for (const change of [{ NODE_ENV: 'production' }, { DB_NAME: 'flowcube' }, { DB_HOST: 'production.example.invalid' }, { DB_NAME: '' }, { DB_PORT: '3306junk' }, { DB_USER: '' }]) {
    assert.throws(() => validateTestEnvironment({ ...testEnv(), ...change }))
  }
  assert.throws(() => validateTestEnvironment({}))
})

test('仅显式加载测试环境文件，调用者变量优先且不能选择真实 .env', () => {
  const { configureTestEnvironment } = require('./helpers/testEnvironment')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-test-env-'))
  try {
    const file = path.join(dir, '.env.test')
    fs.writeFileSync(file, 'NODE_ENV=test\nDB_HOST=127.0.0.1\nDB_PORT=3306\nDB_USER=fixture\nDB_PASSWORD=fixture\nDB_NAME=flowcube_from_file_test\n')
    const env = { DB_NAME: 'flowcube_override_test' }
    configureTestEnvironment({ env, file })
    assert.equal(env.DB_NAME, 'flowcube_override_test')
    assert.equal(env.DB_USER, 'fixture')
    assert.throws(() => configureTestEnvironment({ env: testEnv(), file: path.join(dir, '.env') }), /\.env\.test/)
    assert.throws(() => configureTestEnvironment({ env: {} }))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('Node 22 标签镜像必须实际执行所有快照，不能跳过', () => {
  const result = spawnSync(process.execPath, ['tests/label-geometry-frontend.test.js'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /两端一致（5 例）/)
  assert.doesNotMatch(result.stdout, /跳过：当前 Node/)
})

test('依赖审计拒绝网络错误、空/损坏JSON及缺少字段的伪成功', () => {
  const { analyzeAudit } = require('../scripts/check-npm-audit')
  for (const raw of ['', '{', '{}', '{"error":{"code":"ECONNRESET"}}', '{"vulnerabilities":{}}']) {
    assert.throws(() => analyzeAudit(raw), /审计/)
  }
  const valid = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } }
  assert.equal(analyzeAudit(JSON.stringify(valid)).blocking, 0)
})

test('依赖审计同时阻断直接和传递高危并保留完整报告', () => {
  const { analyzeAudit } = require('../scripts/check-npm-audit')
  const result = analyzeAudit(JSON.stringify({ auditReportVersion: 2, metadata: { vulnerabilities: { total: 3 } }, vulnerabilities: {
    direct: { severity: 'high', isDirect: true, via: ['fixture'] },
    indirect: { severity: 'critical', isDirect: false, via: ['fixture'] },
    lower: { severity: 'moderate', isDirect: true, via: [] },
  } }))
  assert.equal(result.blocking, 2)
  assert.equal(result.findings.length, 3)
})

test('发布只认同一 SHA、main、可信事件下的最新成功工作流', () => {
  const { assessRuns } = require('../scripts/wait-release-checks')
  const sha = 'a'.repeat(40)
  const good = { id: 1, run_attempt: 1, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }
  assert.equal(assessRuns([good], sha).state, 'success')
  assert.equal(assessRuns([{ ...good, head_sha: 'b'.repeat(40) }], sha).state, 'pending')
  assert.equal(assessRuns([{ ...good, event: 'pull_request' }], sha).state, 'pending')
  assert.equal(assessRuns([{ ...good, head_branch: 'feature' }], sha).state, 'pending')
  assert.equal(assessRuns([good, { ...good, id: 2, conclusion: 'failure' }], sha).state, 'failed')
  assert.equal(assessRuns([good, { ...good, run_attempt: 2, status: 'in_progress', conclusion: null }], sha).state, 'pending')
  assert.throws(() => assessRuns({}, sha))
})

test('发布检查轮询真实 API 契约，两个工作流成功后才放行', async () => {
  const { waitForChecks } = require('../scripts/wait-release-checks')
  const sha = 'a'.repeat(40), calls = []
  let tick = 0
  const result = await waitForChecks({ repository: 'fixture/repo', sha, token: 'fixture', now: () => tick, sleep: async ms => { tick += ms }, intervalMs: 10, timeoutMs: 100, log: () => {},
    fetchImpl: async (url, init) => {
      calls.push(url.toString())
      assert.equal(url.searchParams.get('head_sha'), sha)
      assert.match(init.headers.Authorization, /^Bearer /)
      return { ok: true, json: async () => ({ workflow_runs: tick ? [{ id: 1, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }] : [] }) }
    } })
  assert.equal(result.length, 2)
  assert.equal(calls.length, 4)
  assert.ok(calls.some(url => url.includes('test.yml')))
  assert.ok(calls.some(url => url.includes('security-scan.yml')))
})

test('查询失败、损坏检查结果、超时和检查失败均拒绝发布', async () => {
  const { waitForChecks } = require('../scripts/wait-release-checks')
  const base = { repository: 'fixture/repo', sha: 'a'.repeat(40), token: 'fixture', timeoutMs: 0, log: () => {} }
  for (const response of [
    { ok: false, status: 403 },
    { ok: true, json: async () => ({}) },
    { ok: true, json: async () => ({ workflow_runs: [] }) },
    { ok: true, json: async () => ({ workflow_runs: [{ id: 2, head_sha: base.sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'failure' }] }) },
  ]) await assert.rejects(waitForChecks({ ...base, fetchImpl: async () => response }))
})
