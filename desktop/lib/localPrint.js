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

/** 部分 TSC/佳博固件只认 LF，部分只认 CRLF；默认不改写（与 v0.3.30 及更早行为一致）。需 CRLF 时在桌面快捷方式或系统环境变量设置 FLOWCUBE_TSPL_CRLF=1 */
function normalizeTsplLineEndingsToCrlf(s) {
  return String(s)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .join('\r\n')
}

function shouldUseTsplCrlf() {
  const v = String(process.env.FLOWCUBE_TSPL_CRLF || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/** 部分佳博机型不认 CODEPAGE 行，解析失败则 Windows 仍显示已打印但不出纸；设 1 可去掉所有 CODEPAGE 再发 GB18030 */
function shouldOmitTsplCodepage() {
  const v = String(process.env.FLOWCUBE_TSPL_OMIT_CODEPAGE || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

function omitTsplCodepageLines(content) {
  return String(content)
    .split(/\r?\n/)
    .filter((line) => !/^\s*CODEPAGE\s+/i.test(line))
    .join('\n')
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

/**
 * TSPL 发往 Windows 时的字节编码。默认 GB18030（与常见中文点阵字库）；脚本中含 UTF-8 类 CODEPAGE 或设 FLOWCUBE_TSPL_BYTES=utf8 则送 UTF-8。
 */
function inferTsplWireEncoding(content) {
  const env = String(process.env.FLOWCUBE_TSPL_BYTES || '').trim().toLowerCase()
  if (env === 'utf8' || env === 'utf-8') return 'utf8'
  if (env === 'gbk' || env === 'gb18030') return 'gb18030'
  const u = String(content).toUpperCase()
  if (/\bCODEPAGE\s+65001\b/.test(u) || /\bCODEPAGE\s+UTF/.test(u)) return 'utf8'
  return 'gb18030'
}

function bufferForWindowsRaw(stringContent, isTspl) {
  if (!isTspl) return Buffer.from(stringContent, 'utf8')
  if (inferTsplWireEncoding(stringContent) === 'utf8') {
    return Buffer.from(stringContent, 'utf8')
  }
  try {
    const iconv = require('iconv-lite')
    return iconv.encode(stringContent, 'gb18030')
  } catch {
    return Buffer.from(stringContent, 'utf8')
  }
}

function printZplWindowsRaw(printerName, payload) {
  const name = String(printerName || '').trim()
  if (!name) throw new Error('打印机名称为空')
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ''), 'utf8')
  const tmpZpl = path.join(
    os.tmpdir(),
    `fc_zpl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.zpl`,
  )
  fs.writeFileSync(tmpZpl, buf, { flag: 'w' })

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
  if (isTspl && shouldUseTsplCrlf()) {
    content = normalizeTsplLineEndingsToCrlf(content)
  }
  if (isTspl && shouldOmitTsplCodepage()) {
    content = omitTsplCodepageLines(content)
  }
  if (!isZpl && !isTspl) {
    throw new Error('RAW 格式异常：须为 ZPL（^XA…^XZ）或 TSPL（含 SIZE、CLS、PRINT），请检查模板或打印机指令集设置')
  }
  const kind = isZpl ? 'ZPL' : 'TSPL'
  const platform = os.platform()
  const winPayload = platform === 'win32' ? bufferForWindowsRaw(content, isTspl) : null
  try {
    const tsplEol = isTspl ? (shouldUseTsplCrlf() ? 'CRLF' : 'native') : ''
    const extra = tsplEol ? ` TSPL_EOL=${tsplEol}` : ''
    const omitCp = isTspl && shouldOmitTsplCodepage() ? ' omit_cp=1' : ''
    const encExtra =
      platform === 'win32' && isTspl ? ` enc=${inferTsplWireEncoding(content)}` : ''
    const n = winPayload ? winPayload.length : Buffer.byteLength(content, 'utf8')
    console.log(`[FlowCube RAW] ${kind} ${n} bytes → ${printerName}${extra}${encExtra}${omitCp}`)
  } catch {
    /* 忽略 */
  }
  if (platform === 'win32') {
    printZplWindowsRaw(printerName, winPayload || Buffer.from(content, 'utf8'))
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
