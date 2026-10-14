'use strict'

// Actual money is integer cents. Prices, quantities, costs and old DECIMAL4
// storage retain their own precision; this module never rewrites stored facts.
const AppError = require('./AppError')
const { moneyUnits } = require('./decimalMoney')
const { decimalUnits, halfUp } = require('../modules/accounting/voucher-sale-money')

function cashCents(value, { stored = false, label = '金额' } = {}) {
  try {
    const units = moneyUnits(value)
    if (units % 100n) throw Error('not integer cents')
    return units / 100n
  } catch (_error) {
    if (stored) throw new AppError(`${label}含历史非分金额，请核对原账，不能自动舍入`, 409, 'CASH_LEGACY_PRECISION_REVIEW_REQUIRED', { field: label, rawAmount: String(value) })
    throw new AppError(`${label}最多支持两位小数（分），请核对实际金额`, 400, 'CASH_PRECISION_INVALID')
  }
}
function storedCashCents(value, label = '原金额') { return cashCents(value, { stored: true, label }) }
function cashText(cents) {
  const abs = cents < 0n ? -cents : cents
  return `${cents < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}
function cashNumber(cents) {
  const value = Number(cashText(cents))
  if (!Number.isFinite(value) || cashCents(value) !== cents) {
    throw new AppError('实际金额超出可准确传输的分值范围', 400, 'CASH_AMOUNT_OUT_OF_RANGE')
  }
  return value
}
function cashStorageText(value, options) { return cashText(cashCents(value, options)) }
function roundCashCents(value) {
  const units = decimalUnits(value, 10)
  return halfUp(units, 100000000n)
}
function productCents(quantity, price) {
  return halfUp(decimalUnits(quantity, 2) * decimalUnits(price, 8), 100000000n)
}
function ratioCents(totalCents, numerator, denominator, { floor = false } = {}) {
  if (totalCents < 0n || numerator < 0n || denominator <= 0n || numerator > denominator) {
    throw new AppError('原金额分配依据不完整，请核对', 409, 'CASH_BASIS_REQUIRED')
  }
  return floor ? totalCents * numerator / denominator : halfUp(totalCents * numerator, denominator)
}
function sumCashCents(values, options) { return values.reduce((sum, value) => sum + cashCents(value, options), 0n) }
function gcd(a,b) { while(b) { const next=a%b; a=b; b=next } return a<0n?-a:a }
function fraction(n=0n,d=1n) {
  if(n<0n||d<=0n)throw new AppError('原金额比例无效，请核对',409,'CASH_BASIS_REQUIRED')
  const divisor=gcd(n,d);return {n:n/divisor,d:d/divisor}
}
function addFraction(a,b) { return fraction(a.n*b.d+b.n*a.d,a.d*b.d) }
function lineContribution(amountCents,quantity,originalQuantity) {
  if(quantity<0n||quantity>originalQuantity||originalQuantity<=0n)throw new AppError('原行数量比例无效，请核对',409,'CASH_BASIS_REQUIRED')
  return fraction(amountCents*quantity,originalQuantity)
}
function netShareCents(net,gross,share,{floor=false}={}) {
  if(net<0n||gross<0n||net>gross||share.n>gross*share.d)throw new AppError('原净额比例超出原预算，请核对',409,'CASH_BASIS_REQUIRED')
  if(gross===0n)return 0n
  return floor?net*share.n/(gross*share.d):halfUp(net*share.n,gross*share.d)
}
module.exports = { cashCents, storedCashCents, cashText, cashNumber, cashStorageText, roundCashCents, productCents, ratioCents, sumCashCents, fraction,addFraction,lineContribution,netShareCents }
