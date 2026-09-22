'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { spawn } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '..')

// 真实 Chromium + 仅回环夹具；不使用开发/生产账号或数据库。
const titles = {
  '/dashboard': '仪表盘', '/reports/role-workbench': '待办中心', '/reports/reconciliation': '月结供应商对账',
  '/reports/profit-analysis': '利润与库存', '/procurement': '采购建议', '/reports/wave-performance': '批次效率',
  '/reports/warehouse-ops': '作业概况', '/reports/pda-anomaly': 'PDA 异常', '/reports/inventory-aging': '存放时长与滞销',
  '/warehouses': '仓库管理', '/picking-waves': '批次拣货', '/inbound-tasks/new': '新建收货订单',
  '/inbound-tasks/1': '收货订单', '/pda/inbound': '收货订单', '/pda/picking': '拣货任务',
  '/pda/split': '塑料盒拆分', '/pda/transfer': '调拨执行', '/403': '无访问权限',
}

async function runFixture(script, scenario = 'success') {
  const seen = []
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/auth/login') {
      let body = ''; for await (const chunk of req) body += chunk
      const { username } = JSON.parse(body)
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ data: { token: 'fixture-token', user: { username } } }))
    }
    if (req.url.startsWith('/api/reports/reconciliation')) {
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ data: { list: [{ sourcePath: '/purchase/1', receiptPath: '/inbound-tasks/1' }] } }))
    }
    if (req.url.startsWith('/seen?')) { seen.push(new URL(req.url, 'http://fixture').searchParams.get('path')); return res.end('ok') }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><body><script>
      const titles=${JSON.stringify(titles)}, scenario=${JSON.stringify(scenario)};
      const pda=location.hash.startsWith('#/pda');
      function render(){
        const auth=JSON.parse(sessionStorage.getItem('flowcube-auth-v3')||'null');
        let route=location.hash.slice(1).split('?')[0];
        if(!auth){ document.body.innerText='登录'; return }
        if(route==='/login'||route==='/pda/login'){location.hash=pda?'/pda':'/dashboard';return}
        if(route.startsWith('/pda')!==pda){location.hash=pda?'/pda':'/dashboard';return}
        if(scenario==='blocked-reconciliation'&&route==='/purchase/1'){location.hash='/403';return}
        if(route==='/picking-waves'&&auth.state.user.username==='fixture-limited'&&scenario!=='broken-permission'){location.hash='/403';return}
        document.body.innerText=(scenario==='broken-pda'&&route==='/pda/split')?'错误的 PDA 页面':(scenario==='render-error'&&route==='/purchase/1')?'渲染错误':titles[route]||'夹具页面';
        fetch('/seen?path='+encodeURIComponent(route));
      }
      window.addEventListener('hashchange',render);render();
    </script>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let child
  try {
    const started = Date.now()
    child = spawn(process.execPath, ['scripts/' + script], { cwd: root, env: {
      ...process.env, PAGE_SMOKE_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      SMOKE_USERNAME: 'fixture-main', SMOKE_PASSWORD: 'fixture-password',
      SMOKE_LIMITED_USERNAME: 'fixture-limited', SMOKE_LIMITED_PASSWORD: 'fixture-limited-password',
      ...(!process.env.BROWSER_SMOKE_BENCHMARK ? { PAGE_SMOKE_SETTLE_MS: '30', PAGE_SMOKE_INTERVAL_MS: '20', PAGE_SMOKE_TIMEOUT_MS: '700', PAGE_SMOKE_NAV_TIMEOUT_MS: '700' } : {}),
    }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
    const timer = setTimeout(() => child.kill('SIGTERM'), 90000)
    const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) }).finally(() => clearTimeout(timer))
    return { status, output, seen, elapsed: Date.now() - started }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await new Promise(resolve => server.close(resolve))
  }
}

test('真实浏览器完成 ERP、四个 PDA 页面、受限权限和授权对照', { timeout: 95000 }, async t => {
  const r = await runFixture('smoke-pages.node.js')
  assert.equal(r.status, 0, r.output)
  for (const route of Object.keys(titles)) assert.ok(r.seen.includes(route), `漏验收 ${route}`)
  t.diagnostic(`fixture elapsed ${r.elapsed} ms; distinct routes ${new Set(r.seen).size}`)
})
for (const scenario of ['broken-pda', 'broken-permission', 'render-error']) {
  test(`真实浏览器发现 ${scenario} 时必须失败并退出`, { timeout: 95000 }, async () => {
    const r = await runFixture('smoke-pages.node.js', scenario)
    assert.equal(r.status, 1, r.output)
    assert.match(r.output, /等待超时/)
    assert.doesNotMatch(r.output, /fixture-password|fixture-limited-password/)
  })
}
test('真实浏览器完成对账 source/receipt 跳转', { timeout: 95000 }, async t => {
  const r = await runFixture('smoke-reconciliation-jumps.node.js')
  assert.equal(r.status, 0, r.output)
  assert.ok(r.seen.includes('/purchase/1') && r.seen.includes('/inbound-tasks/1'))
  t.diagnostic(`fixture reconciliation elapsed ${r.elapsed} ms`)
})
test('对账目标被重定向到 403 时不得冒充回跳成功', { timeout: 95000 }, async () => {
  const r = await runFixture('smoke-reconciliation-jumps.node.js', 'blocked-reconciliation')
  assert.equal(r.status, 1, r.output)
})
