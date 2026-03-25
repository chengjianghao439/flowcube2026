#!/usr/bin/env node
/**
 * FlowCube 桌面端打印客户端
 * 运行在连接打印机的电脑上，通过 SSE 监听打印任务并执行本地打印
 *
 * 使用方式：
 *   node print-client.js --server http://192.168.8.109:3000 --printer LABEL_01 \
 *     --username print_station --password ****
 *   或预先获取 Token：
 *   FLOWCUBE_TOKEN=eyJ... node print-client.js --server ... --printer LABEL_01
 *
 * 环境变量：FLOWCUBE_SERVER, PRINTER_CODE, FLOWCUBE_USERNAME, FLOWCUBE_PASSWORD, FLOWCUBE_TOKEN
 * Token 续期：定时调用 POST /api/auth/refresh；可用 FLOWCUBE_TOKEN_REFRESH_MS 设置兜底间隔（默认 12h）
 *
 * 打印方式：
 *   - HTML 内容：调用系统默认打印机通过 Chrome headless 打印
 *   - ZPL 内容：通过 TCP Socket 直接发送到斑马打印机
 *   - 纯文本：通过系统打印队列发送
 */

const http = require('http')
const https = require('https')
const { exec } = require('child_process')
const net = require('net')
const os = require('os')

// ── 命令行参数解析 ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function getArg(name) {
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : null
}

const SERVER_URL = getArg('--server') || process.env.FLOWCUBE_SERVER || 'http://localhost:3000'
const PRINTER_CODE = getArg('--printer') || process.env.PRINTER_CODE
const CLIENT_ID = `${os.hostname()}-${PRINTER_CODE}`
const ZPL_HOST = getArg('--zpl-host')
const ZPL_PORT = parseInt(getArg('--zpl-port') || '9100', 10)
const LOCAL_PRINTER = getArg('--local-printer')

const USERNAME = getArg('--username') || process.env.FLOWCUBE_USERNAME
const PASSWORD = getArg('--password') || process.env.FLOWCUBE_PASSWORD

let token = (getArg('--token') || process.env.FLOWCUBE_TOKEN || '').trim()

const TOKEN_REFRESH_FALLBACK_MS = Number(process.env.FLOWCUBE_TOKEN_REFRESH_MS) || 12 * 60 * 60 * 1000
let tokenRefreshTimer = null

if (!PRINTER_CODE) {
  console.error('[错误] 必须指定打印机编码：--printer LABEL_01')
  process.exit(1)
}

if (!token && (!USERNAME || !PASSWORD)) {
  console.error('[错误] 须提供 JWT：--token / FLOWCUBE_TOKEN，或账号密码 --username + --password')
  process.exit(1)
}

console.log(`[FlowCube 打印客户端]`)
console.log(`  服务器：${SERVER_URL}`)
console.log(`  打印机编码：${PRINTER_CODE}`)
console.log(`  本机：${os.hostname()}`)
console.log('')

// ── 鉴权 ─────────────────────────────────────────────────────────────────────
async function loginWithPassword() {
  const res = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.success || !json.data?.token) {
    throw new Error(json.message || `登录失败 HTTP ${res.status}`)
  }
  token = json.data.token
  console.log('[登录] Token 已获取')
}

function normalizeJsonTextInput(raw) {
  return String(raw).replace(/^\uFEFF/, '').trim()
}

function parseJwtPayload(jwtStr) {
  try {
    const part = jwtStr.split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const utf8 = Buffer.from(b64, 'base64').toString('utf8')
    if (process.env.FLOWCUBE_DEBUG_JWT === '1') {
      console.warn('[JWT payload] 解析前 length=', utf8.length, 'preview=', JSON.stringify(utf8.slice(0, 120)))
    }
    const normalized = normalizeJsonTextInput(utf8)
    return JSON.parse(normalized)
  } catch (e) {
    console.error('[JWT payload] JSON.parse 失败:', e instanceof Error ? e.message : e)
    try {
      const part = jwtStr.split('.')[1]
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
      const utf8 = Buffer.from(b64, 'base64').toString('utf8')
      console.error('[JWT payload] base64 解码后全文:', utf8)
    } catch {
      console.error('[JWT payload] 无法解码 payload 段')
    }
    return null
  }
}

