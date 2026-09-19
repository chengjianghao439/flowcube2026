import { describe, it, expect } from 'vitest'
import { TOP_SERIES_LIMIT, limitTopSeries } from './topSeries'

/**
 * 分布类图表的系列上限（2026-09-19）。
 *
 * 背景：财务看板「账户余额分布」饼图此前直接把 `data.accounts` 全量喂给 `<Pie>`，而
 * `PIE_COLORS` 只有 8 色——开发库 94 个启用账户时颜色重复 12 轮，切片无法区分；同页的
 * `ChartWidgets` 早已取 Top 8 + 「其他 N 个账户」。这里守住合并逻辑本身：
 * 上限、降序、合计守恒、聚合项名称与占比，以及**不得就地修改入参数组**
 *（入参来自 React Query 缓存，就地 sort 会污染缓存）。
 */

type Account = { id: number; name: string; balance: number; share: number }

const makeRest = (rest: readonly Account[], restValue: number): Account => ({
  id: -1,
  name: `其他 ${rest.length} 个账户`,
  balance: restValue,
  share: rest.reduce((sum, a) => sum + a.share, 0),
})

const accounts = (n: number): Account[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `账户${i + 1}`,
    balance: (i + 1) * 100,
    share: 1 / n,
  }))

describe('limitTopSeries', () => {
  it('上限常量固定为 8（调色板 PIE_COLORS 的长度）', () => {
    expect(TOP_SERIES_LIMIT).toBe(8)
  })

  it('不超过上限时只排序，不追加「其他」项', () => {
    const rows = limitTopSeries(accounts(8), { value: a => a.balance, makeRest })
    expect(rows).toHaveLength(8)
    expect(rows.every(a => a.id > 0)).toBe(true)
    expect(rows.map(a => a.balance)).toEqual([800, 700, 600, 500, 400, 300, 200, 100])
  })

  it('超出上限时取 Top 8 并把其余合并为一项（94 → 9）', () => {
    const rows = limitTopSeries(accounts(94), { value: a => a.balance, makeRest })
    expect(rows).toHaveLength(TOP_SERIES_LIMIT + 1)
    expect(rows.slice(0, 8).map(a => a.id)).toEqual([94, 93, 92, 91, 90, 89, 88, 87])
    expect(rows[8].name).toBe('其他 86 个账户')
    expect(rows[8].id).toBe(-1)
  })

  it('（head，其他）合计守恒等于入参合计', () => {
    const all = accounts(94)
    const rows = limitTopSeries(all, { value: a => a.balance, makeRest })
    const sum = (xs: Account[]) => xs.reduce((s, a) => s + a.balance, 0)
    expect(sum(rows)).toBe(sum(all))
    const total = 100 * ((94 * 95) / 2) // 94 项合计 446500
    const top8 = 100 * (((87 + 94) * 8) / 2) // Top 8 是余额最高的 94..87，合计 72400
    expect(rows[8].balance).toBe(total - top8)
  })

  it('聚合项能看到被合并的原始项，可据此守恒派生字段（占比）', () => {
    const all = accounts(9)
    const rows = limitTopSeries(all, { value: a => a.balance, makeRest })
    expect(rows[8].share).toBeCloseTo(1 / 9, 10)
    expect(rows.reduce((s, a) => s + a.share, 0)).toBeCloseTo(1, 10)
  })

  it('不就地修改入参（入参是 React Query 缓存数据）', () => {
    const all = accounts(10)
    const before = all.map(a => a.id)
    limitTopSeries(all, { value: a => a.balance, makeRest })
    expect(all.map(a => a.id)).toEqual(before)
  })

  it('边界与退化输入：0 / 1 / 9 项', () => {
    expect(limitTopSeries([], { value: (a: Account) => a.balance, makeRest })).toEqual([])
    expect(limitTopSeries(accounts(1), { value: a => a.balance, makeRest })).toHaveLength(1)
    const nine = limitTopSeries(accounts(9), { value: a => a.balance, makeRest })
    expect(nine).toHaveLength(9)
    expect(nine[8].name).toBe('其他 1 个账户')
  })

  it('数值相等时保持原顺序（稳定排序，不因合并打乱同值项）', () => {
    const ties: Account[] = [
      { id: 1, name: 'A', balance: 100, share: 0 },
      { id: 2, name: 'B', balance: 100, share: 0 },
      { id: 3, name: 'C', balance: 100, share: 0 },
    ]
    expect(limitTopSeries(ties, { value: a => a.balance, makeRest }).map(a => a.id)).toEqual([1, 2, 3])
  })
})
