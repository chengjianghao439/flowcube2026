#!/usr/bin/env node
const { spawnSync } = require('child_process')

const ROOT = process.cwd()
const SESSION = process.env.PLAYWRIGHT_CLI_SESSION || `rj-${process.pid}-${Math.floor(Math.random() * 1e6)}`
const BASE_URL = process.env.PAGE_SMOKE_BASE_URL || 'http://127.0.0.1'

function cmdExists(cmd) {
  const res = spawnSync('sh', ['-lc', `command -v ${cmd} >/dev/null 2>&1`], {
    cwd: ROOT,
    stdio: 'ignore',
  })
  return res.status === 0
}

function pickRunner() {
  if (cmdExists('npm')) return ['npm', ['exec', '--yes', '--package', '@playwright/cli', '--', 'playwright-cli']]
  if (cmdExists('npx')) return ['npx', ['--yes', '--package', '@playwright/cli', 'playwright-cli']]
  throw new Error('缺少 npm / npx，无法运行对账回跳烟雾检查')
}

const [runnerBin, runnerArgs] = pickRunner()
const BROWSER_NAME = process.env.PLAYWRIGHT_BROWSER_NAME || 'chrome'

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

function ensureBrowser() {
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
  console.log('==> 对账回跳：登录测试账号...')
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  if (!res.ok) throw new Error(`login failed: ${res.status}`)
  const auth = await res.json()
  const token = auth?.data?.token
  const user = auth?.data?.user
  if (!token || !user) throw new Error('login response missing token/user')

  const authStorage = JSON.stringify({
    state: { token, user, isAuthenticated: true },
    version: 0,
  })
  runPw(['open', `${BASE_URL}/#/login`])
  runPw(['eval', `(sessionStorage.setItem('flowcube-auth-v3', ${jsQuote(authStorage)}), true)`])
  runPw(['eval', '(location.reload(), true)'])
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const ok = runPw(['eval', "location.hash.includes('/dashboard')"])
  if (!ok.includes('true')) {
    throw new Error('登录失败，未进入仪表盘')
  }
}

function openPath(path, label) {
  console.log(`==> 对账回跳：${label} -> ${path}`)
  runPw(['eval', `(location.hash = ${jsQuote(`#${path}`)}, true)`])
  return new Promise((resolve) => setTimeout(resolve, 3000)).then(() => {
    assertNoErrorText()
  })
}

async function fetchJumpPaths() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  if (!res.ok) throw new Error(`login failed: ${res.status}`)
  const auth = await res.json()
  const token = auth?.data?.token
  if (!token) throw new Error('login response missing token')

  async function fetchType(type) {
    const r = await fetch(`${BASE_URL}/api/reports/reconciliation?type=${type}&page=1&pageSize=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) throw new Error(`reconciliation ${type} failed: ${r.status}`)
    const json = await r.json()
    const rows = json?.data?.list ?? []
    const row = rows.find((item) => item.sourcePath || item.receiptPath)
    if (!row) throw new Error(`reconciliation ${type} has no jumpable row`)
    return {
      type,
      sourcePath: row.sourcePath || '',
      receiptPath: row.receiptPath || '',
    }
  }

  return [await fetchType(1), await fetchType(2)]
}

async function main() {
  ensureBrowser()
  await login()
  await openPath('/reports/reconciliation', '对账基础版')

  const jumps = await fetchJumpPaths()
  for (const jump of jumps) {
    console.log(`==> 对账回跳：type ${jump.type}`)
    if (jump.sourcePath) console.log(`source\t${jump.sourcePath}`)
    if (jump.receiptPath) console.log(`receipt\t${jump.receiptPath}`)
  }

  for (const jump of jumps) {
    if (jump.sourcePath) await openPath(jump.sourcePath, '对账回跳 source')
    if (jump.receiptPath) await openPath(jump.receiptPath, '对账回跳 receipt')
  }

  console.log()
  console.log('对账回跳烟雾检查通过')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
