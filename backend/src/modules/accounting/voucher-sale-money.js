const AppError = require('../../utils/AppError')

// 销售路径专用固定点工具。mysql2 的 DECIMAL 字符串不先转 Number，避免精度在解析时已丢失。
const MAX_VOUCHER_CENTS = 9999999999999999n // DECIMAL(16,2)
function decimalUnits(value, scale) {
  const text = String(value ?? '').trim()
  const match = /^\+?(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text)
  if (!match) throw new AppError('销售会计金额或数量必须是非负十进制数', 409, 'ACCT_SALE_DECIMAL_INVALID')
  const exponent = Number(match[3] || 0)
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) throw new AppError('销售会计金额或数量超出解析范围', 409, 'ACCT_SALE_DECIMAL_INVALID')
  const fraction = match[2] || ''
  const digits = BigInt(match[1] + fraction)
  const shift = scale + exponent - fraction.length
  if (shift >= 0) return digits * 10n ** BigInt(shift)
  const divisor = 10n ** BigInt(-shift)
  if (digits % divisor) throw new AppError(`销售会计金额或数量超过 ${scale} 位小数`, 409, 'ACCT_SALE_DECIMAL_INVALID')
  return digits / divisor
}

/** 非负整数分子/分母的四舍五入，恰好半分时进位。 */
function halfUp(numerator, denominator) {
  return (numerator * 2n + denominator) / (denominator * 2n)
}
function centsText(cents) {
  if (cents < 0n || cents > MAX_VOUCHER_CENTS) {
    throw new AppError('销售凭证金额超过 DECIMAL(16,2) 可记账范围', 409, 'ACCT_SALE_AMOUNT_OUT_OF_RANGE')
  }
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}
function normalizeSaleLegs(legs) {
  return legs.map(l => ({ ...l, amount: centsText(decimalUnits(l.amount, 2)) })).filter(l => l.amount !== '0.00')
}
function saleBalance(legs) {
  let debit = 0n, credit = 0n
  for (const l of legs) {
    const amount = decimalUnits(l.amount, 2)
    if (Number(l.direction) === 1) debit += amount
    else if (Number(l.direction) === 2) credit += amount
    else throw new AppError('销售凭证借贷方向无效', 409, 'ACCT_VOUCHER_UNBALANCED')
  }
  if (debit !== credit) throw new AppError('销售凭证借贷金额不平', 500, 'ACCT_VOUCHER_UNBALANCED')
  return { debit: centsText(debit), credit: centsText(credit) }
}
module.exports = { decimalUnits, halfUp, centsText, normalizeSaleLegs, saleBalance }
