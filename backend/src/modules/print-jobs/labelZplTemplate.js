/**
 * 标签 ZPL（DB 层）：从 print_templates（type 5–9）默认模板生成 ZPL。
 * 纯映射逻辑在 labelZpl.js（零依赖、可独立测试）；本文件只负责读库 + 兜底取模板。
 */

const { pool } = require('../../config/db')
const { safeJsonParse } = require('../../utils/safeJsonParse')
const logger = require('../../utils/logger')
const {
  applyZplTemplate,
  sanitizeZplValue,
  generateZplFromElements,
  MM_TO_DOT,
} = require('./labelZpl')

/** 与 print_templates.type 一致：5 货架 6 库存容器 7 物流箱贴 8 商品 9 塑料盒 */
const LABEL_TEMPLATE_TYPES = [5, 6, 7, 8, 9]

/**
 * 读取默认模板并生成完整 ZPL（已替换变量）。无模板或无法生成时返回 null。
 * 取模板优先 is_default=1；查不到则 fallback 到最近更新的同 type 模板
 * —— 修复「编辑器存的模板 is_default=0，真机取不到，改了没变」。
 * @param {number} templateType 5–9
 * @param {Record<string, string|number|null|undefined>} vars
 */
async function getLabelZplFromDefaultTemplate(templateType, vars) {
  const t = Number(templateType)
  if (!LABEL_TEMPLATE_TYPES.includes(t)) return null
  let [rows] = await pool.query(
    `SELECT layout_json, paper_size FROM print_templates WHERE type=? AND is_default=1 ORDER BY id ASC LIMIT 1`,
    [t],
  )
  if (!rows[0]) {
    ;[rows] = await pool.query(
      `SELECT layout_json, paper_size FROM print_templates WHERE type=? ORDER BY updated_at DESC, id DESC LIMIT 1`,
      [t],
    )
  }
  if (!rows[0]) return null
  let layout = rows[0].layout_json
  const paperSize = rows[0].paper_size || 'thermal80'
  if (typeof layout === 'string') {
    try {
      layout = safeJsonParse(layout, 'labelZplTemplate.layout_json', {})
    } catch (e) {
      logger.warn('ZPL 默认模板解析失败，降级使用内置模板', {
        templateType: t,
        degradation: 'print_template_parse_fallback',
        error: e?.message || String(e),
      }, 'PrintJobs')
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
  MM_TO_DOT,
}
