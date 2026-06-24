/**
 * 标签 ZPL 纯映射层（零依赖：不碰 DB/env）。
 * 职责：把统一几何层 resolveLayout 产出的中性图元（mm）×MM_TO_DOT 映射为 ZPL 指令。
 * 与前端预览共用同一几何（labelGeometry），保证「预览 = 真机」。
 *
 * DB 相关的「读默认模板生成 ZPL」在 labelZplTemplate.js（它 re-export 本模块函数）。
 */

'use strict'

const { resolveLayout } = require('./labelGeometry')

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

function calcBarcodeModuleWidth(codeLen, desiredWidthDots) {
  if (!codeLen || !desiredWidthDots) return 2
  // Code128: start(11) + data(11×N) + check(11) + stop(13) + quiet(20) ≈ 11N + 55
  const totalModules = codeLen * 11 + 55
  const by = Math.round(desiredWidthDots / totalModules)
  return Math.max(1, Math.min(10, by))
}

/** mm → dots（203dpi），下限 1 防止退化输入产出非法 ZPL */
function mmDot(mm) {
  return Math.max(1, Math.round(mm * MM_TO_DOT))
}

/**
 * 画布元素 → ZPL。经统一几何层 resolveLayout 解析（坐标/字高 mm），
 * 本函数只做 mm → dot 的设备映射与 ZPL 拼接，不再自带几何/过滤逻辑。
 * @param {object} layout
 * @param {Record<string, string|number|null|undefined>} vars
 * @param {string} paperSize thermal80 | thermal75 | thermal58
 * @returns {string|null}
 */
function generateZplFromElements(layout, vars, paperSize) {
  const { widthMm, primitives } = resolveLayout(layout, vars, paperSize)
  if (!primitives.length) return null

  const widthDots = Math.round(widthMm * MM_TO_DOT)
  let body = `^XA^CI28^LH0,0^PW${widthDots}`
  for (const p of primitives) {
    const x = Math.round(p.xMm * MM_TO_DOT)
    const y = Math.round(p.yMm * MM_TO_DOT)

    if (p.kind === 'barcode') {
      const barH = mmDot(p.heightMm)
      const hri = p.hri === false ? 'N' : 'Y'
      if (p.symbology === 'ean13') {
        // ^BE: o,h,f(HRI),g(above)
        body += `^FO${x},${y}^BY2^BEN,${barH},${hri},N^FD${p.value}^FS`
      } else {
        const by = calcBarcodeModuleWidth(p.value.length, Math.round(p.widthMm * MM_TO_DOT))
        body += `^FO${x},${y}^BY${by}^BCN,${barH},${hri},N,N^FD${p.value}^FS`
      }
    } else {
      const t = sanitizeZplValue(p.text)
      if (!t) continue
      const fh = mmDot(p.fontHeightMm)
      const elW = Math.round(p.widthMm * MM_TO_DOT)
      if (p.align === 'center') {
        body += `^FO${x},${y}^A0N,${fh},${fh}^FB${elW},1,0,C^FD${t}^FS`
      } else if (p.align === 'right') {
        body += `^FO${x},${y}^A0N,${fh},${fh}^FB${elW},1,0,R^FD${t}^FS`
      } else {
        body += `^FO${x},${y}^A0N,${fh},${fh}^FD${t}^FS`
      }
    }
  }
  body += '^XZ'
  return body
}

module.exports = {
  MM_TO_DOT,
  sanitizeZplValue,
  applyZplTemplate,
  calcBarcodeModuleWidth,
  mmDot,
  generateZplFromElements,
}
