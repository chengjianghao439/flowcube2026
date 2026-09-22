#!/usr/bin/env node
const BASE_URL = process.env.PAGE_SMOKE_BASE_URL || 'http://127.0.0.1:8080'
const SMOKE_USERNAME = String(process.env.SMOKE_USERNAME || '').trim()
const SMOKE_PASSWORD = String(process.env.SMOKE_PASSWORD || '').trim()

function requireSmokeCredentials() {
  if (!SMOKE_USERNAME || !SMOKE_PASSWORD) {
    throw new Error('缺少 SMOKE_USERNAME / SMOKE_PASSWORD，请通过环境变量显式注入测试账号凭据')
  }
}

requireSmokeCredentials()

const { createRuntime } = require('./lib/browser-smoke-runtime')
const runtime = createRuntime()
const runPw = args => runtime.run(args)
const runPwOpen = runPw
const PAGE_TIMEOUT = Number(process.env.PAGE_SMOKE_TIMEOUT_MS || 20000)

function jsQuote(value) {
  return JSON.stringify(value)
}

async function assertNoErrorText() {
  const out = await runPw([
    'eval',
    `(() => {
      const text = document.body.innerText || '';
      return !text.includes('渲染错误') && !text.includes('未注册') && !text.includes('服务器内部错误') && !text.includes('Minified React error');
    })()`,
  ])
  if (out !== 'true') {
    throw new Error('页面检查失败：发现渲染错误或未注册提示')
  }
}

async function login() {
  console.log('==> 对账回跳：登录测试账号...')
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: SMOKE_USERNAME, password: SMOKE_PASSWORD }),
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
  await runPwOpen(['open', `${BASE_URL}/#/login`])
  await runPw(['eval', `(sessionStorage.setItem('flowcube-auth-v3', ${jsQuote(authStorage)}), true)`])
  await runtime.reload()
  await runtime.waitFor("location.hash.includes('/dashboard')", { timeout: PAGE_TIMEOUT })
}

async function openPath(path, label) {
  console.log(`==> 对账回跳：${label} -> ${path}`)
  await runPw(['eval', `(location.hash = ${jsQuote(`#${path}`)}, true)`])
  const target = `#${path}`.split('?')[0]
  await runtime.waitFor(`location.hash.split('?')[0] === ${jsQuote(target)}`, { timeout: PAGE_TIMEOUT })
  // 保留加载窗口，并在渲染后再次核对路由，不能把延迟跳到 403 的页面判为成功。
  await new Promise((resolve) => setTimeout(resolve, 3000))
  await runtime.waitFor(`location.hash.split('?')[0] === ${jsQuote(target)}`, { timeout: PAGE_TIMEOUT })
  await assertNoErrorText()
}

async function fetchJumpPaths() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: SMOKE_USERNAME, password: SMOKE_PASSWORD }),
  })
  if (!res.ok) throw new Error(`login failed: ${res.status}`)
  const auth = await res.json()
  const token = auth?.data?.token
  if (!token) throw new Error('login response missing token')

  async function fetchType(type) {
    const r = await fetch(`${BASE_URL}/api/reports/reconciliation?type=${type}&page=1&pageSize=20`, {
      signal: AbortSignal.timeout(20000),
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
  requireSmokeCredentials()
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

main().finally(() => runtime.close()).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
