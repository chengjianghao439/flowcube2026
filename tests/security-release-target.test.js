'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const script = path.resolve(__dirname, '../scripts/resolve-release-target.cjs')

test('临时Git仓库拒未合入引用/错workflow分支，允许主线历史SHA和准确发布tag', t => {
  assert.ok(fs.existsSync(script), '需要受信目标解析器')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-release-target-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'main'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Security Test')
  fs.writeFileSync(path.join(dir, 'fixture'), 'main'); git('add', 'fixture'); git('commit', '-m', 'main')
  const main = git('rev-parse', 'HEAD')
  git('update-ref', 'refs/remotes/origin/main', main); git('tag', 'v1.0.0')
  git('switch', '-c', 'unreviewed'); fs.writeFileSync(path.join(dir, 'fixture'), 'evil'); git('commit', '-am', 'unreviewed')
  const evil = git('rev-parse', 'HEAD')
  const run = (overrides = {}) => spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', env: {
    ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: main,
    RELEASE_CHECKOUT_REF: '', ...overrides,
  } })
  for (const overrides of [{ RELEASE_CHECKOUT_REF: evil }, { RELEASE_CHECKOUT_REF: 'unreviewed' }, { GITHUB_REF: 'refs/heads/unreviewed' }, { RELEASE_CHECKOUT_REF: '--upload-pack=evil' }]) {
    assert.notEqual(run(overrides).status, 0)
  }
  assert.equal(run({ RELEASE_CHECKOUT_REF: main }).status, 0)
  assert.equal(JSON.parse(run({ RELEASE_CHECKOUT_REF: 'v1.0.0' }).stdout).sha, main)
  assert.equal(run({ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v1.0.0', GITHUB_SHA: main }).status, 0)
  assert.notEqual(run({ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v1.0.0', GITHUB_SHA: evil }).status, 0)
})
