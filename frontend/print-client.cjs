#!/usr/bin/env node
/**
 * FlowCube 桌面端打印客户端
 * 运行在连接打印机的电脑上，通过 SSE 监听打印任务并执行本地打印
 *
 * 使用方式：
 *   node print-client.js --server http://192.168.8.109:3000 --printer LABEL_01
 *
 * 安装依赖：
 *   npm install node-fetch@2 node-html-to-image pdf-lib
 *
 * 打印方式：
 *   - HTML 内容：调用系统默认打印机通过 Chrome headless 打印
 *   - ZPL 内容：通过 TCP Socket 直接发送到斑马打印机
 *   - 纯文本：通过系统打印队列发送
 */

// Node.js 18+ 内置 fetch，无需安装 node-fetch
const http     = require('http')
const https    = require('https')
const { exec, spawnSync } = require('child_process')
const net      = require('net')
const os       = require('os')
const fs       = require('fs')
const path     = require('path')

// ── 日志系统（控制台 + 文件）──────────────────────────────────────────────────
const IS_DEV = process.env.NODE_ENV !== 'production'
const LOG_DIR = path.join(__dirname, 'logs')
const LOG_FILE = path.join(LOG_DIR, 'print-client.log')

fs.mkdirSync(LOG_DIR, { recursive: true })

function writeLog(level, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`
  fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8')
  if (IS_DEV) {
    if (level === 'ERROR') process.stderr.write(`${line}\n`)
    else if (level === 'WARN') process.stderr.write(`${line}\n`)
    else process.stdout.write(`${line}\n`)
  }
}

const logger = {
  info: (message) => writeLog('INFO', message),
  warn: (message) => writeLog('WARN', message),
  error: (message) => writeLog('ERROR', message),
}

process.on('uncaughtException', (e) => logger.error(`uncaughtException: ${e.stack || e.message}`))
process.on('unhandledRejection', (e) => logger.error(`unhandledRejection: ${e?.stack || e}`))

// ── 命令行参数 + config.json ────────────────────────────────────────────────
const args = process.argv.slice(2)
function getArg(name) {
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : null
}

const CONFIG_PATH = path.join(__dirname, 'config.json')
const DEFAULT_CONFIG = {
  server: 'http://localhost:3000',
  printerCode: 'LABEL_01',
  autoStart: true,
}

function ensureConfigFile() {
  if (fs.existsSync(CONFIG_PATH)) return false
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8')
  return true
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

const createdConfig = ensureConfigFile()
const fileConfig = loadConfig()

const SERVER_URL = getArg('--server') || fileConfig.server || process.env.FLOWCUBE_SERVER || DEFAULT_CONFIG.server
const PRINTER_CODE = getArg('--printer') || fileConfig.printerCode || process.env.PRINTER_CODE || DEFAULT_CONFIG.printerCode
const AUTO_START = typeof fileConfig.autoStart === 'boolean' ? fileConfig.autoStart : true
const ZPL_HOST = getArg('--zpl-host') || null
const ZPL_PORT = parseInt(getArg('--zpl-port') || '9100', 10)
const LOCAL_PRINTER = getArg('--local-printer') || null
const CLIENT_ID = `${os.hostname()}-${PRINTER_CODE}`

function getWindowsRunCommandValue() {
  const exePath = process.execPath
  const args = process.argv.slice(1).map(a => `"${a}"`).join(' ')
  return args ? `"${exePath}" ${args}` : `"${exePath}"`
}

function syncWindowsAutoStart() {
  if (process.platform !== 'win32') return
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
  const name = 'FlowCubePrintClient'

  if (AUTO_START) {
    const value = getWindowsRunCommandValue()
    const r = spawnSync('reg', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { encoding: 'utf8' })
    if (r.status === 0) logger.info('[AutoStart] enabled')
    else logger.warn(`[AutoStart] sync failed: ${r.stderr || r.stdout || 'unknown error'}`)
    return
  }

  const r = spawnSync('reg', ['delete', key, '/v', name, '/f'], { encoding: 'utf8' })
  if (r.status === 0) logger.info('[AutoStart] disabled')
  else {
    const msg = `${r.stderr || r.stdout || ''}`
    if (/unable to find|找不到/i.test(msg)) logger.info('[AutoStart] disabled')
    else logger.warn(`[AutoStart] sync failed: ${msg || 'unknown error'}`)
  }
}

if (!PRINTER_CODE) {
  logger.error('[错误] 必须指定打印机编码：--printer LABEL_01 或 config.json.printerCode')
  process.exit(1)
}

if (createdConfig) {
  logger.info('[提示] 已自动创建 config.json，请按需修改 server / printerCode 后重启客户端。')
}

logger.info('[FlowCube Print Client]')
logger.info(`Server: ${SERVER_URL}`)
logger.info(`Printer: ${PRINTER_CODE}`)

// ── SSE 连接 ──────────────────────────────────────────────────────────────────
const SSE_URL = `${SERVER_URL}/api/print-jobs/listen/${PRINTER_CODE}`

function connect() {
  logger.info(`[连接] ${SSE_URL}`)
  const url = new URL(SSE_URL)
  const client = url.protocol === 'https:' ? https : http

  const req = client.request(SSE_URL, { headers: { Accept: 'text/event-stream' } }, (res) => {
    if (res.statusCode !== 200) {
      logger.error(`[错误] 服务器返回 ${res.statusCode}`)
      setTimeout(connect, 5000)
      return
    }
    logger.info('[已连接] 等待打印任务...')

    let buf = ''
    res.on('data', (chunk) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      lines.forEach(line => {
        if (line.startsWith('data: ')) {
          try {
            const job = JSON.parse(line.slice(6))
            handleJob(job)
          } catch { /* 忽略心跳 */ }
        }
      })
    })

    res.on('end', () => {
      logger.info('[断开] 5 秒后重连...')
      setTimeout(connect, 5000)
    })
  })

  req.on('error', (e) => {
    logger.error(`[网络错误] ${e.message}，5 秒后重连...`)
    setTimeout(connect, 5000)
  })

  req.end()
}

// ── 任务处理 ──────────────────────────────────────────────────────────────────
async function handleJob(job) {
  logger.info(`[打印] #${job.id} ${job.title} (${job.contentType})`)
  try {
    if (job.contentType === 'zpl') {
      await printZpl(job.content)
    } else if (job.contentType === 'html') {
      await printHtml(job.content, job.copies)
    } else {
      await printText(job.content, job.copies)
    }
    await reportComplete(job.id)
    logger.info(`[完成] #${job.id}`)
  } catch (e) {
    logger.error(`[失败] #${job.id} ${e.message}`)
    await reportFail(job.id, e.message)
  }
}

