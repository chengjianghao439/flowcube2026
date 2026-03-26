#!/usr/bin/env node
/**
 * FlowCube 桌面端打印客户端
 * 运行在连接打印机的电脑上，通过 SSE 监听打印任务并执行本地打印
 *
 * 使用方式（推荐：按工作站订阅，无需在 URL 里写打印机编码）：
 *   node print-client.js --server http://192.168.8.109:3000 \
 *     --username print_station --password **** --bind-code LABEL_01 --zpl-host 192.168.8.50
 *   工作站 ID 默认本机 hostname，可改：--client-id 或 FLOWCUBE_CLIENT_ID
 *
 * 兼容旧版（按打印机编码订阅 SSE）：
 *   node print-client.js --server ... --printer LABEL_01 ...
 *
 * 环境变量：FLOWCUBE_SERVER, FLOWCUBE_CLIENT_ID, FLOWCUBE_BIND_CODE, PRINTER_CODE（旧）,
 *           FLOWCUBE_PRINT_ROUTES / FLOWCUBE_PRINT_ROUTES_FILE, FLOWCUBE_ZPL_HOST,
 *           FLOWCUBE_USERNAME, FLOWCUBE_PASSWORD, FLOWCUBE_TOKEN
 * Token 续期：定时调用 POST /api/auth/refresh；可用 FLOWCUBE_TOKEN_REFRESH_MS 设置兜底间隔（默认 12h）
 *
 * 一机多打（按后台打印机 code 路由到不同物理机）：
 *   --routes-file ./print-routes.json
 *   或环境变量 FLOWCUBE_PRINT_ROUTES='{"LABEL_01":{"host":"10.0.0.1"},"LABEL_02":"10.0.0.2"}'
 *   条目可为字符串（仅 ZPL IP）或对象：host/zplHost、port、lp（CUPS 队列名）、winPrinter（Windows）
 *   未写明的 code 在 ZPL 任务上会回退到 --zpl-host（单机默认可只配默认 host）
 *
 * 打印方式：
 *   - ZPL：优先按路由表 TCP 发送到斑马网口（默认端口 9100）；若无 zplHost 但配置了 lp 或 --local-printer（仅 macOS/Linux），则用 lp -o raw 走 CUPS 队列
 *   - HTML：mac/linux 用 lp；Windows 用 Chrome（可配 winPrinter）
 *   - 纯文本：lp（可配 lp）
 */

const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const { exec, execFile } = require('child_process')
const net = require('net')
const os = require('os')

// ── 命令行参数解析 ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function getArg(name) {
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : null
}

const SERVER_URL = getArg('--server') || process.env.FLOWCUBE_SERVER || 'http://localhost:3000'
const STATION_CLIENT_ID = String(
  getArg('--client-id') || process.env.FLOWCUBE_CLIENT_ID || os.hostname(),
)
  .trim()
  .slice(0, 200)
const PRINTER_CODE_LEGACY = getArg('--printer') || process.env.PRINTER_CODE || null
const LEGACY_SSE = Boolean(PRINTER_CODE_LEGACY)
const BIND_CODES_ARG = getArg('--bind-code') || process.env.FLOWCUBE_BIND_CODE || ''

const ZPL_HOST = getArg('--zpl-host') || process.env.FLOWCUBE_ZPL_HOST || null
const ZPL_PORT = parseInt(getArg('--zpl-port') || process.env.FLOWCUBE_ZPL_PORT || '9100', 10)
const LOCAL_PRINTER = getArg('--local-printer')
const ROUTES_FILE = getArg('--routes-file') || process.env.FLOWCUBE_PRINT_ROUTES_FILE || null

const USERNAME = getArg('--username') || process.env.FLOWCUBE_USERNAME
const PASSWORD = getArg('--password') || process.env.FLOWCUBE_PASSWORD

let token = (getArg('--token') || process.env.FLOWCUBE_TOKEN || '').trim()

const TOKEN_REFRESH_FALLBACK_MS = Number(process.env.FLOWCUBE_TOKEN_REFRESH_MS) || 12 * 60 * 60 * 1000
let tokenRefreshTimer = null

/** 注册/心跳用的「主」打印机编码（须与请求头 X-Printer-Code 一致） */
let primaryBindCode = ''

/** code(大写) → 路由配置，由 initPrintRoutes() 填充 */
let printRoutesMap = {}

const SAFE_STATION_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/

