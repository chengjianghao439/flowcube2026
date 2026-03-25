/**
 * 统一 JSON 解析：去 BOM、trim；可选解析前日志；失败时输出完整原始数据。
 * 禁止依赖「拼接/追加」产生的文件内容，调用方须保证 readFile 得到单一 JSON 文档。
 */

function stripBom(s) {
  if (typeof s !== 'string') return s
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

function normalizeJsonText(raw) {
  if (raw == null) return ''
  const s = stripBom(String(raw)).trim()
  return s
}

/**
 * @param {string} raw
 * @param {string} label 日志标识
 * @param {{ logBeforeParse?: boolean }} [opts]
 * @returns {unknown}
 */
function safeJsonParse(raw, label = 'JSON', opts = {}) {
  const { logBeforeParse = process.env.FLOWCUBE_DEBUG_JSON === '1' } = opts
  const normalized = normalizeJsonText(raw)
  if (!normalized) {
    const err = new Error(`${label}: 空内容或非 JSON`)
    console.error(`[${label}]`, err.message, 'raw=', typeof raw === 'string' ? JSON.stringify(raw.slice(0, 200)) : raw)
    throw err
  }
  if (logBeforeParse) {
    const head = normalized.length > 500 ? `${normalized.slice(0, 500)}…[共${normalized.length}字符]` : normalized
    console.warn(`[${label}] 解析前 length=${normalized.length} 预览:`, head)
  }
  try {
    return JSON.parse(normalized)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[${label}] JSON.parse 失败: ${msg}`)
    const dump = typeof raw === 'string' ? raw : String(raw)
    console.error(`[${label}] 原始数据 length=${dump.length}:`, dump.length > 6000 ? `${dump.slice(0, 6000)}…` : dump)
    console.error(`[${label}] 规范化后 length=${normalized.length}:`, normalized.length > 6000 ? `${normalized.slice(0, 6000)}…` : normalized)
    const tail = normalized.slice(-80)
    console.error(`[${label}] 末尾80字符(排查 JSON 后多余字符):`, JSON.stringify(tail))
    throw e
  }
}

module.exports = { safeJsonParse, normalizeJsonText, stripBom }
