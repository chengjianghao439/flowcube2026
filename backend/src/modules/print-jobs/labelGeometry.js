/**
 * 标签统一几何层（零依赖纯函数）。
 *
 * 设计目标：消除「预览 / 真机 ZPL」两套几何不一致。
 * 几何只算一次 —— resolveLayout 把 layout_json + 数据 解析成中性「绘制图元」(DrawPrimitive)，
 * 坐标/尺寸/字高全部用 mm 表达；前端预览 ×MM_PX、后端 ZPL ×MM_TO_DOT 各自映射。
 *
 * 本文件是「单一事实源」。前端镜像 frontend/src/lib/labelGeometry.ts 必须与本文件
 * 行为一致，由 tests/fixtures/label-geometry-cases.json 快照锁定（两端跑同一组样例）。
 *
 * @typedef {Object} LabelElement v2 元素
 * @property {string} id
 * @property {'text'|'title'|'barcode'} type
 * @property {string} fieldKey
 * @property {string} label
 * @property {boolean} showLabel   是否拼 "label：" 前缀
 * @property {number} x  mm
 * @property {number} y  mm
 * @property {number} width  mm
 * @property {number} height mm
 * @property {number} fontHeightMm 字高 mm（替代旧 fontSize pt）
 * @property {'left'|'center'|'right'} textAlign
 *
 * @typedef {Object} DrawPrimitive 中性绘制图元（mm 单位）
 * @property {'text'|'barcode'} kind
 * @property {number} xMm
 * @property {number} yMm
 * @property {number} widthMm
 * @property {number} heightMm
 * @property {string} text      kind=text 时的最终文本（已含 showLabel 拼接）
 * @property {number} fontHeightMm kind=text 时的字高
 * @property {'left'|'center'|'right'} align kind=text 时的对齐
 * @property {string} value     kind=barcode 时的条码内容
 */

'use strict'

/** pt → mm（1pt = 1/72 inch）。旧模板 fontSize(pt) 迁移用 */
const PT_TO_MM = 25.4 / 72

/** v2 仅支持这三种元素；divider/table 属单据画布模板，标签真机不画，normalize 阶段剔除 */
const LABEL_ELEMENT_TYPES = ['text', 'title', 'barcode']

