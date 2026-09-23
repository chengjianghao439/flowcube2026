const AppError = require('./AppError')

// 金额计算保留 DECIMAL 字符串，直到 API 边界才转 Number；1 单位 = 0.0001 元。
function moneyUnits(value) {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(value ?? '').trim())
  if (!match) throw new AppError('金额必须是有效十进制数', 400, 'MONEY_PRECISION_INVALID')
  const exponent = Number(match[4] || 0), fraction = match[3] || ''
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100 || match[2].length + fraction.length > 100) {
    throw new AppError('金额超出可计算范围', 400, 'MONEY_PRECISION_INVALID')
  }
  const digits = BigInt(match[2] + fraction), shift = 4 + exponent - fraction.length
  let units
  if (shift >= 0) units = digits * 10n ** BigInt(shift)
  else {
    const divisor = 10n ** BigInt(-shift)
    if (digits % divisor) throw new AppError('金额最多支持四位小数', 400, 'MONEY_PRECISION_INVALID')
    units = digits / divisor
  }
  return match[1] === '-' ? -units : units
}
function moneyText(units) {
  const abs = units < 0n ? -units : units
  return `${units < 0n ? '-' : ''}${abs / 10000n}.${String(abs % 10000n).padStart(4, '0')}`
}
const moneyNumber = units => Number(moneyText(units))
module.exports = { moneyUnits, moneyText, moneyNumber }
