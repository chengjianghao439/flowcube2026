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
 * @param logBeforeParse 为 true 时解析前输出调试日志（本地存储恢复等低频场景）
 *
 * 2026-09-17 验收 ISSUE-007：这里原本无条件 console.warn，而 usePendingRequests
 * 每次读取待确认记录都会调用一次，PDA 上十几秒就能刷十几条 `length=2 预览: []`
 * 的同名 warn，把真实告警淹没。空集合/空对象这类没有排障价值的内容不再打印，
 * 有内容时仍保留 warn（排障需要）；失败路径保持 console.error。
 */
export function safeJsonParse<T>(raw: string | null | undefined, label: string, logBeforeParse = true): T | undefined {
  if (raw == null || raw === '') return undefined
  const normalized = normalizeJsonText(raw)
  if (!normalized) return undefined
  if (logBeforeParse && normalized.length > 2) {
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
