'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..')
function run(args, dsn) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['backend/scripts/check-error-tracking.js', ...args], {
      cwd: root, env: { ...process.env, SENTRY_DSN: dsn, NODE_ENV: 'test', HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '' },
    })
    let stdout = '', stderr = '', timedOut = false
    const deadline = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 7000)
    child.stdout.on('data', c => { stdout += c })
    child.stderr.on('data', c => { stderr += c })
    child.on('close', status => { clearTimeout(deadline); resolve({ status, stdout, stderr, timedOut }) })
  })
}
test('错误上报配置检查缺配置失败，默认不发送事件', async () => {
  const missing = await run([], '')
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /未配置/)
  const configured = await run([], 'https://fixture@example.invalid/1')
  assert.equal(configured.status, 0, configured.stderr)
  assert.doesNotMatch(configured.stdout, /example.invalid|fixture/)
})
for (const responseCode of [200, 403, 0]) {
  test(`真实Sentry HTTP传输对接收端${responseCode}作准确判定`, async () => {
    const requests = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => { requests.push({ path: req.url, body }); if (responseCode) { res.writeHead(responseCode); res.end('{}') } })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const r = await run(['--send-test'], `http://fixture@127.0.0.1:${server.address().port}/1`)
      assert.equal(r.timedOut, false, '接收端不响应时探针必须自行限时退出')
      assert.equal(r.status, responseCode === 200 ? 0 : 1, r.stdout + r.stderr)
      assert.equal(requests.length, 1)
      assert.match(requests[0].body, /Flowcube observability probe/)
      assert.doesNotMatch(requests[0].body, /client_report/, '探针不能再发送失败统计请求')
      assert.doesNotMatch(requests[0].body, /DB_PASSWORD|Authorization/)
      if (responseCode === 200) assert.match(r.stdout, /接收端已接受/)
      else assert.doesNotMatch(r.stdout, /接收端已接受/)
    } finally { await new Promise(resolve => server.close(resolve)) }
  })
}
