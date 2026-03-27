/**
 * 标签 ZPL：从 print_templates（type 5–9）默认模板生成 ZPL。
 * - 兼容 layout.format=zpl + body（占位符 {{key}}）
 * - 画布 layout.elements：按元素坐标生成 ZPL（mm → 点阵，203dpi）
 */

const { pool } = require('../../config/db')
const { safeJsonParse } = require('../../utils/safeJsonParse')

/** 与 print_templates.type 一致：5 货架 6 散件容器 7 物流箱贴 8 商品 9 库存 */
const LABEL_TEMPLATE_TYPES = [5, 6, 7, 8, 9]

/** 203 dpi：1mm ≈ 8 点 */
const MM_TO_DOT = 203 / 25.4

function sanitizeZplValue(v) {
  return String(v ?? '')
    .replace(/\^/g, ' ')
    .replace(/[\r\n\x00]/g, ' ')
    .trim()
}

/**
 * @param {string} body
 * @param {Record<string, string|number|null|undefined>} vars
 */
function applyZplTemplate(body, vars) {
  let s = String(body ?? '')
  const keys = Object.keys(vars || {})
  for (const key of keys) {
    const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\{\\{\\s*${safe}\\s*\\}\\}`, 'g')
    s = s.replace(re, sanitizeZplValue(vars[key]))
  }
  return s
}

/**
 * @param {object} layout
 * @param {Record<string, string|number|null|undefined>} vars
 * @param {string} paperSize thermal80 | thermal58
 * @returns {string|null}
 */
function generateZplFromElements(layout, vars, paperSize) {
  const elements = layout?.elements
  if (!Array.isArray(elements) || elements.length === 0) return null
  const paperWmm = paperSize === 'thermal58' ? 58 : 80
  const widthDots = Math.round(paperWmm * MM_TO_DOT)
  const sorted = [...elements]
    .filter(e => e && e.type !== 'divider' && e.type !== 'table')
    .sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0))

  let body = `^XA^CI28^LH0,0^PW${widthDots}`
  let segments = 0
  for (const el of sorted) {
    const x = Math.round((el.x || 0) * MM_TO_DOT)
    const y = Math.round((el.y || 0) * MM_TO_DOT)
    const rawVal = vars[el.fieldKey]

    if (el.type === 'barcode') {
      const code = String(rawVal ?? '').replace(/[\r\n^~]/g, '')
      if (!code) continue
      const barH = Math.max(28, Math.min(120, Math.round((el.height || 14) * MM_TO_DOT)))
      body += `^FO${x},${y}^BY2^BCN,${barH},Y,N,N^FD${code}^FS`
      segments += 1
    } else if (el.type === 'title' || el.type === 'text') {
      const t = sanitizeZplValue(rawVal)
      if (!t) continue
      const fs = Math.max(16, Math.min(72, Math.round((el.fontSize || 10) * 2.2)))
      body += `^FO${x},${y}^A0N,${fs},${fs}^FD${t}^FS`
      segments += 1
    }
  }
  if (segments === 0) return null
  body += '^XZ'
  return body
}

/**
 * 读取默认模板并生成完整 ZPL（已替换变量）。无模板或无法生成时返回 null。
 * @param {number} templateType 5–9
 * @param {Record<string, string|number|null|undefined>} vars
 */
async function getLabelZplFromDefaultTemplate(templateType, vars) {
  const t = Number(templateType)
  if (!LABEL_TEMPLATE_TYPES.includes(t)) return null
  const [rows] = await pool.query(
    `SELECT layout_json, paper_size FROM print_templates WHERE type=? AND is_default=1 ORDER BY id ASC LIMIT 1`,
    [t],
  )
  if (!rows[0]) return null
  let layout = rows[0].layout_json
  const paperSize = rows[0].paper_size || 'thermal80'
  if (typeof layout === 'string') {
    try {
      layout = safeJsonParse(layout, 'labelZplTemplate.layout_json', {})
    } catch {
      return null
    }
  }
  if (layout?.format === 'zpl' && typeof layout.body === 'string' && layout.body.trim()) {
    return applyZplTemplate(layout.body.trim(), vars)
  }
  if (Array.isArray(layout?.elements)) {
    return generateZplFromElements(layout, vars, paperSize)
  }
  return null
}

module.exports = {
  applyZplTemplate,
  sanitizeZplValue,
  generateZplFromElements,
  getLabelZplFromDefaultTemplate,
  LABEL_TEMPLATE_TYPES,
}
