/**
 * 浏览器端统一 JSON 解析：去 BOM、trim；解析前打预览；失败时输出原始与规范化字符串。
 */

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

export function normalizeJsonText(raw: string): string {
  return stripBom(raw).trim()
}

/**
 * @param logBeforeParse 为 true 时解析前 console.warn（本地存储恢复等低频场景）
 */
export function safeJsonParse<T>(raw: string | null | undefined, label: string, logBeforeParse = true): T | undefined {
  if (raw == null || raw === '') return undefined
  const normalized = normalizeJsonText(raw)
  if (!normalized) return undefined
  if (logBeforeParse) {
    const preview = normalized.length > 400 ? `${normalized.slice(0, 400)}…[length=${normalized.length}]` : normalized
    console.warn(`[${label}] 即将解析 JSON length=${normalized.length} 预览:`, preview)
  }
  try {
    return JSON.parse(normalized) as T
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[${label}] JSON.parse 失败: ${msg}`)
    console.error(`[${label}] 原始字符串(完整):`, raw)
    console.error(`[${label}] 规范化后(完整):`, normalized)
    console.error(`[${label}] 末尾80字符:`, JSON.stringify(normalized.slice(-80)))
    return undefined
  }
}
