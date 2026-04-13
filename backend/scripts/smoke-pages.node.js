#!/usr/bin/env node
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = process.cwd()
const SESSION = process.env.PLAYWRIGHT_CLI_SESSION || `fps-${process.pid}-${Math.floor(Math.random() * 1e6)}`
const BASE_URL = process.env.PAGE_SMOKE_BASE_URL || 'http://127.0.0.1'

function cmdExists(cmd) {
  const res = spawnSync('sh', ['-lc', `command -v ${cmd} >/dev/null 2>&1`], {
    cwd: ROOT,
    stdio: 'ignore',
  })
  return res.status === 0
}

function pickRunner() {
  if (cmdExists('npm')) {
    return ['npm', ['exec', '--yes', '--package', '@playwright/cli', '--', 'playwright-cli']]
  }
  if (cmdExists('npx')) {
    return ['npx', ['--yes', '--package', '@playwright/cli', 'playwright-cli']]
  }
  throw new Error('缺少 npm / npx，无法运行页面烟雾检查')
}

const [runnerBin, runnerArgs] = pickRunner()
const BROWSER_NAME = process.env.PLAYWRIGHT_BROWSER_NAME || 'chrome'
const SKIP_BROWSER_INSTALL = process.env.PLAYWRIGHT_SKIP_BROWSER_INSTALL === '1'
const CLI_CONFIG_ARGS = createCliConfigArgs()

function createCliConfigArgs() {
  const executablePath = resolveChromiumExecutablePath()
  if (!executablePath) {
    return []
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-playwright-'))
  const configPath = path.join(tempDir, 'cli.config.json')
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        browser: {
          browserName: 'chromium',
          launchOptions: {
            executablePath,
            chromiumSandbox: false,
          },
        },
      },
      null,
      2,
    ),
  )
  return ['--config', configPath]
}

function resolveChromiumExecutablePath() {
  if (process.env.PLAYWRIGHT_BROWSER_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_BROWSER_EXECUTABLE_PATH
  }
  const root = '/ms-playwright'
  if (!fs.existsSync(root)) {
    return ''
  }
  const candidates = fs
    .readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const candidate of candidates) {
    const executablePath = path.join(root, candidate, 'chrome-linux', 'chrome')
    if (fs.existsSync(executablePath)) {
      return executablePath
    }
  }
  return ''
}

function runPw(args) {
  const res = spawnSync(runnerBin, [...runnerArgs, ...CLI_CONFIG_ARGS, '--session', SESSION, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').trim()
    throw new Error(detail || `playwright-cli ${args[0]} failed`)
  }
  return (res.stdout || '').trim()
}

function ensureBrowser() {
  if (SKIP_BROWSER_INSTALL) {
    return
  }
  const res = spawnSync(runnerBin, [...runnerArgs, 'install-browser', BROWSER_NAME], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (res.status !== 0) {
    throw new Error(`安装浏览器 ${BROWSER_NAME} 失败`)
  }
}

function jsQuote(value) {
  return JSON.stringify(value)
}

function assertText(expected, forbidden = '') {
  const expectedJs = jsQuote(expected)
  const forbiddenJs = forbidden ? jsQuote(forbidden) : ''
  const expr = forbidden
    ? `(() => { const text = document.body.innerText || ''; return text.includes(${expectedJs}) && !text.includes(${forbiddenJs}) && !text.includes('渲染错误') && !text.includes('未注册') && !text.includes('服务器内部错误') && !text.includes('Minified React error'); })()`
    : `(() => { const text = document.body.innerText || ''; return text.includes(${expectedJs}) && !text.includes('渲染错误') && !text.includes('未注册') && !text.includes('服务器内部错误') && !text.includes('Minified React error'); })()`
  const out = runPw(['eval', expr])
  if (!out.includes('true')) {
    throw new Error(forbidden ? `页面检查失败：期望包含 ${expected}, 且不应包含 ${forbidden}` : `页面检查失败：期望包含 ${expected}`)
  }
}

function assertNoErrorText() {
  const out = runPw([
    'eval',
    `(() => {
      const text = document.body.innerText || '';
      return !text.includes('渲染错误') && !text.includes('未注册') && !text.includes('服务器内部错误') && !text.includes('Minified React error');
    })()`,
  ])
  if (!out.includes('true')) {
    throw new Error('页面检查失败：发现渲染错误或未注册提示')
  }
}

async function login() {
  console.log('==> 页面烟雾：登录测试账号...')
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  if (!res.ok) throw new Error(`登录失败：${res.status}`)
  const authJson = await res.json()
  const token = authJson?.data?.token
  const user = authJson?.data?.user
  if (!token || !user) throw new Error('登录响应缺少 token / user')

  const authStorage = JSON.stringify({
    state: { token, user, isAuthenticated: true },
    version: 0,
  })

  runPw(['open', `${BASE_URL}/#/login`])
  runPw(['eval', `(sessionStorage.setItem('flowcube-auth-v3', ${jsQuote(authStorage)}), true)`])
  runPw(['eval', '(location.reload(), true)'])
  await new Promise((resolve) => setTimeout(resolve, 3000))

  const ok = runPw([
    'eval',
    "location.hash.includes('/dashboard') && ((document.body.innerText || '').includes('仪表盘') || (document.body.innerText || '').includes('数据总览'))",
  ])
  if (!ok.includes('true')) {
    throw new Error('登录失败，未进入仪表盘')
  }
}

function openAndCheck(path, expected = '', forbidden = '') {
  console.log(`==> 页面烟雾：${path}`)
  runPw(['eval', `(location.hash = ${jsQuote(`#${path}`)}, true)`])
  return new Promise((resolve) => setTimeout(resolve, 3000)).then(() => {
    if (expected) assertText(expected, forbidden)
    else assertNoErrorText()
  })
}

async function main() {
  ensureBrowser()
  await login()
  await openAndCheck('/reports/role-workbench', '岗位工作台')
  await openAndCheck('/reports/reconciliation', '对账基础版')
  await openAndCheck('/reports/profit-analysis', '利润 / 库存分析')
  await openAndCheck('/reports/approvals', '审批与提醒')
  await openAndCheck('/reports/wave-performance', '波次效率报表')
  await openAndCheck('/reports/warehouse-ops', '仓库运营看板')
  await openAndCheck('/reports/pda-anomaly', 'PDA 异常分析')
  await openAndCheck('/reports/exception-workbench', '异常工作台')
  await openAndCheck('/warehouse-tasks', '仓库任务')
  await openAndCheck('/picking-waves?waveId=1&focus=print-closure', '出库打印闭环')
  await openAndCheck('/inbound-tasks/1', '收货订单')
  await openAndCheck('/purchase/1')
  await openAndCheck('/sale/1')
  await openAndCheck('/customers')
  await openAndCheck('/suppliers')
  await openAndCheck('/payments')
  await openAndCheck('/price-lists')
  await openAndCheck('/carriers')
  await openAndCheck('/locations')
  await openAndCheck('/racks')
  await openAndCheck('/sorting-bins')
  await openAndCheck('/pda')
  await openAndCheck('/pda/check')
  await openAndCheck('/pda/pack')
  await openAndCheck('/pda/split')
  await openAndCheck('/inventory')
  await openAndCheck('/stockcheck')
  await openAndCheck('/settings/barcode-print-query?category=inbound&inboundTaskId=1&status=failed')
  await openAndCheck('/settings/barcode-print-query?category=outbound&status=failed')
  await openAndCheck('/settings/barcode-print-query?category=logistics&status=failed')
  console.log()
  console.log('页面烟雾检查通过')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