if (!SAFE_STATION_ID.test(STATION_CLIENT_ID)) {
  console.error('[错误] 工作站 ID 格式无效（字母数字开头，可含 ._-）：--client-id / FLOWCUBE_CLIENT_ID')
  process.exit(1)
}

if (!token && (!USERNAME || !PASSWORD)) {
  console.error('[错误] 须提供 JWT：--token / FLOWCUBE_TOKEN，或账号密码 --username + --password')
  process.exit(1)
}

console.log(`[FlowCube 打印客户端]`)
console.log(`  服务器：${SERVER_URL}`)
console.log(`  工作站 ID：${STATION_CLIENT_ID}（写入 printers.client_id，与 SSE 头 X-Client-Id 一致）`)
console.log(
  `  订阅：${
    LEGACY_SSE
      ? `旧版 /listen/${PRINTER_CODE_LEGACY}`
      : '新版 /listen/station（本机所有绑定到该工作站的打印机任务都会收到）'
  }`,
)
console.log(`  本机 hostname：${os.hostname()}`)
console.log('')

// ── 物理打印机路由（一机多打）──────────────────────────────────────────────────

function normalizeRouteKeys(obj) {
  const o = {}
  for (const [k, v] of Object.entries(obj || {})) {
    const key = String(k).trim().toUpperCase()
    if (key) o[key] = v
  }
  return o
}

function normalizeRouteEntry(raw) {
  if (raw == null) return { zplHost: null, zplPort: ZPL_PORT, lp: null, winPrinter: null }
  if (typeof raw === 'string') {
    const h = raw.trim()
    return { zplHost: h || null, zplPort: ZPL_PORT, lp: null, winPrinter: null }
  }
  if (typeof raw !== 'object') return { zplHost: null, zplPort: ZPL_PORT, lp: null, winPrinter: null }
  const zh = raw.host || raw.zplHost
  const port = raw.port != null ? Number(raw.port) : ZPL_PORT
  return {
    zplHost: zh ? String(zh).trim() : null,
    zplPort: Number.isFinite(port) && port > 0 ? port : ZPL_PORT,
    lp: raw.lp ? String(raw.lp).trim() : null,
    winPrinter: raw.winPrinter ? String(raw.winPrinter).trim() : null,
  }
}

function initPrintRoutes() {
  printRoutesMap = {}
  try {
    if (ROUTES_FILE) {
      const abs = path.isAbsolute(ROUTES_FILE) ? ROUTES_FILE : path.resolve(process.cwd(), ROUTES_FILE)
      const txt = fs.readFileSync(abs, 'utf8')
      printRoutesMap = normalizeRouteKeys(JSON.parse(txt))
    } else if (process.env.FLOWCUBE_PRINT_ROUTES && String(process.env.FLOWCUBE_PRINT_ROUTES).trim()) {
      printRoutesMap = normalizeRouteKeys(JSON.parse(process.env.FLOWCUBE_PRINT_ROUTES))
    }
  } catch (e) {
    console.error('[错误] 打印路由 JSON 无效:', e instanceof Error ? e.message : e)
    process.exit(1)
  }
  const n = Object.keys(printRoutesMap).length
  if (n) console.log(`[路由] 已从配置加载 ${n} 条打印机物理地址映射`)
}

/** 合并路由表项与全局默认 --zpl-host */
function resolvePhysicalRoute(printerCode) {
  const code = String(printerCode || '').trim().toUpperCase()
  const raw = code ? printRoutesMap[code] : undefined
  const spec = normalizeRouteEntry(raw)
  if (!spec.zplHost && ZPL_HOST) {
    spec.zplHost = String(ZPL_HOST).trim()
    spec.zplPort = ZPL_PORT
  }
  return spec
}

/** 按 printerCode 串行执行，避免同一斑马并发乱序；不同打印机并行 */
const printJobQueues = new Map()
function schedulePrintJob(job) {
  const key = String(job.printerCode || `pid_${job.printerId || 0}`)
  const prev = printJobQueues.get(key) || Promise.resolve()
  const next = prev
    .then(() => handleJob(job))
    .catch((e) => console.error(`[打印队列 ${key}]`, e instanceof Error ? e.message : e))
  printJobQueues.set(key, next)
}

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
      headers: bearerHeaders(),
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

function stationIdHeader() {
  return LEGACY_SSE ? {} : { 'X-Client-Id': STATION_CLIENT_ID }
}

function bearerHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  }
}

/** 注册、心跳：须带 X-Printer-Code（主绑定编码）+ 新版下 X-Client-Id */
function registerApiHeaders(extra = {}) {
  return bearerHeaders({
    ...stationIdHeader(),
    ...extra,
  })
}