function parseJwtExpMs(jwtStr) {
  const json = parseJwtPayload(jwtStr)
  return json && typeof json.exp === 'number' ? json.exp * 1000 : null
}

function logTenantFromToken() {
  const json = parseJwtPayload(token)
  if (json && Object.prototype.hasOwnProperty.call(json, 'tenantId')) {
    console.log(`[租户] JWT tenantId=${json.tenantId}`)
  } else if (json) {
    console.log('[租户] 当前 Token 无 tenantId，请重新登录或等待自动续期以切换多租户 JWT')
  }
}

async function refreshAccessToken() {
  if (!token) return
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: authHeaders(),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json.success && json.data?.token) {
      token = json.data.token
      console.log('[Token] 已续期')
      logTenantFromToken()
      return
    }
  } catch {
    /* 网络错误等，尝试密码登录 */
  }
  if (USERNAME && PASSWORD) {
    try {
      await loginWithPassword()
      logTenantFromToken()
    } catch (e) {
      console.warn('[Token] 续期失败且无法重新登录:', e.message)
    }
  }
}

function scheduleNextTokenRefresh() {
  if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer)
  if (!token) return
  const expMs = parseJwtExpMs(token)
  const skewMs = 5 * 60 * 1000
  let delay = TOKEN_REFRESH_FALLBACK_MS
  if (expMs) {
    delay = Math.min(TOKEN_REFRESH_FALLBACK_MS, Math.max(60_000, expMs - Date.now() - skewMs))
  }
  tokenRefreshTimer = setTimeout(() => {
    void (async () => {
      try {
        await refreshAccessToken()
      } catch {
        /* 忽略单次续期异常，由后续周期重试 */
      }
      if (token) scheduleNextTokenRefresh()
    })()
  }, delay)
}

async function ensureToken() {
  if (token) return
  await loginWithPassword()
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'X-Printer-Code': PRINTER_CODE,
    ...extra,
  }
}

// ── 指数退避（SSE 重连、回调重试共用）──────────────────────────────────────────
const MAX_BACKOFF_MS = 120_000
let sseReconnectAttempt = 0

function nextBackoffMs(attempt) {
  const base = Math.min(1000 * Math.pow(2, attempt), MAX_BACKOFF_MS)
  const jitter = base * 0.25 * Math.random()
  return Math.floor(base + jitter)
}

function resetSseBackoff() {
  sseReconnectAttempt = 0
}

function scheduleSseReconnect() {
  const ms = nextBackoffMs(sseReconnectAttempt)
  sseReconnectAttempt += 1
  console.log(`[重连] ${Math.round(ms / 1000)}s 后尝试（第 ${sseReconnectAttempt} 次）`)
  setTimeout(connect, ms)
}

