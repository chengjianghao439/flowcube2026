/**
 * 统一条码解析系统
 *
 * 条码规则：
 *   Pxxxxxx / PRDxxxxxx      → type: 'product'    产品条码
 *   Ixxxxxx / CNTxxxxxx      → type: 'container'  库存条码
 *   Bxxxxxx                  → type: 'container'  塑料盒条码（预留兼容）
 *   Rxxxxxx / LOC-xxx...     → type: 'location'   货架条码
 *   Hxxxxxx / RCKxxxxxx      → type: 'rack'       货架条码
 *   Lxxxxxx / BOXxxxxxx      → type: 'box'        物流条码
 *   Wxxxxxx / WAVExxxxxx     → type: 'wave'       波次条码
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
  /** 从条码中提取的数字 ID（P000001 / PRD000001 → 1） */
  id?: number
  /** 条码字符串（等于 raw，方便解构使用） */
  code?: string
}

export function parseBarcode(raw: string): ParsedBarcode {
  const s = raw.trim()
  if (!s) return { raw: s, type: 'unknown', label: '空条码' }

  const prd = /^(?:P|PRD)(\d+)$/i.exec(s)
  if (prd) return { raw: s, type: 'product',   label: '产品条码',  id: parseInt(prd[1],   10), code: s }

  const cnt = /^(?:I|CNT)(\d+)$/i.exec(s)
  if (cnt) return { raw: s, type: 'container', label: '库存条码',  id: parseInt(cnt[1],   10), code: s }

  const boxBin = /^B(\d+)$/i.exec(s)
  if (boxBin) return { raw: s, type: 'container', label: '塑料盒条码', id: parseInt(boxBin[1], 10), code: s }

  const loc = /^R(\d+)$/i.exec(s)
  if (loc) return { raw: s, type: 'location',  label: '货架条码', id: parseInt(loc[1], 10), code: s }

  if (/^LOC[-A-Z0-9]+$/i.test(s))
         return { raw: s, type: 'location',  label: '货架条码',  code: s }

  const box = /^(?:L|BOX)(\d+)$/i.exec(s)
  if (box) return { raw: s, type: 'box',       label: '物流条码',  id: parseInt(box[1],   10), code: s }

  const rck = /^(?:H|RCK)(\d+)$/i.exec(s)
  if (rck) return { raw: s, type: 'rack',      label: '货架条码',  id: parseInt(rck[1],  10), code: s }

  const wave = /^(?:W|WAVE)(\d+)$/i.exec(s)
  if (wave) return { raw: s, type: 'wave',      label: '波次条码',  id: parseInt(wave[1],  10), code: s }

  return { raw: s, type: 'unknown', label: '未知条码' }
}

/** 生成物流条码（L + 8 位时间戳片段 + 2 位随机数） */
export function generateBoxBarcode(): string {
  const ts  = Date.now().toString().slice(-8)
  const rnd = Math.floor(Math.random() * 100).toString().padStart(2, '0')
  return `L${ts}${rnd}`
}
