'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const root = path.resolve(__dirname, '..')
// 使用实际 HashRouter 的别名跳转，避免夹具接受生产必定会重定向的旧地址。
const router = fs.readFileSync(path.join(root, 'frontend/src/router/index.tsx'), 'utf8')
const redirects = Object.fromEntries([...router.matchAll(/<Route path="([^"]+)" element=\{<Navigate to="([^"]+)"/g)].map(m => [m[1], m[2]]))
assert.equal(redirects['/reports/reconciliation'], '/reports/reconciliation/payable')
assert.equal(redirects['/payments'], '/payments/payable')

// PDA 页面标题**从真实页面读取**，避免夹具写死后与产品标题漂移：
// 2026-09-29 的发布尝试就是因为本夹具沿用旧名「塑料盒拆分」、而页面已改为「塑料盒作业」，
// 导致 fake 流程通过却在真实页面上 20s 超时。
// 动态读源后标题会**自动跟随源代码**；本夹具与 `scripts/smoke-pages.node.js` 因此**同源**，
// 二者共同的要求是：**真实页面必须呈现与该源一致的标题**（若服务端页面未随发布 SHA 更新，检查同样会失败）。
const pdaSplitTitle = (() => {
  const src = fs.readFileSync(path.join(root, 'frontend/src/pages/pda/split.tsx'), 'utf8')
  const m = /<PdaHeader\s+title="([^"]+)"/.exec(src) || /const LEGACY_PAGE_TITLE = '([^']+)'/.exec(src)
  assert.ok(m, '未能从 frontend/src/pages/pda/split.tsx 读到 PdaHeader.title')
  return m[1]
})()

// 独立从真实组合页注册读取渲染标题和当前视图，夹具不得继续呈现旧独立页标题。
const mergedSource = fs.readFileSync(path.join(root, 'frontend/src/router/mergedPageGroups.ts'), 'utf8')
const mergedViews = {}
for (const group of mergedSource.matchAll(/\{\s*key:\s*'[^']+',\s*title:\s*'([^']+)'[^[]*views:\s*\[([\s\S]*?)\]/g)) {
  for (const view of group[2].matchAll(/\{\s*path:\s*'([^']+)',\s*label:\s*'([^']+)'/g)) {
    mergedViews[view[1]] = { title: group[1], label: view[2] }
  }
}
assert.equal(Object.keys(mergedViews).length, 15, '组合页注册格式改变时须同步夹具读取器')
const descriptions = {}
for (const [file, routes] of [
  ['reports/ReconciliationView.tsx', ['/reports/reconciliation/payable', '/reports/reconciliation/receivable']],
  ['payments/PaymentsView.tsx', ['/payments/payable', '/payments/receivable']],
]) {
  const source = fs.readFileSync(path.join(root, 'frontend/src/pages', file), 'utf8')
  const values = [...source.matchAll(/description: '([^']+)'/g)].map(match => match[1])
  assert.equal(values.length, routes.length)
  routes.forEach((route, index) => { descriptions[route] = values[index] })
}

// 真实 Chromium + 仅回环夹具；不使用开发/生产账号或数据库。
const titles = {
  '/dashboard': '仪表盘', '/reports/role-workbench': '待办中心', '/reports/reconciliation/payable': '月结供应商对账',
  '/reports/reconciliation/receivable': '月结客户对账', '/payments/payable': '现结供应商账款', '/payments/receivable': '现结客户账款',
  '/reports/profit-analysis': '利润与库存', '/procurement': '采购建议', '/reports/wave-performance': '批次效率',
  '/reports/warehouse-ops': '作业概况', '/reports/pda-anomaly': 'PDA 异常', '/reports/inventory-aging': '存放时长与滞销',
  '/warehouses': '仓库管理', '/picking-waves': '批次拣货', '/inbound-tasks/new': '新建收货订单',
  '/inbound-tasks/1': '收货订单', '/pda/inbound': '收货订单', '/pda/picking': '拣货任务',
  '/pda/split': pdaSplitTitle, '/pda/transfer': '调拨执行', '/403': '无访问权限',
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
      const mergedViews=${JSON.stringify(mergedViews)}, descriptions=${JSON.stringify(descriptions)};
      const titles=${JSON.stringify(titles)}, scenario=${JSON.stringify(scenario)}, redirects=${JSON.stringify(redirects)};
      const pda=location.hash.startsWith('#/pda');
      function render(){
        const auth=JSON.parse(sessionStorage.getItem('flowcube-auth-v3')||'null');
        let route=location.hash.slice(1).split('?')[0];
        if(!auth){ document.body.innerText='登录'; return }
        if(route==='/login'||route==='/pda/login'){location.hash=pda?'/pda':'/dashboard';return}
        if(route.startsWith('/pda')!==pda){location.hash=pda?'/pda':'/dashboard';return}
        if(redirects[route]){location.hash=redirects[route];return}
        if(scenario==='blocked-reconciliation'&&route==='/purchase/1'){location.hash='/403';return}
        if(route==='/picking-waves'&&auth.state.user.username==='fixture-limited'&&scenario!=='broken-permission'){location.hash='/403';return}
        if(mergedViews[route]){
          const view=mergedViews[route];
          document.body.replaceChildren();
          const heading=document.createElement('h1');
          heading.textContent=scenario==='stale-merged-title'?titles[route]:view.title;
          const nav=document.createElement('nav');nav.setAttribute('aria-label',view.title+'视图');
          const link=document.createElement('a');link.href='#'+(scenario==='wrong-merged-href'?'/incorrect-view':route);link.textContent=view.label;
          link.setAttribute('aria-current',scenario==='wrong-merged-view'?'false':'page');
          nav.append(link);document.body.append(heading,nav);
          if(descriptions[route]){const description=document.createElement('p');description.textContent=scenario==='wrong-finance-component'?'错误的业务类型':descriptions[route];document.body.append(description)}
          // 即使导航包含旧期望词，也必须检查真正标题和当前视图。
          const oldTitle=document.createElement('p');oldTitle.textContent=titles[route];document.body.append(oldTitle);
        }else{
        document.body.innerText=(scenario==='broken-pda'&&route==='/pda/split')?'错误的 PDA 页面':(scenario==='render-error'&&route==='/purchase/1')?'渲染错误':titles[route]||'夹具页面';
        }
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
for (const scenario of ['broken-pda', 'broken-permission', 'render-error', 'stale-merged-title', 'wrong-merged-view', 'wrong-merged-href', 'wrong-finance-component']) {
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
