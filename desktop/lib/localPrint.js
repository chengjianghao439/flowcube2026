/**
 * ERP 桌面端本机 ZPL：网口 TCP 或 macOS/Linux CUPS raw
 */
const net = require('net')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile } = require('child_process')

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

function printZplViaLp(queue, content) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `fc_desktop_zpl_${Date.now()}.zpl`)
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

/**
 * @param {{ content: string, host?: string, port?: number, lpQueue?: string }} opts
 */
async function printZpl(opts) {
  const content = String(opts?.content ?? '')
  if (!content) throw new Error('ZPL 内容为空')
  const host = opts.host ? String(opts.host).trim() : ''
  const port = Number(opts.port) > 0 ? Number(opts.port) : 9100
  const lpQueue = opts.lpQueue ? String(opts.lpQueue).trim() : ''

  if (host) {
    await printZplTcp(host, port, content)
    return
  }
  const platform = os.platform()
  if (lpQueue && platform !== 'win32') {
    await printZplViaLp(lpQueue, content)
    return
  }
  throw new Error(
    '请配置 ZPL 打印机网口 IP，或在 macOS/Linux 下填写 CUPS 队列名（raw）。Windows 本机直连需网口 IP。',
  )
}

module.exports = { printZpl }
