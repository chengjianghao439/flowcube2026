import { describe, it, expect } from 'vitest'
import { beijingYmd, beijingPeriod, shiftYmd, todayYmd, defaultRangeYmds } from './dateTime'
import { formatDateInput, getRelativeDateRange, getMonthDateRange } from './dateRange'

/**
 * 日期窗口必须按**北京时区**计算（2026-09-18 收敛）。
 *
 * 背景：`dateRange.ts` 此前用 `getFullYear/getMonth/getDate` + `Date.setDate` 算「近 N 天」，
 * 那是宿主时区语义，在 UTC / 美西等非 +08 环境（容器、系统重装、出差改时区）下会偏一天，
 * 与本仓「业务日期唯一时区为北京时间」的约定冲突；`PaymentQueryDialog` 更是在同一个弹窗里
 * 默认窗口用北京（todayYmd）而「今天」按钮用宿主本地（自写的 todayStr），两个「今天」会不一致。
 *
 * 断言用**固定 UTC 时刻**表达北京边界，因此与运行机器的 TZ 无关地验证实现：
 * 本机 TZ=+08 时，"回退成宿主本地字段"仍会通过；**CI（ubuntu 默认 UTC）上会失败**——
 * 这正是防回退的判据，所以不要把这些断言改成用本地时间构造。
 */
describe('beijingYmd：任意时刻 → 北京日期', () => {
  it('跨过北京午夜（UTC 前一天 17:00Z 起算作北京次日）', () => {
    expect(beijingYmd(new Date('2026-09-18T15:59:00Z'))).toBe('2026-09-18') // 北京 23:59
    expect(beijingYmd(new Date('2026-09-18T16:00:00Z'))).toBe('2026-09-19') // 北京次日 00:00
    expect(beijingYmd(new Date('2026-09-18T17:30:00Z'))).toBe('2026-09-19') // 北京次日 01:30
  })

  it('跨月与跨年边界', () => {
    expect(beijingYmd(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01')
    expect(beijingYmd(new Date('2027-02-28T16:00:00Z'))).toBe('2027-03-01')
  })

  it('todayYmd 与 beijingYmd(now) 一致', () => {
    expect(todayYmd()).toBe(beijingYmd(new Date()))
  })
})

describe('shiftYmd：纯日期加减', () => {
  it('跨月/跨年不偏移', () => {
    expect(shiftYmd('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftYmd('2027-01-01', -1)).toBe('2026-12-31')
    expect(shiftYmd('2026-09-18', 0)).toBe('2026-09-18')
    expect(shiftYmd('2024-02-28', 1)).toBe('2024-02-29') // 闰年
  })

  it('拒绝非 YYYY-MM-DD 输入（不静默产出错日期）', () => {
    expect(() => shiftYmd('2026-9-18', -1)).toThrow()
    expect(() => shiftYmd('', -1)).toThrow()
  })
})

describe('筛选窗口按北京时区', () => {
  it('近 N 天窗口恰好 N 天且包含当天', () => {
    const { startDate, endDate } = getRelativeDateRange(7, new Date('2026-09-18T10:00:00Z'))
    expect(endDate).toBe('2026-09-18')
    expect(startDate).toBe('2026-09-12') // 含当天共 7 天
    const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000
    expect(days).toBe(6)
  })

  it('days=0 退化为当天（与原实现一致）', () => {
    const d = new Date('2026-09-18T10:00:00Z')
    expect(getRelativeDateRange(0, d)).toEqual({ startDate: '2026-09-18', endDate: '2026-09-18' })
  })

  it('跨北京午夜时 endDate 取北京日期而不是 UTC 日期', () => {
    // UTC 仍是 9-18，北京已是 9-19
    const { startDate, endDate } = getRelativeDateRange(2, new Date('2026-09-18T17:00:00Z'))
    expect(endDate).toBe('2026-09-19')
    expect(startDate).toBe('2026-09-18')
  })

  it('本月窗口从 1 号起、止于北京当天', () => {
    expect(getMonthDateRange(new Date('2026-09-18T10:00:00Z'))).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-09-18',
    })
    expect(getMonthDateRange(new Date('2026-09-30T17:00:00Z')).endDate).toBe('2026-10-01')
  })

  it('formatDateInput 与 beijingYmd 同源', () => {
    const d = new Date('2026-09-18T17:30:00Z')
    expect(formatDateInput(d)).toBe(beijingYmd(d))
    expect(formatDateInput(d)).toBe('2026-09-19')
  })

  it('defaultRangeYmds 仍是最近 N 天（含今天）', () => {
    const { start, end } = defaultRangeYmds(7)
    const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000
    expect(days).toBe(6)
    expect(end).toBe(todayYmd())
  })
})

describe('beijingPeriod：会计期间 YYYYMM 按北京时区', () => {
  it('跨北京午夜取北京月份（会计期间对时区最敏感）', () => {
    expect(beijingPeriod(new Date('2026-09-30T15:59:00Z'))).toBe('202609') // 北京 23:59
    expect(beijingPeriod(new Date('2026-09-30T16:00:00Z'))).toBe('202610') // 北京次日 00:00
    expect(beijingPeriod(new Date('2026-12-31T16:00:00Z'))).toBe('202701') // 跨年
  })

  it('月份补零', () => {
    expect(beijingPeriod(new Date('2026-03-15T04:00:00Z'))).toBe('202603')
  })
})
