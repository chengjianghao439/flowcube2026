// 实际AppRouter、AppLayout、登录表单及供应商页；HTTP transport全部为显式合成数据。
const { execFileSync } = require('node:child_process')
const { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const frontend = path.resolve(__dirname, '../../frontend')
const requireFrontend = createRequire(path.join(frontend, 'package.json'))
const session = 'flowcube-login-supplier-balances'
const temporary = mkdtempSync(path.join(tmpdir(), session + '-'))
const output = path.resolve(process.env.LOGIN_SUPPLIER_OUTPUT_DIR || path.join(__dirname, '../../output/login-supplier-balances'))
const cli = (...args) => execFileSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 45000 })
const evaluate = expression => JSON.parse(cli('eval', expression, '--json')).data.result
const inspect = () => evaluate('window.__loginSupplierInspect()')
const results = []
function capture(name) {
  const state = inspect()
  assert.deepEqual(state.errors, [])
  assert.equal(state.routes.includes('#/403'), false)
  const screenshot = path.join(output, name + '.png')
  cli('screenshot', screenshot)
  results.push({ check: name, ...state, screenshot })
}
function login(code, expected) {
  cli('wait', '--text', '登录工作区')
  cli('fill', '#username', code); cli('fill', '#password', 'synthetic-browser-password')
  cli('find', 'role', 'button', 'click', '--name', '登录工作区', '--exact')
  cli('wait', '--fn', `location.hash === ${JSON.stringify('#' + expected)}`)
  cli('wait', '--fn', `document.querySelector('h1')?.textContent === ${JSON.stringify(expected === '/dashboard' ? '仪表盘' : '待办中心')}`)
}
async function main() {
  let started = false
  try {
    mkdirSync(output, { recursive: true })
    process.chdir(frontend)
    const config = (await import(pathToFileURL(path.join(frontend, 'postcss.config.js')))).default
    const plugins = Object.entries(config.plugins).map(([name, options]) => requireFrontend(name)(options))
    const css = await requireFrontend('postcss')(plugins).process(readFileSync(path.join(frontend, 'src/index.css'), 'utf8'), { from: path.join(frontend, 'src/index.css') })
    const result = await requireFrontend('esbuild').build({
      entryPoints: [path.join(__dirname, 'login-supplier-fixture.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic',
      outfile: path.join(temporary, 'fixture.js'), tsconfig: path.join(frontend, 'tsconfig.app.json'), nodePaths: [path.join(frontend, 'node_modules')],
      loader: { '.png': 'dataurl', '.svg': 'dataurl' },
      define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"DEV":true,"BASE_URL":"/"}', 'import.meta.hot': 'undefined', '__APP_VERSION__': '"synthetic-browser"', '__DEV_LOCAL_BACKEND__': 'true' },
    })
    const html = path.join(temporary, 'index.html')
    const pageCss = result.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n')
    writeFileSync(html, '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css.css + '\n' + pageCss + '</style><div id="root"></div><script>' + result.outputFiles.find(file => file.path.endsWith('.js')).text.replaceAll('</script', '<\\/script') + '</script></html>')
    const open = (mode, route) => {
      started = true
      cli('--allow-file-access', 'open', pathToFileURL(html).href + '?mode=' + mode + '#' + route)
      cli('set', 'viewport', '1440', '1000')
    }
    for (const code of ['admin', 'preset_finance_specialist', 'sales', 'warehouse', 'viewer', 'preset_warehouse_operator']) {
      open('login-' + code, '/reports/role-workbench')
      login(code, ['admin', 'preset_finance_specialist'].includes(code) ? '/reports/role-workbench' : '/dashboard')
      capture('login-' + code)
    }
    open('finance-default', '/login'); login('preset_finance_specialist', '/reports/role-workbench'); capture('finance-default-workbench')
    open('admin-switch', '/reports/role-workbench'); login('admin', '/reports/role-workbench')
    evaluate('window.__loginSupplierSwitchAccount()')
    login('sales', '/dashboard')
    assert.deepEqual(inspect().tabs, ['/dashboard']); capture('admin-to-sales-with-cached-tabs')
    open('supplier', '/payments/payable')
    cli('wait', '--text', 'PO-MONTHLY-NO-STATEMENT'); cli('wait', '--text', 'PO-CASH')
    const state = inspect()
    assert.equal(state.title, '供应商往来')
    assert.match(state.monthly, /月结未结清金额.*33\.13/)
    assert.match(state.monthly, /含未生成对账单/)
    assert.match(state.cash, /70\.00/); assert.doesNotMatch(state.cash, /33\.13/)
    assert.deepEqual(state.monthlyActions, [])
    assert.equal(state.calls.some(call => call.url.includes('/statements')), false)
    assert.equal(state.overflow, false)
    capture('supplier-default-separated-debts')
    cli('set', 'viewport', '900', '900')
    assert.equal(inspect().overflow, false); capture('supplier-narrow')
    evaluate('window.__loginSupplierFailMonthly().then(() => true)')
    cli('wait', '--text', '月结欠款加载失败')
    const failure = inspect()
    assert.doesNotMatch(failure.monthly, /33\.13/); assert.match(failure.cash, /70\.00/)
    capture('supplier-monthly-failure-keeps-cash')
    writeFileSync(path.join(output, 'results.json'), JSON.stringify({ status: 'passed', results }, null, 2))
    console.log(JSON.stringify({ status: 'passed', checks: results.length, output }, null, 2))
  } catch (error) {
    if (started) {
      writeFileSync(path.join(output, 'failure-snapshot.txt'), cli('snapshot'))
      writeFileSync(path.join(output, 'failure-errors.json'), cli('errors', '--json'))
      cli('screenshot', path.join(output, 'failure.png'))
      console.error(readFileSync(path.join(output, 'failure-errors.json'), 'utf8'))
      console.error(readFileSync(path.join(output, 'failure-snapshot.txt'), 'utf8').slice(0, 2500))
    }
    throw error
  } finally {
    if (started) cli('close')
    let sessions = ''
    for (let attempt = 0; attempt < 20; attempt++) {
      sessions = execFileSync('agent-browser', ['session', 'list', '--json'], { encoding: 'utf8' })
      if (!sessions.includes(session)) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.equal(sessions.includes(session), false, '本任务浏览器会话未确认退出')
    console.log('Owned browser session closed and absence verified: ' + session)
    rmSync(temporary, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
