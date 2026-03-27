/**
 * ERP 桌面端本机 ZPL：仅使用「打印机管理」中的逻辑打印机名称（与从本机添加时一致）
 * - Windows：WinSpool RAW（RAW 前用 Get-Printer 校验名称是否存在）
 * - macOS / Linux：lp -d <名称> -o raw（RAW 前用 lpstat -p 校验队列）
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

/** Windows：枚举本机打印机名；失败时返回 null（跳过校验，避免旧系统无 Get-Printer） */
function getWindowsPrinterNames() {
  try {
    const out = execFileSync(
      powershellExe(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-Printer -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name',
      ],
      { encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true },
    )
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  } catch (e) {
    console.warn('[FlowCube] Get-Printer 不可用，跳过打印机存在性校验:', e?.message || e)
    return null
  }
}

function verifyPrinterExistsWindows(printerName) {
  const target = String(printerName || '').trim()
  const names = getWindowsPrinterNames()
  if (!names || names.length === 0) return
  const hit = names.some((n) => n.toLowerCase() === target.toLowerCase())
  if (hit) return
  const sample = names.slice(0, 12).join('、')
  const more = names.length > 12 ? ` … 等共 ${names.length} 台` : ''
  throw new Error(
    `找不到打印机「${target}」。请到 Windows「设置 → 打印机和扫描仪」核对名称，并与 ERP「打印机管理 → 从本机添加」中的名称完全一致（含空格与标点）。本机已安装：${sample}${more}`,
  )
}

function verifyPrinterExistsUnix(queue) {
  const q = String(queue || '').trim()
  try {
    execFileSync('lpstat', ['-p', q], { stdio: 'pipe', timeout: 15000 })
  } catch {
    let hint = ''
    try {
      const out = execFileSync('lpstat', ['-a'], { encoding: 'utf8', timeout: 15000 })
      const lines = (out || '')
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .slice(0, 8)
      if (lines.length) hint = `\n本机 lpstat -a（节选）：\n${lines.join('\n')}`
    } catch {
      /* ignore */
    }
    throw new Error(
      `找不到 CUPS 打印队列「${q}」。请到系统「打印机」设置核对队列名，并与 ERP 中名称一致；标签 RAW 打印需使用真实队列名（非 PDF 虚拟打印机）。${hint}`,
    )
  }
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

    execFileSync(
      powershellExe(),
      [
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
      ],
      { encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true },
    )
  } catch (e) {
    const stderr =
      e && typeof e.stderr !== 'undefined'
        ? Buffer.isBuffer(e.stderr)
          ? e.stderr.toString('utf8')
          : String(e.stderr)
        : ''
    const combined = (stderr || e?.message || '').trim()
    throw new Error(
      combined ||
        'Windows RAW 打印失败。请核对打印机名称、驱动是否支持 RAW（推荐 ZDesigner），并查看主进程日志。',
    )
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
  const content = String(opts?.content ?? '').trim()
  if (!content) throw new Error('ZPL 内容为空')
  const printerName = String(opts?.printerName ?? '').trim()
  if (!printerName) {
    throw new Error('缺少打印机名称：请在 ERP「打印机管理」用「从本机添加」添加标签机并绑定用途。')
  }
  if (!content.includes('^XA') || !content.includes('^XZ')) {
    throw new Error('ZPL 格式异常：缺少 ^XA 或 ^XZ，请检查模板或联系管理员')
  }
  const platform = os.platform()
  if (platform === 'win32') {
    verifyPrinterExistsWindows(printerName)
    printZplWindowsRaw(printerName, content)
    return
  }
  verifyPrinterExistsUnix(printerName)
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
