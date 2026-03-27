/**
 * ERP 桌面端本机 ZPL：仅使用「打印机管理」中的逻辑打印机名称（与从本机添加时一致）
 * - Windows：WinSpool RAW
 * - macOS / Linux：lp -d <名称> -o raw（名称即 CUPS 队列名）
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile, execFileSync } = require('child_process')

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

function powershellExe() {
  const root = process.env.SystemRoot || process.env.windir
  if (root) {
    return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  }
  return 'powershell.exe'
}

function printZplWindowsRaw(printerName, content) {
  const name = String(printerName || '').trim()
  if (!name) throw new Error('打印机名称为空')
  const tmpZpl = path.join(
    os.tmpdir(),
    `fc_zpl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.zpl`,
  )
  fs.writeFileSync(tmpZpl, Buffer.from(content, 'utf8'), { flag: 'w' })

  const bundled = path.join(__dirname, 'print-zpl-raw.ps1')
  let tmpPs1 = null
  try {
    if (!fs.existsSync(bundled)) {
      throw new Error('缺少内置 RAW 打印脚本 print-zpl-raw.ps1')
    }
    const scriptText = fs.readFileSync(bundled, 'utf8')
    tmpPs1 = path.join(os.tmpdir(), `fc_raw_${Date.now()}.ps1`)
    fs.writeFileSync(tmpPs1, scriptText, 'utf8')

    execFileSync(powershellExe(), [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      tmpPs1,
      '-PrinterName',
      name,
      '-ZplPath',
      tmpZpl,
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  } catch (e) {
    const stderr =
      e && typeof e.stderr !== 'undefined'
        ? Buffer.isBuffer(e.stderr)
          ? e.stderr.toString('utf8')
          : String(e.stderr)
        : ''
    throw new Error((stderr || e?.message || '').trim() || 'Windows RAW 打印失败')
  } finally {
    try {
      fs.unlinkSync(tmpZpl)
    } catch {
      /* 忽略 */
    }
    if (tmpPs1) {
      try {
        fs.unlinkSync(tmpPs1)
      } catch {
        /* 忽略 */
      }
    }
  }
}

/**
 * @param {{ content: string, printerName: string }} opts
 */
async function printZpl(opts) {
  const content = String(opts?.content ?? '')
  if (!content) throw new Error('ZPL 内容为空')
  const printerName = String(opts?.printerName ?? '').trim()
  if (!printerName) {
    throw new Error('缺少打印机名称：请用「从本机添加」添加打印机并绑定用途。')
  }
  const platform = os.platform()
  if (platform === 'win32') {
    printZplWindowsRaw(printerName, content)
    return
  }
  await printZplViaLp(printerName, content)
}

module.exports = { printZpl }