/** complete / fail：旧版仅 X-Printer-Code；新版 X-Client-Id */
function callbackHeaders() {
  if (LEGACY_SSE && PRINTER_CODE_LEGACY) {
    return bearerHeaders({
      'Content-Type': 'application/json',
      'X-Printer-Code': PRINTER_CODE_LEGACY,
    })
  }
  return registerApiHeaders({ 'Content-Type': 'application/json' })
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
        headers: callbackHeaders(),
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
const SSE_PATH =
  LEGACY_SSE && PRINTER_CODE_LEGACY
    ? `/api/print-jobs/listen/${encodeURIComponent(PRINTER_CODE_LEGACY)}`
    : '/api/print-jobs/listen/station'

function connect() {
  const sseUrl = `${SERVER_URL}${SSE_PATH}`
  console.log(`[连接] ${sseUrl}`)
  const url = new URL(sseUrl)
  const lib = url.protocol === 'https:' ? https : http

  const req = lib.request(
    sseUrl,
    {
      method: 'GET',
      headers: registerApiHeaders({ Accept: 'text/event-stream' }),
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
              schedulePrintJob(job)
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
  const pc = job.printerCode ? ` →${job.printerCode}` : ''
  console.log(`[打印] #${job.id} ${job.title} (${job.contentType})${pc}${retryInfo}`)
  try {
    if (job.contentType === 'zpl') {
      await printZpl(job.content, job)
    } else if (job.contentType === 'html') {
      await printHtml(job.content, job.copies, job)
    } else {
      await printText(job.content, job.copies, job)
    }
    await reportComplete(job.id, job)
    console.log(`[完成] #${job.id}`)
  } catch (e) {
    console.error(`[失败] #${job.id}`, e.message)
    await reportFail(job.id, e.message)
  }
}

function printZplTcp(host, port, content) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket()
    let settled = false
    const done = (fn, arg) => {
      if (settled) return
      settled = true
      fn(arg)
    }
    sock.setTimeout(30_000, () => {
      sock.destroy()
      done(reject, new Error(`ZPL 连接超时 ${host}:${port}`))
    })
    sock.connect(port, host, () => {
      sock.write(content, (writeErr) => {
        if (writeErr) {
          sock.destroy()
          return done(reject, writeErr)
        }
        sock.end()
      })
    })
    sock.on('close', () => done(resolve))
    sock.on('error', (e) => done(reject, e))
  })
}

/** CUPS 原始作业：适用于仅添加为系统打印队列、无网口 IP 的斑马等 */
function printZplViaLp(queue, content) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `fc_zpl_${Date.now()}.zpl`)
    fs.writeFileSync(tmpFile, content, 'utf8')
    execFile('lp', ['-d', queue, '-o', 'raw', tmpFile], (err) => {
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        /* 忽略 */
      }
      if (err) reject(err)
      else resolve()
    })
  })
}

function printZpl(content, job) {
  const route = resolvePhysicalRoute(job?.printerCode)
  const host = route.zplHost
  const port = route.zplPort
  const lpQueue = (route.lp || LOCAL_PRINTER || '').trim()

  if (host) {
    return printZplTcp(host, port, content)
  }

  const platform = os.platform()
  if (lpQueue && platform !== 'win32') {
    return printZplViaLp(lpQueue, content)
  }

  return Promise.reject(
    new Error(
      `ZPL 未配置目标：打印机 ${job?.printerCode || '?'} 请配置斑马网口：路由/host 或 --zpl-host；` +
        `或（macOS/Linux）在路由表配置 lp / 使用 --local-printer 指定 CUPS 队列名以 -o raw 发送`,
    ),
  )
}

function printHtml(content, copies = 1, job = {}) {
  return new Promise((resolve, reject) => {
    const platform = os.platform()
    const route = resolvePhysicalRoute(job?.printerCode)
    const tmpFile = path.join(os.tmpdir(), `fc_print_${Date.now()}.html`)
    fs.writeFileSync(tmpFile, content, 'utf8')

    let cmd
    if (platform === 'win32') {
      const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      const winName = route.winPrinter || LOCAL_PRINTER
      const printer = winName ? `--printer-name="${winName}"` : ''
      cmd = `"${chrome}" --headless --print-to-pdf-no-header --disable-gpu ${printer} "${tmpFile}"`
    } else {
      const dev = route.lp || LOCAL_PRINTER
      const printer = dev ? `-d "${dev}"` : ''
      cmd = `lp ${printer} -n ${copies} "${tmpFile}"`
    }

    exec(cmd, (err) => {
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        /* 忽略 */
      }
      if (err) reject(err)
      else resolve()
    })
  })
}

