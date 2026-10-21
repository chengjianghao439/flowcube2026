// Real Chromium, compiled product CSS and actual React pages/routes; synthetic API/device boundaries.
const { execFileSync } = require('node:child_process')
const { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const frontend = path.join(__dirname, '../../frontend')
const requireFrontend = createRequire(path.join(frontend, 'package.json'))
const { build } = requireFrontend('esbuild')
const postcss = requireFrontend('postcss')
const session = 'flowcube-qa98-followup'
const temporary = mkdtempSync(path.join(tmpdir(), 'flowcube-qa-followup-'))
const output = path.resolve(process.env.QA_FOLLOWUP_OUTPUT_DIR || path.join(__dirname, '../../output/qa98-followup'))
const cli = (...args) => execFileSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 45000 })
const evaluate = expression => JSON.parse(cli('eval', expression, '--json')).data.result
const inspect = () => evaluate('window.__qaInspect()')
const results = []
function screenshot(name) { const file = path.join(output, name + '.png'); cli('screenshot', file); return file }
function retained(code) {
  cli('wait', '--fn', 'window.__qaInspect().input?.focused === true && !window.__qaInspect().input?.readOnly')
  const state = inspect()
  assert.deepEqual(state.input, { value: code, readOnly: false, focused: true, start: 0, end: code.length })
  assert.equal(state.topFeedback, true); assert.equal(state.toasts, 0); assert.deepEqual(state.errors, [])
  return state
}
async function retainedPastFiveSeconds(code) {
  const initial = retained(code), startedAt = Date.now()
  await new Promise(resolve => setTimeout(resolve, 5200))
  const current = retained(code)
  assert.deepEqual(current.alerts, initial.alerts)
  assert.equal(current.feedback.length, initial.feedback.length)
  return { ...current, errorRetentionMs: Date.now() - startedAt }
}
async function main() {
  let started = false
  try {
    mkdirSync(output, { recursive: true })
    process.chdir(frontend)
    const config = (await import(pathToFileURL(path.join(frontend, 'postcss.config.js')))).default
    const plugins = Object.entries(config.plugins).map(([name, options]) => requireFrontend(name)(options))
    const css = await postcss(plugins).process(readFileSync(path.join(frontend, 'src/index.css'), 'utf8'), { from: path.join(frontend, 'src/index.css') })
    const result = await build({
      entryPoints: [path.join(__dirname, 'qa-followup-fixture.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic',
      outfile: path.join(temporary, 'fixture.js'),
      tsconfig: path.join(frontend, 'tsconfig.app.json'), nodePaths: [path.join(frontend, 'node_modules')],
      define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{}', 'import.meta.hot': 'undefined', '__APP_VERSION__': '"qa-local"', '__DEV_LOCAL_BACKEND__': 'true' },
    })
    const html = path.join(temporary, 'index.html')
    writeFileSync(html, '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css.css + '</style><div id="root"></div><script>' + result.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></html>')
    const url = pathToFileURL(html).href
    const open = (mode, route) => {
      started = true; cli('--allow-file-access', 'open', url + '?mode=' + mode + '#' + route)
      cli('set', 'viewport', ...(mode.startsWith('template-') ? ['1440', '1000'] : ['390', '844']))
      cli('wait', '--fn', 'Boolean(window.__qaReady)')
      assert.deepEqual(inspect().viewport, mode.startsWith('template-') ? { width: 1440, height: 1000 } : { width: 390, height: 844 })
    }
    open('pick', '/pda/task/7')
    cli('wait', '--text', 'WT-QA-007'); cli('find', 'role', 'button', 'click', '--name', '手动输入', '--exact')
    cli('fill', '[data-scanner-manual]', 'UITEST123')
    // Separate browser/event-loop turns: the first format rejection has fully settled before Enter again.
    cli('press', 'Enter'); retained('UITEST123'); cli('press', 'Enter')
    let state = retained('UITEST123')
    // Browser button clicks move focus before onClick; a suppressed repeat must restore input focus/select.
    cli('find', 'role', 'button', 'click', '--name', '确认', '--exact')
    state = retained('UITEST123')
    writeFileSync(path.join(output, 'pick-rapid-enter-observed.json'), JSON.stringify(state, null, 2))
    screenshot('pick-rapid-enter-observed')
    assert.equal(state.calls.filter(call => call.url === '/scan-logs/error').length, 1)
    assert.equal(state.feedback.length, 1)
    assert.deepEqual(state.alerts, ['未找到可用的库存条码，请核对条码后重试'])
    assert.equal(state.calls.filter(call => call.url === '/scan-logs').length, 0)
    state = await retainedPastFiveSeconds('UITEST123')
    results.push({ check: '拣货UITEST123拒绝/双回车及重复确认静默一次/原码焦点全选', ...state, screenshot: screenshot('pick-invalid') })
    // A deliberate retry after the window is a fresh attempt; correcting the code works immediately.
    cli('press', 'Enter'); state = retained('UITEST123')
    assert.equal(state.calls.filter(call => call.url === '/scan-logs/error').length, 2)
    cli('fill', '[data-scanner-manual]', 'I123456'); cli('press', 'Enter'); cli('press', 'Enter')
    state = inspect(); assert.equal(state.input.readOnly, true)
    assert.equal(state.calls.filter(call => call.url?.startsWith('/inventory/containers/barcode/')).length, 1)
    evaluate('window.__qaReleaseLookup()'); state = retained('I123456')
    results.push({ check: '拣货异步不存在/双回车一次查询', ...state, screenshot: screenshot('pick-not-found') })
    open('sort', '/pda/sort')
    cli('wait', '--text', '分拣作业'); cli('find', 'role', 'button', 'click', '--name', '手动输入', '--exact')
    cli('fill', '[data-scanner-manual]', 'UITEST123'); cli('press', 'Enter'); cli('press', 'Enter')
    state = inspect(); assert.equal(state.input.readOnly, true)
    assert.equal(state.calls.filter(call => call.url === '/sorting-bins/scan').length, 1)
    evaluate('window.__qaReleaseLookup()'); state = retained('UITEST123')
    assert.deepEqual(state.alerts, ['未找到可分拣的商品或取货码，请核对条码后重试'])
    state = await retainedPastFiveSeconds('UITEST123')
    results.push({ check: '分拣UITEST123统一未找到/原码/焦点/全选/双回车一次', ...state, screenshot: screenshot('sort-not-found') })
    open('inventory', '/pda/inventory-query')
    cli('wait', '--text', '库存查询'); cli('find', 'role', 'button', 'click', '--name', '手动输入', '--exact')
    cli('fill', '[data-scanner-manual]', 'UITEST123'); cli('press', 'Enter'); cli('press', 'Enter')
    state = retained('UITEST123')
    assert.equal(state.calls.filter(call => call.url === '/inventory/query-by-barcode').length, 1)
    assert.deepEqual(state.alerts, ['未找到可用的库存条码，请核对条码后重试'])
    state = await retainedPastFiveSeconds('UITEST123')
    results.push({ check: '库存查询错误超过5.1秒保留/双回车静默一次', ...state, screenshot: screenshot('inventory-not-found') })
    cli('fill', '[data-scanner-manual]', 'I000011'); cli('press', 'Enter')
    cli('wait', '--text', '找到 1 个库存条码')
    state = inspect(); assert.deepEqual(state.alerts, []); assert.equal(state.input, null)
    assert.equal(state.calls.filter(call => call.url === '/inventory/query-by-barcode').length, 2)
    results.push({ check: '库存查询下一条成功反馈替换原错误', ...state, screenshot: screenshot('inventory-next-feedback') })
    open('template-denied', '/settings/print-templates/new')
    cli('wait', '--fn', 'location.hash === "#/403"'); cli('wait', '--text', '你没有访问这个页面的权限')
    state = inspect(); assert.notEqual(state.title, '新建打印模板'); assert.equal(state.save, false); assert.deepEqual(state.errors, [])
    results.push({ check: '模板新建查看权限真实路由拒绝', ...state, screenshot: screenshot('template-denied') })
    open('template-allowed', '/settings/print-templates/new')
    cli('wait', '--text', '新建打印模板'); cli('wait', '--fn', 'window.__qaInspect().save')
    state = inspect(); assert.equal(state.route, '#/settings/print-templates/new'); assert.equal(state.title, '新建打印模板'); assert.equal(state.save, true); assert.deepEqual(state.errors, [])
    results.push({ check: '模板新建管理权限真实编辑器允许', ...state, screenshot: screenshot('template-allowed') })
    writeFileSync(path.join(output, 'results.json'), JSON.stringify({ status: 'passed', session, results }, null, 2))
    console.log(JSON.stringify({ status: 'passed', checks: results.map(result => result.check), output }, null, 2))
  } finally {
    if (started) cli('close')
    let sessions = ''
    for (let attempt = 0; attempt < 20; attempt++) {
      sessions = execFileSync('agent-browser', ['session', 'list', '--json'], { encoding: 'utf8' })
      if (!sessions.includes(session)) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.equal(sessions.includes(session), false, '本任务会话关闭未确认')
    console.log('Owned browser session closed and absence verified: ' + session)
    rmSync(temporary, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