function num(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** 标签纸宽（mm）：canvasWidthMm 优先（30–120 合法），否则按纸张推断 */
function resolveLabelWidthMm(layout, paperSize) {
  const n = Number(layout?.canvasWidthMm)
  if (Number.isFinite(n) && n >= 30 && n <= 120) return Math.round(n)
  if (paperSize === 'thermal58') return 58
  if (paperSize === 'thermal75') return 75
  return 80
}

/** 标签纸高（mm）：canvasHeightMm 优先，否则默认 50（常见 75×50 标签） */
function resolveLabelHeightMm(layout) {
  const n = Number(layout?.canvasHeightMm)
  if (Number.isFinite(n) && n > 0 && n <= 300) return Math.round(n)
  return 50
}

/**
 * 把任意历史/新结构的画布元素归一化为 v2 元素。
 * - 剔除 divider / table（标签不支持）
 * - fontSize(pt) → fontHeightMm（已是 fontHeightMm 则保留）
 * - 丢弃 fontWeight（去加粗）/ border / tableColumns
 * - showLabel 缺省 false（与真机一致：默认不显前缀）
 * @returns {LabelElement|null} 非法元素返回 null
 */
function normalizeElement(raw) {
  if (!raw || typeof raw !== 'object') return null
  const type = raw.type === 'title' ? 'title' : raw.type === 'barcode' ? 'barcode' : raw.type === 'text' ? 'text' : null
  if (!type) return null // divider/table/未知 → 剔除

  let fontHeightMm = Number(raw.fontHeightMm)
  if (!Number.isFinite(fontHeightMm) || fontHeightMm <= 0) {
    // 旧结构：fontSize 是 pt
    fontHeightMm = Math.round(num(raw.fontSize, 10) * PT_TO_MM * 100) / 100
  }

  const el = {
    id: String(raw.id ?? ''),
    type,
    fieldKey: String(raw.fieldKey ?? ''),
    label: String(raw.label ?? ''),
    showLabel: raw.showLabel === true,
    x: num(raw.x),
    y: num(raw.y),
    width: num(raw.width),
    height: num(raw.height),
    fontHeightMm,
    textAlign: raw.textAlign === 'center' ? 'center' : raw.textAlign === 'right' ? 'right' : 'left',
  }
  if (type === 'barcode') {
    // 条码参数：码制 + 是否显示可读数字(HRI)，默认 code128 + 显示
    el.symbology = raw.barcodeSymbology === 'ean13' ? 'ean13' : 'code128'
    el.hri = raw.barcodeHRI !== false
  }
  return el
}

/**
 * 归一化整个 layout 为 v2。
 * format=zpl 的裸 body 模板不归此处管（返回 null，由调用方走 applyZplTemplate）。
 * @returns {{version:2, canvasWidthMm:number, canvasHeightMm:number, elements:LabelElement[]}|null}
 */
function normalizeLabelLayout(layout, paperSize) {
  if (!layout || typeof layout !== 'object') return null
  if (layout.format === 'zpl') return null
  if (!Array.isArray(layout.elements)) return null

  const elements = layout.elements.map(normalizeElement).filter(Boolean)
  return {
    version: 2,
    canvasWidthMm: resolveLabelWidthMm(layout, paperSize),
    canvasHeightMm: resolveLabelHeightMm(layout),
    elements,
  }
}

/** 解析单个元素的最终文本（含 showLabel 前缀规则） */
function resolveText(el, data) {
  const raw = data?.[el.fieldKey]
  const value = raw == null ? '' : String(raw)
  if (el.type === 'title') {
    // 标题：有值用值，否则用 label 作为固定标题文案
    return value || el.label
  }
  // text：showLabel 时拼 "label：value"
  if (el.showLabel && el.label) return `${el.label}：${value}`
  return value
}

/**
 * 核心：layout_json + 数据 → 中性绘制图元。
 * 排序按 y 再 x（与历史 ZPL 顺序一致，稳定）。空文本/空条码跳过。
 * @param {object} rawLayout layout_json（已 parse 的对象）
 * @param {Record<string, string|number|null|undefined>} data 打印变量
 * @param {string} paperSize thermal80 | thermal75 | thermal58
 * @returns {{widthMm:number, heightMm:number, primitives:DrawPrimitive[]}}
 */
function resolveLayout(rawLayout, data, paperSize) {
  const layout = normalizeLabelLayout(rawLayout, paperSize)
  if (!layout) return { widthMm: resolveLabelWidthMm(rawLayout, paperSize), heightMm: resolveLabelHeightMm(rawLayout), primitives: [] }

  const sorted = [...layout.elements].sort((a, b) => (a.y - b.y) || (a.x - b.x))
  const primitives = []
  for (const el of sorted) {
    if (el.type === 'barcode') {
      const value = String(data?.[el.fieldKey] ?? '').replace(/[\r\n^~]/g, '')
      if (!value) continue
      primitives.push({
        kind: 'barcode',
        xMm: el.x, yMm: el.y, widthMm: el.width, heightMm: el.height,
        value,
        symbology: el.symbology === 'ean13' ? 'ean13' : 'code128',
        hri: el.hri !== false,
      })
    } else {
      const text = resolveText(el, data)
      if (!text) continue
      primitives.push({
        kind: 'text',
        xMm: el.x, yMm: el.y, widthMm: el.width, heightMm: el.height,
        text,
        fontHeightMm: el.fontHeightMm,
        align: el.textAlign,
      })
    }
  }
  return { widthMm: layout.canvasWidthMm, heightMm: layout.canvasHeightMm, primitives }
}

module.exports = {
  PT_TO_MM,
  LABEL_ELEMENT_TYPES,
  normalizeElement,
  normalizeLabelLayout,
  resolveLayout,
  resolveLabelWidthMm,
  resolveLabelHeightMm,
}
