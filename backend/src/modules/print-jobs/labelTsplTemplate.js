/**
 * 标签 TSPL（TSC）：默认模板 type 5–9；layout.format=tspl + body；画布 elements（与 ZPL 同源 mm 坐标）；或内置兜底布局。
 */

const { pool } = require('../../config/db')
const { safeJsonParse } = require('../../utils/safeJsonParse')

const LABEL_TEMPLATE_TYPES = [5, 6, 7, 8, 9]

/** 与 ZPL 一致：203 dpi → mm 转点 */
const MM_TO_DOT = 203 / 25.4

function sanitizeTsplValue(v) {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n\x00]/g, ' ')
    .trim()
}

function applyTsplTemplate(body, vars) {
  let s = String(body ?? '')
  const keys = Object.keys(vars || {})
  for (const key of keys) {
    const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\{\\{\\s*${safe}\\s*\\}\\}`, 'g')
    s = s.replace(re, sanitizeTsplValue(vars[key]))
  }
  return s
}

/** 中文常用点阵字体（TSC 兼容机）；若无此字库可改用 font "3" 仅英文 */
const TSPL_TEXT_FONT = 'TSS24.BF2'

function buildRackLabelTspl({ rack_barcode, rack_code, zone, name }) {
  const code = String(rack_barcode ?? '').replace(/[\r\n"\\]/g, '')
  const rc = sanitizeTsplValue(String(rack_code ?? '').slice(0, 28))
  const z = sanitizeTsplValue(String(zone ?? '').slice(0, 12))
  const n = sanitizeTsplValue(String(name ?? '').slice(0, 20))
  const line3 = `${z} ${n}`.trim()
  const lines = [
    'SIZE 60 mm,40 mm',
    'GAP 2 mm,0 mm',
    'DIRECTION 0',
    'REFERENCE 0,0',
    'CLS',
    `BARCODE 40,24,"128",72,1,0,2,2,"${code}"`,
    `TEXT 40,108,"${TSPL_TEXT_FONT}",0,1,1,"${rc}"`,
  ]
  if (line3) lines.push(`TEXT 40,148,"${TSPL_TEXT_FONT}",0,1,1,"${line3}"`)
  lines.push('PRINT 1')
  return lines.join('\n')
}

function buildContainerLabelTspl({ container_code, product_name, qty }) {
  const code = String(container_code ?? '').replace(/[\r\n"\\]/g, '')
  const name = sanitizeTsplValue(String(product_name ?? '').slice(0, 32))
  const q = Number(qty)
  const qtyStr = sanitizeTsplValue(Number.isFinite(q) ? String(q) : String(qty ?? ''))
  return [
    'SIZE 60 mm,40 mm',
    'GAP 2 mm,0 mm',
    'DIRECTION 0',
    'REFERENCE 0,0',
    'CLS',
    `BARCODE 40,24,"128",72,1,0,2,2,"${code}"`,
    `TEXT 40,108,"${TSPL_TEXT_FONT}",0,1,1,"${name}"`,
    `TEXT 40,148,"${TSPL_TEXT_FONT}",0,1,1,"QTY ${qtyStr}"`,
    'PRINT 1',
  ].join('\n')
}

function resolveLabelWidthMm(layout, paperSize) {
  const n = Number(layout?.canvasWidthMm)
  if (Number.isFinite(n) && n >= 30 && n <= 120) return Math.round(n)
  return paperSize === 'thermal58' ? 58 : 80
}

function resolveLabelHeightMm(layout, paperSize) {
  const n = Number(layout?.canvasHeightMm)
  if (Number.isFinite(n) && n >= 20 && n <= 500) return Math.round(n)
  const elements = layout?.elements
  if (Array.isArray(elements) && elements.length) {
    let maxB = 0
    for (const el of elements) {
      if (!el || el.type === 'divider' || el.type === 'table') continue
      const b = (el.y || 0) + (el.height || 0)
      if (b > maxB) maxB = b
    }
    if (maxB > 0) return Math.min(500, Math.max(25, Math.ceil(maxB + 4)))
  }
  return paperSize === 'thermal58' ? 40 : 45
}

/**
 * 画布 elements → TSPL（与 labelZplTemplate 同源坐标，单位 mm→dot）
 * @returns {string|null}
 */
function generateTsplFromElements(layout, vars, paperSize) {
  const elements = layout?.elements
  if (!Array.isArray(elements) || elements.length === 0) return null
  const wMm = resolveLabelWidthMm(layout, paperSize)
  const hMm = resolveLabelHeightMm(layout, paperSize)
  const sorted = [...elements]
    .filter((e) => e && e.type !== 'divider' && e.type !== 'table')
    .sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0))

  let segments = 0
  const lines = [
    `SIZE ${wMm} mm,${hMm} mm`,
    'GAP 2 mm,0 mm',
    'DIRECTION 0',
    'REFERENCE 0,0',
    'CLS',
  ]

  for (const el of sorted) {
    const x = Math.round((el.x || 0) * MM_TO_DOT)
    const y = Math.round((el.y || 0) * MM_TO_DOT)
    const rawVal = vars[el.fieldKey]

    if (el.type === 'barcode') {
      const code = String(rawVal ?? '').replace(/[\r\n"\\]/g, '')
      if (!code) continue
      const barH = Math.max(28, Math.min(120, Math.round((el.height || 14) * MM_TO_DOT)))
      lines.push(`BARCODE ${x},${y},"128",${barH},1,0,2,2,"${code}"`)
      segments += 1
    } else if (el.type === 'title' || el.type === 'text') {
      const t = sanitizeTsplValue(rawVal)
      if (!t) continue
      const mul = Math.max(1, Math.min(6, Math.round(((el.fontSize || 10) / 10) * 1.2)))
      lines.push(`TEXT ${x},${y},"${TSPL_TEXT_FONT}",0,${mul},${mul},"${t}"`)
      segments += 1
    }
  }

  if (segments === 0) return null
  lines.push('PRINT 1')
  return lines.join('\n')
}

function buildPackageLabelTspl({ box_code, task_no, customer_name, summary }) {
  const bc = String(box_code ?? '').replace(/[\r\n"\\]/g, '')
  const tn = sanitizeTsplValue(String(task_no ?? '').slice(0, 24))
  const cn = sanitizeTsplValue(String(customer_name ?? '').slice(0, 24))
  const sm = sanitizeTsplValue(String(summary ?? '').slice(0, 36))
  return [
    'SIZE 60 mm,40 mm',
    'GAP 2 mm,0 mm',
    'DIRECTION 0',
    'REFERENCE 0,0',
    'CLS',
    `BARCODE 40,20,"128",72,1,0,2,2,"${bc}"`,
    `TEXT 40,104,"${TSPL_TEXT_FONT}",0,1,1,"${tn}"`,
    `TEXT 40,144,"${TSPL_TEXT_FONT}",0,1,1,"${cn}"`,
    `TEXT 40,184,"${TSPL_TEXT_FONT}",0,1,1,"${sm}"`,
    'PRINT 1',
  ].join('\n')
}

/**
 * @param {number} templateType 5–9
 * @param {Record<string, string|number|null|undefined>} vars
 */
async function getLabelTsplFromDefaultTemplate(templateType, vars) {
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
      layout = safeJsonParse(layout, 'labelTsplTemplate.layout_json', {})
    } catch {
      return null
    }
  }
  if (layout?.format === 'tspl' && typeof layout.body === 'string' && layout.body.trim()) {
    return applyTsplTemplate(layout.body.trim(), vars)
  }
  if (Array.isArray(layout?.elements)) {
    return generateTsplFromElements(layout, vars, paperSize)
  }
  return null
}

module.exports = {
  buildRackLabelTspl,
  buildContainerLabelTspl,
  buildPackageLabelTspl,
  getLabelTsplFromDefaultTemplate,
  applyTsplTemplate,
  generateTsplFromElements,
}
