import { beijingYmd, shiftYmd } from './dateTime'

/**
 * 相对日期窗口（近 N 天 / 本月）——筛选条件用，**一律按北京时区**。
 *
 * 2026-09-18 收敛：此前用 `getFullYear/getMonth/getDate` + `Date.setDate` 计算，
 * 那是宿主时区语义；在 UTC / 美西等非 +08 环境（容器、系统重装、出差改时区）下，
 * 「近 7 天」会比北京日期偏一天，与本仓「业务日期唯一时区为北京时间」的约定冲突。
 * 现在统一走 `lib/dateTime.ts` 的北京原语（那里是全站唯一时间入口）。
 */

/** 按北京时区把 Date 格式化为 YYYY-MM-DD */
export function formatDateInput(value: Date): string {
  return beijingYmd(value)
}

export function getRelativeDateRange(days: number, end: Date = new Date()): { startDate: string; endDate: string } {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 1
  const endDate = beijingYmd(end)
  return { startDate: shiftYmd(endDate, -(safeDays - 1)), endDate }
}

export function getMonthDateRange(date: Date = new Date()): { startDate: string; endDate: string } {
  const endDate = beijingYmd(date)
  return { startDate: `${endDate.slice(0, 7)}-01`, endDate }
}
