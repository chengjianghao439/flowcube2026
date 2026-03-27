/**
 * 标签 ZPL 打印模板：从 print_templates（type 5–9）读取默认模板，占位符 {{key}} 替换为实际值。
 */

const { pool } = require('../../config/db')
const { safeJsonParse } = require('../../utils/safeJsonParse')

/** 与 print_templates.type 一致：5 货架 6 散件容器 7 物流箱贴 8 商品 9 库存 */
const LABEL_TEMPLATE_TYPES = [5, 6, 7, 8, 9]

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
 * @param {number} templateType 5–9
 * @returns {Promise<string|null>} 无默认模板或未配置时返回 null
 */
async function getDefaultZplBody(templateType) {
  const t = Number(templateType)
  if (!LABEL_TEMPLATE_TYPES.includes(t)) return null
  const [rows] = await pool.query(
    `SELECT layout_json FROM print_templates WHERE type=? AND is_default=1 ORDER BY id ASC LIMIT 1`,
    [t],
  )
  if (!rows[0]) return null
  let layout = rows[0].layout_json
  if (typeof layout === 'string') {
    try {
      layout = safeJsonParse(layout, 'labelZplTemplate.layout_json', {})
    } catch {
      return null
    }
  }
  if (layout?.format === 'zpl' && typeof layout.body === 'string' && layout.body.trim()) {
    return layout.body.trim()
  }
  return null
}

module.exports = {
  applyZplTemplate,
  getDefaultZplBody,
  LABEL_TEMPLATE_TYPES,
}
