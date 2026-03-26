/**
 * 统一条码解析系统
 *
 * 条码规则：
 *   PRDxxxxxx   → type: 'product'    商品条码
 *   CNTxxxxxx   → type: 'container'  容器条码
 *   LOC-xxx...  → type: 'location'   库位条码
 *   BOXxxxxxx   → type: 'box'        箱号条码
 *   RCKxxxxxx   → type: 'rack'      货架条码
 *   WAVExxxxxx  → type: 'wave'       波次条码
 *   其他        → type: 'unknown'
 */

export type BarcodeType =
  | 'product'
  | 'container'
  | 'location'
  | 'box'
  | 'rack'
  | 'wave'
  | 'unknown'

export interface ParsedBarcode {
  /** 原始扫描字符串 */
  raw: string
  /** 条码类型 */
  type: BarcodeType
  /** 简要描述，用于 UI 提示 */
  label: string
  /** 从条码中提取的数字 ID（PRD000001 → 1） */
  id?: number
  /** 条码字符串（等于 raw，方便解构使用） */
  code?: string
}

export function parseBarcode(raw: string): ParsedBarcode {
  const s = raw.trim()
  if (!s) return { raw: s, type: 'unknown', label: '空条码' }

  const prd = /^PRD(\d+)$/i.exec(s)
  if (prd) return { raw: s, type: 'product',   label: '商品条码',  id: parseInt(prd[1],   10), code: s }

  const cnt = /^CNT(\d+)$/i.exec(s)
  if (cnt) return { raw: s, type: 'container', label: '容器条码',  id: parseInt(cnt[1],   10), code: s }

  if (/^LOC[-A-Z0-9]+$/i.test(s))
         return { raw: s, type: 'location',  label: '库位条码',  code: s }

  const box = /^BOX(\d+)$/i.exec(s)
  if (box) return { raw: s, type: 'box',       label: '箱号条码',  id: parseInt(box[1],   10), code: s }

  const rck = /^RCK(\d+)$/i.exec(s)
  if (rck) return { raw: s, type: 'rack',      label: '货架条码',  id: parseInt(rck[1],  10), code: s }

  const wave = /^WAVE(\d+)$/i.exec(s)
  if (wave) return { raw: s, type: 'wave',      label: '波次条码',  id: parseInt(wave[1],  10), code: s }

  return { raw: s, type: 'unknown', label: '未知条码' }
}

/** 生成箱号（BOX + 6 位 ID 或时间戳） */
export function generateBoxBarcode(): string {
  const ts  = Date.now().toString().slice(-8)
  const rnd = Math.floor(Math.random() * 100).toString().padStart(2, '0')
  return `BOX${ts}${rnd}`
}