/** 带鉴权与有限次指数退避的 JSON 请求（用于 complete / fail） */
async function postJsonWithRetry(url, body, { maxAttempts = 6 } = {}) {
  let attempt = 0
  while (attempt < maxAttempts) {
    try {
      await ensureToken()
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      })
      if (res.status === 401) {
        token = ''
        await loginWithPassword()
        scheduleNextTokenRefresh()
        attempt += 1
        continue
      }
      if (res.status >= 500 && attempt < maxAttempts - 1) {
        const wait = nextBackoffMs(attempt)
        console.warn(`[请求重试] 服务器 ${res.status}，${Math.round(wait / 1000)}s 后重试`)
        await new Promise((r) => setTimeout(r, wait))
        attempt += 1
        continue
      }
      return res
    } catch (e) {
      attempt += 1
      if (attempt >= maxAttempts) throw e
      const wait = nextBackoffMs(attempt - 1)
      console.warn(`[请求重试] ${e.message}，${Math.round(wait / 1000)}s 后重试 (${attempt}/${maxAttempts})`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  return null
}

// ── SSE 连接 ──────────────────────────────────────────────────────────────────
const SSE_PATH = `/api/print-jobs/listen/${encodeURIComponent(PRINTER_CODE)}`

function connect() {
  const sseUrl = `${SERVER_URL}${SSE_PATH}`
  console.log(`[连接] ${sseUrl}`)
  const url = new URL(sseUrl)
  const lib = url.protocol === 'https:' ? https : http

  const req = lib.request(
    sseUrl,
    {
      method: 'GET',
      headers: authHeaders({ Accept: 'text/event-stream' }),
    },
    (res) => {
      if (res.statusCode === 401) {
        res.resume()
        console.error('[错误] 401 未授权，尝试重新登录…')
        token = ''
        loginWithPassword()
          .then(() => {
            scheduleNextTokenRefresh()
            resetSseBackoff()
            connect()
          })
          .catch((e) => {
            console.error('[致命]', e.message)
            scheduleSseReconnect()
          })
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        console.error(`[错误] 服务器返回 ${res.statusCode}`)
        scheduleSseReconnect()
        return
      }
      resetSseBackoff()
      console.log('[已连接] 等待打印任务...')

      let buf = ''
      res.on('data', (chunk) => {
        buf += chunk.toString()
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        lines.forEach((line) => {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6).trim()
            if (!payload) return
            if (process.env.FLOWCUBE_DEBUG_SSE === '1') {
              console.warn('[SSE] 解析前 payloadPreview=', JSON.stringify(payload.slice(0, 200)))
            }
            try {
              const job = JSON.parse(payload)
              handleJob(job)
            } catch (e) {
              console.error('[SSE] JSON.parse 失败:', e instanceof Error ? e.message : e)
              console.error('[SSE] 整行=', JSON.stringify(line), 'payload=', JSON.stringify(payload))
            }
          }
        })
      })

      res.on('end', () => {
        console.log('[断开] SSE 结束，退避重连…')
        scheduleSseReconnect()
      })
    },
  )

  req.on('error', (e) => {
    console.error(`[网络错误] ${e.message}，退避重连…`)
    scheduleSseReconnect()
  })

  req.end()
}

// ── 任务处理 ──────────────────────────────────────────────────────────────────
async function handleJob(job) {
  const retryInfo = job.retryCount > 0 ? ` [重试 ${job.retryCount}/3]` : ''
  console.log(`[打印] #${job.id} ${job.title} (${job.contentType})${retryInfo}`)
  try {
    if (job.contentType === 'zpl') {
      await printZpl(job.content)
    } else if (job.contentType === 'html') {
      await printHtml(job.content, job.copies)
    } else {
      await printText(job.content, job.copies)
    }
    await reportComplete(job.id, job)
    console.log(`[完成] #${job.id}`)
  } catch (e) {
    console.error(`[失败] #${job.id}`, e.message)
    await reportFail(job.id, e.message)
  }
}

function printZpl(content) {
  return new Promise((resolve, reject) => {
    if (!ZPL_HOST) return reject(new Error('未配置 --zpl-host，无法发送 ZPL'))
    const sock = new net.Socket()
    sock.connect(ZPL_PORT, ZPL_HOST, () => {
      sock.write(content)
      sock.end()
    })
    sock.on('close', resolve)
    sock.on('error', reject)
  })
}

function printHtml(content, copies = 1) {
  return new Promise((resolve, reject) => {
    const platform = os.platform()
    const tmpFile = require('path').join(os.tmpdir(), `fc_print_${Date.now()}.html`)
    require('fs').writeFileSync(tmpFile, content, 'utf8')

    let cmd
    if (platform === 'win32') {
      const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      const printer = LOCAL_PRINTER ? `--printer-name="${LOCAL_PRINTER}"` : ''
      cmd = `"${chrome}" --headless --print-to-pdf-no-header --disable-gpu ${printer} "${tmpFile}"`
    } else {
      const printer = LOCAL_PRINTER ? `-d "${LOCAL_PRINTER}"` : ''
      cmd = `lp ${printer} -n ${copies} "${tmpFile}"`
    }

    exec(cmd, (err) => {
      require('fs').unlinkSync(tmpFile)
      if (err) reject(err)
      else resolve()
    })
  })
}

