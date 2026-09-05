// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { WIDGETS, buildAllLayout, mergeLayout, DASHBOARD_SECTIONS } from './registry'

describe('全部仪表盘布局', () => {
  it('包含全部注册卡片且每张只出现一次', () => {
    const layout = buildAllLayout()
    expect(layout.widgets).toHaveLength(WIDGETS.length)
    expect(new Set(layout.widgets.map(w => w.id)).size).toBe(WIDGETS.length)
    expect(layout.widgets.every(w => w.visible && w.w >= 1 && w.w <= 4)).toBe(true)
  })
  it('全部展示及随后隐藏一张卡片的布局不会被旧趣味卡片标记重置', () => {
    const all = buildAllLayout()
    expect(mergeLayout(all)).toEqual(all)
    const custom = { widgets: all.widgets.map(w => w.id === 'kpi-receivable' ? { ...w, visible: false, w: 3 } : w) }
    expect(mergeLayout(custom)).toEqual(custom)
  })
  it('业务分区完整覆盖全部注册卡片且没有重复', () => {
    const ids = DASHBOARD_SECTIONS.flatMap(s => s.widgetIds)
    expect([...ids].sort()).toEqual(WIDGETS.map(w => w.id).sort())
    expect(new Set(ids).size).toBe(ids.length)
  })
})
