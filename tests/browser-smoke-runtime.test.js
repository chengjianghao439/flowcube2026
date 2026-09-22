'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')

test('页面验收不再逐次启动 npm CLI，成功失败均关闭浏览器', () => {
  for (const name of ['smoke-pages.node.js', 'smoke-reconciliation-jumps.node.js']) {
    const source = fs.readFileSync(path.join(root, 'scripts', name), 'utf8')
    assert.doesNotMatch(source, /spawnSync|@playwright\/cli/)
    assert.match(source, /finally\(\(\) => runtime.close\(\)\)/)
  }
})

test('验收依赖锁定到容器浏览器版本，随镜像交付且不在生产安装', () => {
  const docker = fs.readFileSync(path.join(root, 'Dockerfile.backend'), 'utf8')
  assert.match(docker, /COPY scripts\/browser-smoke\/package\*\.json/)
  const pkg = require('../scripts/browser-smoke/package.json')
  const lock = require('../scripts/browser-smoke/package-lock.json')
  const gate = fs.readFileSync(path.join(root, 'scripts/release-gate.sh'), 'utf8')
  assert.equal(pkg.dependencies['playwright-core'], '1.55.0')
  assert.ok(gate.includes('playwright:v' + pkg.dependencies['playwright-core'] + '-noble'))
  assert.equal(lock.packages['node_modules/playwright-core'].version, '1.55.0')
  assert.match(gate, /compose cp backend:\/opt\/flowcube-browser-smoke/)
  assert.match(gate, /PLAYWRIGHT_RUNTIME_DIR=\/opt\/flowcube-browser-smoke/)
  assert.match(gate, /:ro/)
})

test('同一浏览器复用连接，账号隔离上下文，PDA 单独标签并返回 ERP', async () => {
  const { createRuntime } = require('../scripts/lib/browser-smoke-runtime')
  const events = []
  let pageId = 0
  const browser = { async newContext() {
    events.push('context')
    return { async newPage() {
      const id = ++pageId
      return { async goto(url) { events.push(['goto', id, url]) }, async evaluate(expr) { return expr === 'true' },
        async reload() { events.push(['reload', id]) }, async close() { events.push(['close-page', id]) } }
    }, async close() { events.push('close-context') } }
  }, async close() { events.push('close-browser') } }
  const runtime = createRuntime({ chromium: { async launch() { events.push('launch'); return browser } } })
  try {
    await runtime.run(['open', 'http://localhost/#/login'])
    assert.equal(await runtime.run(['eval', 'true']), 'true')
    await runtime.run(['tab-new', 'http://localhost/#/pda/login'])
    await runtime.reload()
    await runtime.run(['tab-close'])
    await runtime.reload()
    await runtime.run(['open', 'http://localhost/#/login'])
    assert.equal(events.filter(e => e === 'launch').length, 1)
    assert.equal(events.filter(e => e === 'context').length, 2)
    assert.deepEqual(events.filter(e => Array.isArray(e) && e[0] === 'reload'), [['reload', 2], ['reload', 1]])
    await assert.rejects(runtime.run(['unknown']), /不支持/)
  } finally { await runtime.close(); await runtime.close() }
  assert.equal(events.filter(e => e === 'close-browser').length, 1)
})

test('导航失败也能清理已启动浏览器，不输出表达式中的登录凭据', async () => {
  const { createRuntime } = require('../scripts/lib/browser-smoke-runtime')
  let closed = false
  const runtime = createRuntime({ chromium: { async launch() {
    return { async newContext() { throw Error('context failed') }, async close() { closed = true } }
  } } })
  try { await assert.rejects(runtime.run(['open', 'http://localhost']), /context failed/) }
  finally { await runtime.close() }
  assert.equal(closed, true)
})
