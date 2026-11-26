/**
 * ERP 桌面端本机 ZPL：打印机名校验在 main.js（getPrintersAsync，与「打印机管理」同源）
 * - Windows：WinSpool RAW（print-zpl-raw.ps1）
 * - macOS / Linux：lp -d <队列> -o raw
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile } = require('child_process')

function powershellExe() {
  const root = process.env.SystemRoot || process.env.windir
  if (root) {
    return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  }
  return 'powershell.exe'
}

function stripUtf8Bom(s) {
  const t = String(s ?? '')
  if (t.charCodeAt(0) === 0xfeff) return t.slice(1)
  return t
}

const RAW_TIMEOUT_MS = 30_000

async function withLabelFile(content, submit) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fc_desktop_zpl_'))
  try {
    await fs.promises.chmod(dir, 0o700)
    const file = path.join(dir, 'label.zpl')
    await fs.promises.writeFile(file, content, { flag: 'wx', mode: 0o600 })
    await submit(file)
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true })
  }
}

async function printZplViaLp(queue, content) {
  await withLabelFile(content, file => new Promise((resolve, reject) => {
    execFile('lp', ['-d', queue, '-o', 'raw', file], { timeout: RAW_TIMEOUT_MS },
      error => error ? reject(error) : resolve())
  }))
}

/** 将 stderr/stdout 转为可读字符串（Windows 上 PowerShell 常为系统代码页，避免全乱码） */
function decodeWindowsProcessOutput(buf) {
  if (buf == null || buf.length === 0) return ''
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf))
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(b)
  } catch {
    return b.toString('utf8')
  }
}

function bufferForWindowsRaw(stringContent) {
  return Buffer.from(stringContent, 'utf8')
}

async function printZplWindowsRaw(printerName, payload) {
  const directory = __dirname.replace(/([\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked')
  const script = path.join(directory, 'print-zpl-raw.ps1')
  await fs.promises.access(script, fs.constants.R_OK)
  await withLabelFile(payload, file => new Promise((resolve, reject) => {
    execFile(powershellExe(), [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ZplPath', file,
    ], {
      timeout: RAW_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'buffer',
      env: { ...process.env, FC_PRINTER_NAME: printerName },
    }, (error, stdout, stderr) => {
      if (!error) return resolve()
      const detail = decodeWindowsProcessOutput(stderr) || decodeWindowsProcessOutput(stdout) || error.message
      reject(new Error(detail.trim() || 'Windows RAW 打印失败，请核对驱动和打印机队列'))
    })
  }))
}

/**
 * @param {{ content: string, printerName: string }} opts
 */
async function printZpl(opts) {
  let content = stripUtf8Bom(String(opts?.content ?? '').trim())
  if (!content) throw new Error('ZPL 内容为空')
  const printerName = String(opts?.printerName ?? '').trim()
  if (!printerName) {
    throw new Error('缺少打印机名称：请在 ERP「打印机管理」用「从本机添加」添加标签机并绑定用途。')
  }
  const isZpl = content.includes('^XA') && content.includes('^XZ')
  if (!isZpl) {
    throw new Error('RAW 格式异常：须为 ZPL（^XA…^XZ），请检查模板或打印机指令集设置')
  }
  const kind = 'ZPL'
  const platform = os.platform()
  const winPayload = platform === 'win32' ? bufferForWindowsRaw(content) : null
  try {
    const n = winPayload ? winPayload.length : Buffer.byteLength(content, 'utf8')
    console.log(`[FlowCube RAW] ${kind} ${n} bytes → ${printerName}`)
  } catch {
    /* 忽略 */
  }
  if (platform === 'win32') {
    await printZplWindowsRaw(printerName, winPayload || Buffer.from(content, 'utf8'))
    return
  }
  try {
    await printZplViaLp(printerName, content)
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err)
    throw new Error(
      msg.trim() ||
        'CUPS lp 打印失败。请确认队列名正确、有权限执行 lp，且打印机接受 raw 作业。',
    )
  }
}

module.exports = { printZpl }