// ── 打印方式：ZPL（斑马打印机，TCP Socket）────────────────────────────────────
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

// ── 打印方式：HTML（通过系统默认浏览器 / lp 命令）────────────────────────────
function printHtml(content, copies = 1) {
  return new Promise((resolve, reject) => {
    const platform = os.platform()
    // 写入临时 HTML 文件
    const tmpFile = require('path').join(os.tmpdir(), `fc_print_${Date.now()}.html`)
    require('fs').writeFileSync(tmpFile, content, 'utf8')

    let cmd
    if (platform === 'win32') {
      // Windows：通过 Chrome headless 打印
      const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      const printer = LOCAL_PRINTER ? `--printer-name="${LOCAL_PRINTER}"` : ''
      cmd = `"${chrome}" --headless --print-to-pdf-no-header --disable-gpu ${printer} "${tmpFile}"`
    } else if (platform === 'darwin') {
      // macOS：通过 lp 打印
      const printer = LOCAL_PRINTER ? `-d "${LOCAL_PRINTER}"` : ''
      cmd = `lp ${printer} -n ${copies} "${tmpFile}"`
    } else {
      // Linux：通过 lp 打印
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

// ── 打印方式：纯文本 ──────────────────────────────────────────────────────────
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

// ── 回调服务器 ────────────────────────────────────────────────────────────────
async function reportComplete(jobId) {
  await fetch(`${SERVER_URL}/api/print-jobs/${jobId}/complete`, { method: 'POST' }).catch(() => {})
}

async function reportFail(jobId, errorMessage) {
  await fetch(`${SERVER_URL}/api/print-jobs/${jobId}/fail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ errorMessage }),
  }).catch(() => {})
}

let heartbeatInFlight = false

async function heartbeat() {
  if (heartbeatInFlight) return
  heartbeatInFlight = true
  try {
    await fetch(`${SERVER_URL}/api/printers/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: CLIENT_ID }),
    })
    logger.info('[Heartbeat] success')
  } catch (e) {
    logger.warn(`[Heartbeat] failed: ${e.message || e}`)
    // 网络失败后快速重试一次，不影响主流程
    setTimeout(() => { heartbeat().catch(() => {}) }, 3_000)
  } finally {
    heartbeatInFlight = false
  }
}

// ── 启动 ──────────────────────────────────────────────────────────────────────
async function main() {
  syncWindowsAutoStart()

  // 1. 获取本机打印机列表
  const localPrinters = await getLocalPrinters()
  logger.info(`[本机打印机] ${localPrinters.length} 台：${localPrinters.map(p => p.name).join(', ') || '(无)'}`)

  // 2. 向服务器注册
  await registerClient(localPrinters)

  // 3. 启动心跳（每 10 秒）
  await heartbeat()
  setInterval(heartbeat, 10_000)

  // 4. 开始监听打印任务
  connect()
}

// ── 获取本机打印机列表 ────────────────────────────────────────────────────────
function getLocalPrinters() {
  return new Promise((resolve) => {
    const platform = os.platform()
    let cmd
    if (platform === 'win32') {
      cmd = 'wmic printer get Name /format:list'
    } else if (platform === 'darwin') {
      cmd = 'lpstat -a 2>/dev/null || echo ""'
    } else {
      cmd = 'lpstat -a 2>/dev/null || echo ""'
    }

    exec(cmd, (err, stdout) => {
      if (err) return resolve([])
      const printers = []
      if (platform === 'win32') {
        stdout.split('\n').forEach(line => {
          const m = line.match(/^Name=(.+)/)
          if (m) printers.push({ name: m[1].trim(), code: m[1].trim().replace(/\s+/g, '_').toUpperCase() })
        })
      } else {
        stdout.split('\n').forEach(line => {
          const m = line.match(/^(\S+)/)
          if (m && m[1]) printers.push({ name: m[1], code: m[1].replace(/[^A-Z0-9]/gi, '_').toUpperCase() })
        })
      }
      resolve(printers)
    })
  })
}

// ── 向服务器注册客户端 ────────────────────────────────────────────────────────
async function registerClient(localPrinters) {
  const payload = {
    clientId: CLIENT_ID,
    hostname: os.hostname(),
    printers: [
      { code: PRINTER_CODE, name: LOCAL_PRINTER || PRINTER_CODE },
      ...localPrinters,
    ],
  }
  try {
    const res = await fetch(`${SERVER_URL}/api/printers/register-client`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    if (json.success) {
      logger.info(`[注册成功] clientId=${CLIENT_ID}`)
    } else {
      logger.warn(`[注册失败] ${json.message}`)
    }
  } catch (e) {
    logger.warn(`[注册跳过] 无法连接服务器：${e.message}`)
  }
}

main()