function printText(content, copies = 1, job = {}) {
  return new Promise((resolve, reject) => {
    const route = resolvePhysicalRoute(job?.printerCode)
    const dev = route.lp || LOCAL_PRINTER
    const printer = dev ? `-d "${dev}"` : ''
    const tmpFile = path.join(os.tmpdir(), `fc_print_${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, content, 'utf8')
    exec(`lp ${printer} -n ${copies} "${tmpFile}"`, (err) => {
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        /* 忽略 */
      }
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
      headers: registerApiHeaders({
        'Content-Type': 'application/json',
        'X-Printer-Code': primaryBindCode,
      }),
      body: JSON.stringify({
        clientId: STATION_CLIENT_ID,
        printerCode: primaryBindCode,
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

function buildRegisterPrintersList(localPrinters) {
  const list = []
  const seen = new Set()
  function add(p) {
    if (!p?.code) return
    const code = String(p.code).trim()
    if (!code || seen.has(code)) return
    seen.add(code)
    list.push({ code, name: String(p.name || code).trim() || code })
  }
  if (PRINTER_CODE_LEGACY) {
    add({ code: PRINTER_CODE_LEGACY, name: LOCAL_PRINTER || PRINTER_CODE_LEGACY })
  }
  if (BIND_CODES_ARG) {
    for (const c of BIND_CODES_ARG.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
      add({ code: c, name: c })
    }
  }
  for (const lp of localPrinters || []) add(lp)
  return list
}

async function main() {
  initPrintRoutes()

  await ensureToken()
  logTenantFromToken()
  scheduleNextTokenRefresh()

  const localPrinters = await getLocalPrinters()
  console.log(`[本机打印机] ${localPrinters.length} 台：${localPrinters.map((p) => p.name).join(', ') || '(无)'}`)

  const registerPrinters = buildRegisterPrintersList(localPrinters)
  if (!registerPrinters.length) {
    console.error(
      '[错误] 没有可注册的打印机编码：请使用 --bind-code 与后台「打印机管理」中的编码一致，或使用旧参数 --printer，或在本机安装打印机后重试',
    )
    process.exit(1)
  }
  primaryBindCode = registerPrinters[0].code
  console.log(`[主绑定编码] ${primaryBindCode}（注册/心跳 X-Printer-Code；调度仍按各打印机 code 分任务）`)

  if (registerPrinters.length > 1 && !ZPL_HOST && Object.keys(printRoutesMap).length === 0) {
    console.warn(
      '[提示] 本机注册了多台逻辑打印机：建议配置 --routes-file 或 FLOWCUBE_PRINT_ROUTES，或为每台斑马写 IP；否则仅 ZPL 默认可用 --zpl-host 一台',
    )
  }
  for (const p of registerPrinters) {
    const r = resolvePhysicalRoute(p.code)
    if (!r.zplHost && !r.lp && !r.winPrinter) {
      console.warn(`[提示] 打印机 ${p.code} 未配置物理路由（ZPL host / lp / winPrinter），ZPL 任务将依赖全局 --zpl-host`)
    }
  }

  await registerClient(registerPrinters)

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

async function registerClient(registerPrinters) {
  const payload = {
    clientId: STATION_CLIENT_ID,
    hostname: os.hostname(),
    printers: registerPrinters.map((p) => ({ name: p.name, code: p.code })),
  }
  try {
    await ensureToken()
    const res = await fetch(`${SERVER_URL}/api/printers/register-client`, {
      method: 'POST',
      headers: registerApiHeaders({
        'Content-Type': 'application/json',
        'X-Printer-Code': primaryBindCode,
      }),
      body: JSON.stringify(payload),
    })
    const json = await res.json().catch(() => ({}))
    if (json.success) {
      console.log(`[注册成功] clientId=${STATION_CLIENT_ID}`)
      const assigned = json.data?.assigned
      if (Array.isArray(assigned)) {
        for (const a of assigned) {
          const prev = a.previousClientId != null ? String(a.previousClientId) : ''
          if (prev && prev !== STATION_CLIENT_ID) {
            console.warn(`[认领] ${a.code} 已从工作站「${prev}」改绑到本机（仅当前在线客户端生效）`)
          }
        }
      }
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
