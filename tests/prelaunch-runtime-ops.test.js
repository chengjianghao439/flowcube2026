'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const { analyzeAudit } = require('../scripts/check-npm-audit')
const report = severity => JSON.stringify({ auditReportVersion: 2, vulnerabilities: { electron: { severity, isDirect: false, via: ['runtime'] } }, metadata: { vulnerabilities: { total: 1 } } })
test('审计阻断传递高危与运行时漏洞，保留响应完整性和进程失败保护', () => {
  assert.equal(analyzeAudit(report('high')).blocking, 1)
  assert.throws(() => analyzeAudit('not json'))
  assert.throws(() => analyzeAudit(JSON.stringify({ error: {} })))
  assert.throws(() => analyzeAudit(report('high').replace('"total":1', '"total":0')))
  const run = spawnSync(process.execPath, ['scripts/check-npm-audit.js', '/dev/null', '2'], { cwd: root }); assert.notEqual(run.status, 0)
  assert.doesNotMatch(fs.readFileSync(path.join(root, '.github/workflows/security-scan.yml'), 'utf8'), /audit --omit=dev/)
})
test('生产合并配置关闭 MySQL 宿主端口并保留 Caddy 的回环前端端口，透传实际配置', () => {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, MYSQL_ROOT_PASSWORD: 'fake-only', DB_NAME: 'fake', DB_USER: 'fake', DB_PASSWORD: 'fake-only', JWT_SECRET: 'fake-only-key-that-is-long-enough-123456', JWT_ACCESS_EXPIRES_IN: '17m', JWT_REFRESH_EXPIRES_IN: '9d', JWT_SECRET_PREVIOUS: 'fake-previous', DB_POOL_SIZE: '17', SENTRY_DSN: 'https://fake@example.invalid/1' }
  const run = spawnSync('docker', ['compose', '--env-file', '/dev/null', '-f', 'docker-compose.yml', '-f', 'docker-compose.prod.yml', 'config', '--format', 'json'], { cwd: root, env, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const c = JSON.parse(run.stdout)
  assert.deepEqual(c.services.mysql.ports || [], [])
  assert.deepEqual(c.services.frontend.ports.map(p => [p.host_ip, String(p.published), p.target]), [['127.0.0.1', '8080', 80]])
  for (const k of ['JWT_ACCESS_EXPIRES_IN', 'JWT_REFRESH_EXPIRES_IN', 'JWT_SECRET_PREVIOUS', 'DB_POOL_SIZE', 'SENTRY_DSN']) assert.equal(c.services.backend.environment[k], env[k])
  assert.equal(c.services.backend.environment.JWT_EXPIRES_IN, undefined)
})
test('桌面 IPC 仅接受注册窗口主 frame 的精确本地入口，阻断网页与其他本地文件', () => {
  const filename = path.join(root, 'desktop/lib/rendererSecurity.js')
  assert.equal(fs.existsSync(filename), true, '缺少渲染进程边界守卫')
  const { createRendererGuard } = require(filename)
  const guard = createRendererGuard(); const wc = { isDestroyed: () => false, mainFrame: { url: 'file:///app/index.html#/sale' } }
  guard.register(wc, 'file:///app/index.html#/')
  assert.equal(guard.isTrusted({ sender: wc, senderFrame: wc.mainFrame }), true)
  assert.equal(guard.isTrusted({ sender: wc, senderFrame: { url: wc.mainFrame.url } }), false)
  for (const url of ['https://example.invalid', 'file:///app/other.html', 'file:///app/index.html?x=1', 'file:///tmp/index.html']) { wc.mainFrame.url = url; assert.equal(guard.isTrusted({ sender: wc, senderFrame: wc.mainFrame }), false) }
})
test('Sentry 使用真实 SDK 在内存 transport 捕获未知错误，不上传请求或凭据', async () => {
  const filename = path.join(root, 'backend/src/utils/errorTracking.js')
  assert.equal(fs.existsSync(filename), true, '缺少 Sentry 初始化')
  const { initializeErrorTracking, captureUnexpectedError } = require(filename)
  const Sentry = require('../backend/node_modules/@sentry/node')
  const envelopes = []
  assert.equal(initializeErrorTracking({ dsn: '' }), false)
  initializeErrorTracking({ dsn: 'https://fake@example.invalid/1', transport: () => ({ send: async envelope => { envelopes.push(envelope); return { statusCode: 200 } }, flush: async () => true }) })
  captureUnexpectedError(new Error('synthetic prelaunch error'), { requestId: 'test-correlation', method: 'GET', route: '/test/:id' })
  await Sentry.flush(2000)
  assert.equal(envelopes.length, 1)
  const event = envelopes[0][1].find(item => item[0].type === 'event')[1]
  assert.equal(event.exception.values[0].value, 'synthetic prelaunch error')
  assert.equal(event.tags.route, '/test/:id'); assert.equal(event.extra.requestId, 'test-correlation')
  assert.equal(event.request, undefined); assert.equal(event.user, undefined)
  process.env.JWT_SECRET = 'test-only-configuration-key-at-least-32-characters'
  const errorHandler = require('../backend/src/middleware/errorHandler')
  let response
  const res = { status(code) { this.code = code; return this }, json(body) { response = body; return this } }
  errorHandler(new Error('synthetic middleware failure'), {
    method: 'POST', route: { path: '/synthetic/:id' }, originalUrl: '/synthetic/1?secret=do-not-upload',
    body: { password: 'do-not-upload' }, user: { userId: 1 }, requestId: 'middleware-correlation',
  }, res, () => {})
  await Sentry.flush(2000)
  assert.equal(res.code, 500); assert.equal(response.code, 'INTERNAL_ERROR')
  assert.equal(envelopes.length, 2)
  const middlewareEvent = envelopes[1][1].find(item => item[0].type === 'event')[1]
  assert.equal(middlewareEvent.tags.route, '/synthetic/:id')
  assert.doesNotMatch(JSON.stringify(middlewareEvent), /do-not-upload/)
  await Sentry.close(2000)
})
