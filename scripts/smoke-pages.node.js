#!/usr/bin/env node
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const ROOT = process.cwd()
const SESSION = process.env.PLAYWRIGHT_CLI_SESSION || `fps-${process.pid}-${Math.floor(Math.random() * 1e6)}`
const BASE_URL = process.env.PAGE_SMOKE_BASE_URL || 'http://127.0.0.1:8080'
const SMOKE_USERNAME = String(process.env.SMOKE_USERNAME || '').trim()
const SMOKE_PASSWORD = String(process.env.SMOKE_PASSWORD || '').trim()

function requireSmokeCredentials() {
  if (!SMOKE_USERNAME || !SMOKE_PASSWORD) {
    throw new Error('缺少 SMOKE_USERNAME / SMOKE_PASSWORD，请通过环境变量显式注入测试账号凭据')
  }
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

function cmdExists(cmd) {
  const res = spawnSync('sh', ['-lc', `command -v ${cmd} >/dev/null 2>&1`], {
    cwd: ROOT,
    stdio: 'ignore',
  })
  return res.status === 0
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
  const res = spawnSync(runnerBin, [...runnerArgs, '--session', SESSION, ...args], {
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

function runPwOpen(args) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 把「固定等待后一次性断言」换成「轮询等待直到条件成立或超时」：
// 大页面（懒加载 chunk + 多卡片 API）在慢环境下偶发超过 3 秒才渲染完，
// 旧的固定 setTimeout(3000) 会误报 flaky 失败。轮询语义与 Playwright 的
// auto-wait 一致：条件尽快成立就立即返回，真失败的页面才等到超时抛错。
async function waitFor(expr, { timeout = 20000, interval = 500, label = '页面' } = {}) {
  const deadline = Date.now() + timeout
  let out = ''
  while (Date.now() < deadline) {
    out = runPw(['eval', expr])
    if (out.includes('true')) return true
    await sleep(interval)
  }
  // 超时兜底：再取一次页面文本，把「当时到底长什么样」带进报错，便于定位
  const bodyText = runPw(['eval', '(document.body.innerText || "").slice(0, 500)'])
  throw new Error(`等待超时（${timeout / 1000}s）：${label} 未就绪。页面文本片段：${bodyText.replace(/\s+/g, ' ').trim().slice(0, 300) || '(空)'}`)
}

const ERROR_MARKERS = "'渲染错误','未注册','服务器内部错误','Minified React error'"
// 无期望文本页面的加载稳定窗口（毫秒）：给延迟渲染的错误一个浮现机会
const LOAD_SETTLE_MS = 2000

// 检查主体：期望文本出现且无错误标记。作为 waitFor 的表达式，返回布尔。
function assertExpr(expected, forbidden) {
  const expectedJs = jsQuote(expected)
  const forbiddenJs = forbidden ? jsQuote(forbidden) : ''
  // ERROR_MARKERS 是引号分隔的列表字面量，拼进数组字面量即 ['渲染错误','未注册',...]
  const errCheck = `![${ERROR_MARKERS}].some((m) => text.includes(m))`
  const forbCheck = forbiddenJs ? `&& !text.includes(${forbiddenJs})` : ''
  return `(() => { const text = document.body.innerText || ''; return text.includes(${expectedJs}) ${forbCheck} && ${errCheck}; })()`
}

function assertText(expected, forbidden = '') {
  // 用轮询等待替代单次断言；超时错误已含页面文本，能直接看出是渲染错误还是未加载完
  return waitFor(assertExpr(expected, forbidden), {
    label: forbidden ? `期望包含 ${expected} 且不应包含 ${forbidden}` : `期望包含 ${expected}`,
  })
}

function assertNoErrorText() {
  // 无期望文本的页面（/purchase/1、/sale/1）用「无错误标记」做断言。
  // 但不能上来就轮询「无错误」——DOM 还没渲染时条件立即成立、马上通过，
  // 会漏掉延迟渲染的错误。先等一段加载窗口，再进入轮询做最终断言。
  const expr = `(() => { const text = document.body.innerText || ''; return ![${ERROR_MARKERS}].some((m) => text.includes(m)); })()`
  return sleep(LOAD_SETTLE_MS).then(() => waitFor(expr, { label: '无渲染错误/未注册提示' }))
}

async function login() {
  console.log('==> 页面烟雾：登录测试账号...')
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: SMOKE_USERNAME, password: SMOKE_PASSWORD }),
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

  runPwOpen(['open', `${BASE_URL}/#/login`])
  runPw(['eval', `(sessionStorage.setItem('flowcube-auth-v3', ${jsQuote(authStorage)}), true)`])
  runPw(['eval', '(location.reload(), true)'])
  await waitFor(
    "location.hash.includes('/dashboard') && ((document.body.innerText || '').includes('仪表盘') || (document.body.innerText || '').includes('数据总览'))",
    { label: '登录后进入仪表盘' },
  )
}

function openAndCheck(path, expected = '', forbidden = '') {
  console.log(`==> 页面烟雾：${path}`)
  runPw(['eval', `(location.hash = ${jsQuote(`#${path}`)}, true)`])
  // 路由切换后轮询等待目标文本；无期望文本时退化为「无渲染错误」
  return expected ? assertText(expected, forbidden) : assertNoErrorText()
}

async function main() {
  requireSmokeCredentials()
  ensureBrowser()
  await login()
  await openAndCheck('/reports/role-workbench', '岗位工作台')
  await openAndCheck('/reports/reconciliation', '供应商对账')
  await openAndCheck('/reports/profit-analysis', '利润 / 库存分析')
  await openAndCheck('/procurement', '采购计划')
  await openAndCheck('/reports/wave-performance', '波次效率')
  await openAndCheck('/reports/warehouse-ops', '仓库运营看板')
  await openAndCheck('/reports/pda-anomaly', 'PDA 异常分析')
  await openAndCheck('/reports/inventory-aging', '库龄与呆滞')
  await openAndCheck('/warehouses', '仓库管理')
  await openAndCheck('/picking-waves?waveId=1&focus=print-closure', '波次拣货')
  await openAndCheck('/inbound-tasks/new', '新建收货订单')
  await openAndCheck('/inbound-tasks/1', '收货订单')
  await openAndCheck('/purchase/1')
  await openAndCheck('/sale/1')
  await openAndCheck('/customers')
  await openAndCheck('/suppliers')
  await openAndCheck('/payments')
  await openAndCheck('/carriers')
  await openAndCheck('/locations')
  await openAndCheck('/racks')
  await openAndCheck('/sorting-bins')
  await openAndCheck('/pda')
  await openAndCheck('/pda/inbound')
  await openAndCheck('/pda/receive/1')
  await openAndCheck('/pda/putaway/1')
  await openAndCheck('/pda/picking')
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
