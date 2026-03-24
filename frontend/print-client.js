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
const { exec } = require('child_process')
const net      = require('net')
const os       = require('os')

// ── 命令行参数解析 ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function getArg(name) {
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : null
}

const SERVER_URL   = getArg('--server')  || process.env.FLOWCUBE_SERVER  || 'http://localhost:3000'
const PRINTER_CODE = getArg('--printer') || process.env.PRINTER_CODE
const CLIENT_ID    = `${os.hostname()}-${PRINTER_CODE}`
const ZPL_HOST     = getArg('--zpl-host') // 斑马打印机 IP（ZPL 模式）
const ZPL_PORT     = parseInt(getArg('--zpl-port') || '9100', 10)
const LOCAL_PRINTER = getArg('--local-printer') // 系统打印机名称

if (!PRINTER_CODE) {
  console.error('[错误] 必须指定打印机编码：--printer LABEL_01')
  process.exit(1)
}

console.log(`[FlowCube 打印客户端]`)
console.log(`  服务器：${SERVER_URL}`)
console.log(`  打印机编码：${PRINTER_CODE}`)
console.log(`  本机：${os.hostname()}`)
console.log('')

// ── SSE 连接 ──────────────────────────────────────────────────────────────────
const SSE_URL = `${SERVER_URL}/api/print-jobs/listen/${PRINTER_CODE}`

function connect() {
  console.log(`[连接] ${SSE_URL}`)
  const url = new URL(SSE_URL)
  const client = url.protocol === 'https:' ? https : http

  const req = client.request(SSE_URL, { headers: { Accept: 'text/event-stream' } }, (res) => {
    if (res.statusCode !== 200) {
      console.error(`[错误] 服务器返回 ${res.statusCode}`)
      setTimeout(connect, 5000)
      return
    }
    console.log('[已连接] 等待打印任务...')

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
      console.log('[断开] 5 秒后重连...')
      setTimeout(connect, 5000)
    })
  })

  req.on('error', (e) => {
    console.error(`[网络错误] ${e.message}，5 秒后重连...`)
    setTimeout(connect, 5000)
  })

  req.end()
}

// ── 任务处理 ──────────────────────────────────────────────────────────────────
async function handleJob(job) {
  console.log(`[打印] #${job.id} ${job.title} (${job.contentType})`)
  try {
    if (job.contentType === 'zpl') {
      await printZpl(job.content)
    } else if (job.contentType === 'html') {
      await printHtml(job.content, job.copies)
    } else {
      await printText(job.content, job.copies)
    }
    await reportComplete(job.id)
    console.log(`[完成] #${job.id}`)
  } catch (e) {
    console.error(`[失败] #${job.id}`, e.message)
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

async function heartbeat() {
  try {
    await fetch(`${SERVER_URL}/api/printers/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: CLIENT_ID }),
    })
  } catch {
    // 心跳失败不阻塞主流程
  }
}

// ── 启动 ──────────────────────────────────────────────────────────────────────
async function main() {
  // 1. 获取本机打印机列表
  const localPrinters = await getLocalPrinters()
  console.log(`[本机打印机] ${localPrinters.length} 台：${localPrinters.map(p => p.name).join(', ') || '(无)'}`)

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
      console.log(`[注册成功] clientId=${CLIENT_ID}`)
    } else {
      console.warn(`[注册失败] ${json.message}`)
    }
  } catch (e) {
    console.warn(`[注册跳过] 无法连接服务器：${e.message}`)
  }
}

main()
