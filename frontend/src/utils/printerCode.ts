/**
 * 与后端 print-jobs.middleware SAFE_PRINTER_CODE 一致：^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$
 */
export function systemNameToPrinterCode(name: string): string {
  const trimmed = name.trim()
  const raw = trimmed
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  let code = raw || ''
  if (!code || !/^[A-Za-z0-9]/.test(code)) {
    let h = 0
    for (let i = 0; i < trimmed.length; i++) h = (h * 31 + trimmed.charCodeAt(i)) >>> 0
    code = 'P' + (h >>> 0).toString(36).toUpperCase().slice(0, 12)
  }
  return code.slice(0, 50)
}

export function ensureUniquePrinterCode(base: string, existing: Set<string>): string {
  let c = base
  let n = 2
  while (existing.has(c)) {
    const suffix = `_${n}`
    c = (base.slice(0, Math.max(0, 50 - suffix.length)) + suffix).slice(0, 50)
    n++
  }
  return c
}