function printText(content, copies = 1) {
  return new Promise((resolve, reject) => {
    const printer = LOCAL_PRINTER ? `-d "${LOCAL_PRINTER}"` : ''
    const tmpFile = require('path').join(os.tmpdir(), `fc_print_${Date.now()}.txt`)
    require('fs').writeFileSync(tmpFile, content, 'utf8')
    exec(`lp ${printer} -n ${copies} "${tmpFile}"`, (err) => {
      require('fs').unlinkSync(tmpFile)
      if (err) reject(err)
      else resolve()
    })
  })
}

async function reportComplete(jobId, job) {
  const body = job?.ackToken ? { ackToken: job.ackToken } : {}
  try {
    const res = await postJsonWithRetry(`${SERVER_URL}/api/print-jobs/${jobId}/complete`, body)
    if (res && !res.ok) {
      const t = await res.text()
      console.warn(`[回调] complete 异常 ${res.status}`, t.slice(0, 200))
    }
  } catch (e) {
    console.warn('[回调] complete 失败', e.message)
  }
}

async function reportFail(jobId, errorMessage) {
  try {
    const res = await postJsonWithRetry(`${SERVER_URL}/api/print-jobs/${jobId}/fail`, {
      errorMessage: errorMessage || '未知错误',
    })
    if (res && !res.ok) {
      const t = await res.text()
      console.warn(`[回调] fail 异常 ${res.status}`, t.slice(0, 200))
    }
  } catch (e) {
    console.warn('[回调] fail 失败', e.message)
  }
}

async function heartbeat() {
  try {
    await ensureToken()
    const res = await fetch(`${SERVER_URL}/api/printers/heartbeat`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        clientId: CLIENT_ID,
        printerCode: PRINTER_CODE,
      }),
    })
    if (res.status === 401) {
      token = ''
      await loginWithPassword()
      scheduleNextTokenRefresh()
    }
  } catch {
    /* 心跳失败不阻塞主流程 */
  }
}

async function main() {
  await ensureToken()
  logTenantFromToken()
  scheduleNextTokenRefresh()

  const localPrinters = await getLocalPrinters()
  console.log(`[本机打印机] ${localPrinters.length} 台：${localPrinters.map((p) => p.name).join(', ') || '(无)'}`)

  await registerClient(localPrinters)

  await heartbeat()
  setInterval(heartbeat, 10_000)

  connect()
}

function getLocalPrinters() {
  return new Promise((resolve) => {
    const platform = os.platform()
    let cmd
    if (platform === 'win32') {
      cmd = 'wmic printer get Name /format:list'
    } else {
      cmd = 'lpstat -a 2>/dev/null || echo ""'
    }

    exec(cmd, (err, stdout) => {
      if (err) return resolve([])
      const printers = []
      if (platform === 'win32') {
        stdout.split('\n').forEach((line) => {
          const m = line.match(/^Name=(.+)/)
          if (m) printers.push({ name: m[1].trim(), code: m[1].trim().replace(/\s+/g, '_').toUpperCase() })
        })
      } else {
        stdout.split('\n').forEach((line) => {
          const m = line.match(/^(\S+)/)
          if (m && m[1]) printers.push({ name: m[1], code: m[1].replace(/[^A-Z0-9]/gi, '_').toUpperCase() })
        })
      }
      resolve(printers)
    })
  })
}

async function registerClient(localPrinters) {
  const payload = {
    clientId: CLIENT_ID,
    hostname: os.hostname(),
    printers: [{ code: PRINTER_CODE, name: LOCAL_PRINTER || PRINTER_CODE }, ...localPrinters],
  }
  try {
    await ensureToken()
    const res = await fetch(`${SERVER_URL}/api/printers/register-client`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    })
    const json = await res.json().catch(() => ({}))
    if (json.success) {
      console.log(`[注册成功] clientId=${CLIENT_ID}`)
    } else {
      console.warn(`[注册失败] ${json.message || res.status}`)
    }
  } catch (e) {
    console.warn(`[注册跳过] ${e.message}`)
  }
}

main().catch((e) => {
  console.error('[启动失败]', e)
  process.exit(1)
})
