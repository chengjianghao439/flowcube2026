'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'scripts/smoke-pages.node.js'), 'utf8')
const credentials = {
  SMOKE_USERNAME: 'fixture-main', SMOKE_PASSWORD: 'fixture-main-password',
  SMOKE_LIMITED_USERNAME: 'fixture-limited', SMOKE_LIMITED_PASSWORD: 'fixture-limited-password',
}

// Run the real entry point, but stop at the first child process boundary. No
// browser, dependency install, network, or local credentials can be touched.
function start(env) {
  let childCalls = 0
  const boundary = new Error('child-process-boundary')
  const context = vm.createContext({
    process: { env, pid: 123, cwd: () => root },
    require: name => name === 'child_process'
      ? { spawnSync: () => { childCalls++; throw boundary } }
      : require(name),
  })
  let error
  try { vm.runInContext(source, context, { filename: 'smoke-pages.node.js' }) } catch (caught) { error = caught }
  return { context, error, boundary, childCalls }
}

for (const key of Object.keys(credentials)) {
  for (const value of [undefined, '', '   ']) {
    test(`页面烟雾缺少 ${key} (${JSON.stringify(value)}) 时在启动子进程前拒绝`, () => {
      const env = { ...credentials, [key]: value }
      if (value === undefined) delete env[key]
      const result = start(env)
      assert.match(result.error?.message || '', new RegExp(key))
      assert.equal(result.childCalls, 0)
      assert.doesNotMatch(result.error.message, /fixture-main-password|fixture-limited-password/)
    })
  }
}

test('两组凭据完整时使用显式值，保留受限账号的 403 与授权页面检查', () => {
  const result = start(credentials)
  assert.equal(result.error, result.boundary)
  assert.equal(result.childCalls, 1)
  for (const [name, value] of Object.entries(credentials)) assert.equal(vm.runInContext(name, result.context), value)
  assert.match(source, /loginAs\(SMOKE_LIMITED_USERNAME, SMOKE_LIMITED_PASSWORD,/)
  assert.match(source, /await assertForbidden\('\/picking-waves'\)/)
  assert.match(source, /await setHashAndConfirm\('\/inbound-tasks\/new'\)/)
})

test('部署工作流从 Secrets 注入并无损转义、转发两组烟雾凭据', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-browser.yml'), 'utf8')
  const block = workflow.match(/          printf -v REMOTE_COMMAND[^\n]*(?:\n[^\n]*)*? bash -s\n/)?.[0]
  assert.ok(block, '远程命令必须保持逐项 %q 转义')
  const env = { ...process.env }
  for (const name of Object.keys(credentials)) {
    assert.ok(workflow.includes(name + ': ${{ secrets.' + name + ' }}'), `${name} 未从 Secrets 注入`)
    env[name] = `fixture ' \" $() \` ; spaces ${name}`
  }
  // Replace workflow expression placeholders only; execute the actual shell
  // forwarding block with inert fixture values and a local remote-shell stand-in.
  const shell = block.replace(/\$\{\{[^}]+\}\}/g, 'fixture') + '\neval "env -i $REMOTE_COMMAND" <<\'REMOTE_PROBE\'\n' +
    JSON.stringify(process.execPath) + ' -e \'process.stdout.write(JSON.stringify(Object.fromEntries(' +
    JSON.stringify(Object.keys(credentials)) + '.map(k => [k, process.env[k]]))))\'\nREMOTE_PROBE\n'
  const result = spawnSync('bash', ['-c', shell], { env, encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), Object.fromEntries(Object.keys(credentials).map(name => [name, env[name]])))
})

test('部署步骤在首次 SSH、上传和迁移前校验所有烟雾 Secrets', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-browser.yml'), 'utf8')
  const step = workflow.split('- name: Deploy backend and frontend on server')[1]
  const prefix = step.split('run: |')[1].split('BOOTSTRAP_SCRIPT=')[0]
  assert.doesNotMatch(prefix, /\b(?:ssh|scp)\s|server-update\.sh/)
  for (const name of Object.keys(credentials)) {
    const env = { PATH: process.env.PATH, ...credentials, [name]: '' }
    const result = spawnSync('bash', ['-c', prefix], { env, encoding: 'utf8', timeout: 5000 })
    assert.notEqual(result.status, 0, `${name} 缺失时必须拒绝部署`)
    assert.match(result.stderr, new RegExp(name))
    assert.doesNotMatch(result.stderr, /fixture-main-password|fixture-limited-password/)
  }
  const result = spawnSync('bash', ['-c', prefix], { env: { PATH: process.env.PATH, ...credentials }, encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
})
