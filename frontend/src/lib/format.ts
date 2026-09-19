/**
 * 金额与数量的统一格式化。
 *
 * 2026-09-19 收敛：此前全仓有 20 处各自定义的 `money()` / `fmtMoney()`，至少 5 种写法——
 * 11 处不带千分位（大额金额读不出来）、`payments/party-ledger` 连 `¥` 都没有且是 4 位小数、
 * 空值有的显示 `¥0.00` 有的显示 `—`。后果是同一笔金额在 `finance/expenses` 与
 * `finance/dashboard` 会显示成两个样子。
 *
 * 两个函数的区别是**货币符号**，不是风格：
 *  - `money()` 带 `¥`，用于业务与财务页面（对账、账户、报表、台账…）。
 *  - `amount()` 不带符号，用于**会计凭证**的借贷方金额——凭证按标准格式列示，
 *    金额栏保持纯数字（`accounting/vouchers` 原本就是全文件不带 `¥`，属刻意约定）。
 *
 * 空值与非有限数一律 `—`，不要用 `Number(n ?? 0)` 把它伪装成 0
 * （那会让「没有数据」和「金额为零」看起来一样）。
 */

function formatNumber(value: number | null | undefined): string | null {
  if (value == null) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 金额：`¥1,234,567.00`、负数 `¥-20.00`；null / undefined / NaN → `—` */
export function money(value: number | null | undefined): string {
  const text = formatNumber(value)
  return text == null ? '—' : `¥${text}`
}

/** 金额数值（无货币符号）：`1,234,567.00`；会计凭证借贷方金额用 */
export function amount(value: number | null | undefined): string {
  return formatNumber(value) ?? '—'
}
