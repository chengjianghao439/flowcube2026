/**
 * ERP 桌面端本机 ZPL：打印机名校验在 main.js（getPrintersAsync，与「打印机管理」同源）
 * - Windows：WinSpool RAW（print-zpl-raw.ps1）
 * - macOS / Linux：lp -d <队列> -o raw
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile, execFileSync } = require('child_process')

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
      throw new Error('缺少内置 RAW 打印脚本 print-zpl-raw.ps1（请重新安装 FlowCube 桌面端）')
    }
    const scriptText = fs.readFileSync(bundled, 'utf8')
    tmpPs1 = path.join(os.tmpdir(), `fc_raw_${Date.now()}.ps1`)
    fs.writeFileSync(tmpPs1, scriptText, 'utf8')

    try {
      execFileSync(
        powershellExe(),
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          tmpPs1,
          '-ZplPath',
          tmpZpl,
        ],
        {
          maxBuffer: 1024 * 1024,
          windowsHide: true,
          encoding: 'buffer',
          env: {
            ...process.env,
            /** UTF-16 进程环境块，比命令行参数更可靠传递中文打印机名 */
            FC_PRINTER_NAME: name,
          },
        },
      )
    } catch (e) {
      const stderr = decodeWindowsProcessOutput(e?.stderr)
      const stdout = decodeWindowsProcessOutput(e?.stdout)
      const combined = (stderr || stdout || e?.message || '').trim()
      throw new Error(
        combined ||
          'Windows RAW 打印失败。请核对打印机名称、驱动是否支持 RAW（推荐 ZDesigner），并查看主进程日志。',
      )
    }
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
  let content = stripUtf8Bom(String(opts?.content ?? '').trim())
  if (!content) throw new Error('ZPL 内容为空')
  const printerName = String(opts?.printerName ?? '').trim()
  if (!printerName) {
    throw new Error('缺少打印机名称：请在 ERP「打印机管理」用「从本机添加」添加标签机并绑定用途。')
  }
  const isZpl = content.includes('^XA') && content.includes('^XZ')
  const u = content.toUpperCase()
  const isTspl = u.includes('SIZE') && u.includes('CLS') && u.includes('PRINT')
  if (!isZpl && !isTspl) {
    throw new Error('RAW 格式异常：须为 ZPL（^XA…^XZ）或 TSPL（含 SIZE、CLS、PRINT），请检查模板或打印机指令集设置')
  }
  const platform = os.platform()
  if (platform === 'win32') {
    printZplWindowsRaw(printerName, content)
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
