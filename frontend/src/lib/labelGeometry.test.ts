import { describe, it, expect } from 'vitest'
import {
  resolveLabelWidthMm,
  resolveLabelHeightMm,
  normalizeElement,
  normalizeLabelLayout,
  resolveLayout,
  PT_TO_MM,
} from './labelGeometry'

/**
 * 前端标签几何单元测试（审计 4.3 起步）。
 *
 * 跨端一致性由 tests/fixtures/label-geometry-cases.json 快照锁定（后端 test:label 跑），
 * 本文件补语义断言，锁住"几何规则本身"：
 *   1. 纸张尺寸推断（thermal58/75/80）
 *   2. canvas 显式值优先
 *   3. 旧结构迁移（fontSize pt → mm、剔除 divider）
 *   4. barcode 图元键集与默认参数
 */

describe('resolveLabelWidthMm', () => {
  it('canvasWidthMm 有效时优先（30-120 范围）', () => {
    expect(resolveLabelWidthMm({ canvasWidthMm: 60 }, 'thermal75')).toBe(60)
    expect(resolveLabelWidthMm({ canvasWidthMm: 120 }, 'thermal75')).toBe(120)
  })

  it('canvas 值非法时按纸张尺寸推断', () => {
    expect(resolveLabelWidthMm({ canvasWidthMm: 10 }, 'thermal75')).toBe(75) // 低于 30 非法
    expect(resolveLabelWidthMm({ canvasWidthMm: 500 }, 'thermal58')).toBe(58) // 高于 120 非法
    expect(resolveLabelWidthMm({}, 'thermal58')).toBe(58)
    expect(resolveLabelWidthMm({}, 'thermal75')).toBe(75)
    expect(resolveLabelWidthMm({}, 'unknown-size')).toBe(80) // 未知纸张 → 默认 80
  })
})

describe('resolveLabelHeightMm', () => {
  it('canvasHeightMm 有效时优先，否则默认 50', () => {
    expect(resolveLabelHeightMm({ canvasHeightMm: 40 })).toBe(40)
    expect(resolveLabelHeightMm({ canvasHeightMm: 300 })).toBe(300)
    expect(resolveLabelHeightMm({})).toBe(50)
    expect(resolveLabelHeightMm({ canvasHeightMm: 0 })).toBe(50) // 非法
    expect(resolveLabelHeightMm({ canvasHeightMm: 999 })).toBe(50) // 超上限
  })
})

describe('normalizeElement（旧结构迁移）', () => {
  it('divider 被剔除', () => {
    expect(normalizeElement({ type: 'divider' })).toBeNull()
  })

  it('fontSize(pt) 迁移为 fontHeightMm，保留两位', () => {
    const el = normalizeElement({ type: 'text', fontSize: 10, fieldKey: 'x', label: 'X' })
    expect(el).not.toBeNull()
    const expectMm = Math.round(10 * PT_TO_MM * 100) / 100
    expect(el!.fontHeightMm).toBe(expectMm)
  })

  it('已显式 fontHeightMm 时保留不动', () => {
    const el = normalizeElement({ type: 'text', fontHeightMm: 3, fieldKey: 'x' })
    expect(el!.fontHeightMm).toBe(3)
  })

  it('showLabel 缺省 false', () => {
    const el = normalizeElement({ type: 'text', fieldKey: 'x' })
    expect(el!.showLabel).toBe(false)
  })
})

describe('normalizeLabelLayout', () => {
  it('format=zpl 返回 null（不归几何层）', () => {
    expect(normalizeLabelLayout({ format: 'zpl', body: '^XA^XZ' }, 'thermal80')).toBeNull()
  })

  it('剔除 divider 元素，只保留 text/barcode', () => {
    const layout = {
      elements: [
        { type: 'barcode', fieldKey: 'code', x: 2, y: 2, width: 60, height: 12, fontSize: 10 },
        { type: 'text', fieldKey: 'name', x: 2, y: 20, width: 60, height: 6, fontSize: 9 },
        { type: 'divider', x: 2, y: 30, width: 60, height: 4 },
      ],
    }
    const normalized = normalizeLabelLayout(layout, 'thermal75')
    expect(normalized).not.toBeNull()
    expect(normalized!.elements.map((e) => e.type)).toEqual(['barcode', 'text'])
  })
})

describe('resolveLayout（图元产出）', () => {
  it('barcode 图元键集精确（含 symbology/hri，无 fontHeightMm/align/text）', () => {
    const layout = normalizeLabelLayout({
      elements: [{ type: 'barcode', fieldKey: 'code', label: '条码', x: 2, y: 2, width: 56, height: 10, fontSize: 10 }],
      canvasWidthMm: 60,
      canvasHeightMm: 40,
    }, 'thermal80')!
    const resolved = resolveLayout(layout, { code: 'ABC123' }, 'thermal80')
    expect(resolved.widthMm).toBe(60)
    expect(resolved.heightMm).toBe(40)
    const bc = resolved.primitives.find((p) => p.kind === 'barcode')!
    expect(Object.keys(bc).sort()).toEqual(['heightMm', 'hri', 'kind', 'symbology', 'value', 'widthMm', 'xMm', 'yMm'])
    expect(bc.symbology).toBe('code128')
    expect(bc.hri).toBe(true)
  })

  it('text 图元键集精确（含 fontHeightMm/align/text）', () => {
    const layout = normalizeLabelLayout({
      elements: [{ type: 'text', fieldKey: 'name', label: '名称', showLabel: true, x: 2, y: 10, width: 30, height: 6, fontSize: 9 }],
      canvasWidthMm: 60,
    }, 'thermal80')!
    const resolved = resolveLayout(layout, { name: '产品A' }, 'thermal80')
    const t = resolved.primitives.find((p) => p.kind === 'text')!
    expect(Object.keys(t).sort()).toEqual(['align', 'fontHeightMm', 'heightMm', 'kind', 'text', 'widthMm', 'xMm', 'yMm'])
    expect(t.text).toBe('名称：产品A') // showLabel=true 拼接
  })

  it('条码清洗 ^ ~ 换行', () => {
    const layout = normalizeLabelLayout({
      elements: [{ type: 'barcode', fieldKey: 'code', x: 2, y: 2, width: 56, height: 10 }],
      canvasWidthMm: 60,
    }, 'thermal80')!
    const resolved = resolveLayout(layout, { code: 'ABC^123\n' }, 'thermal80')
    const bc = resolved.primitives.find((p) => p.kind === 'barcode')!
    expect(bc.value).toBe('ABC123')
  })
})
