'use strict'
// Real financial amounts use cents; immutable component gross/price math keeps
// its original independent contract. Legacy stored fractional actuals review.
const AppError=require('../../utils/AppError')
const {storedCashCents,cashNumber,ratioCents}=require('../../utils/cashMoney')
const {decimalUnits,halfUp}=require('../accounting/voucher-sale-money')
function financialTarget({orderGross,discount},gross){
  const g=storedCashCents(orderGross,'原套单总额'),d=storedCashCents(discount,'原套单折扣'),amount=storedCashCents(gross,'已确认或已退套单毛额')
  if(g<0n||d<0n||d>g||amount<0n||amount>g)throw new AppError('原出库批次的分位折扣依据或退货额不完整',409,'SALE_COMMERCIAL_SOURCE_INVALID')
  return g===0n?0n:ratioCents(g-d,amount,g)
}
function financialRefundDelta(basis,beforeGross,afterGross,actualPrior=null){
  const before=financialTarget(basis,beforeGross),after=financialTarget(basis,afterGross)
  if(after<before)throw new AppError('本次套单退货毛额不能回退',409,'SALE_COMMERCIAL_SOURCE_INVALID')
  const prior=actualPrior==null?before:storedCashCents(actualPrior,'套单前序实际净退款')
  if(prior!==before)throw new AppError('套单前序实际退款与原成交分预算不一致，请核对原账',409,'CASH_LEGACY_PRECISION_REVIEW_REQUIRED')
  return cashNumber(after-prior)
}
function financialRefundEstimate({orderGross,discount},grossUpper){
  const g=storedCashCents(orderGross,'原套单总额'),d=storedCashCents(discount,'原套单折扣'),a=storedCashCents(grossUpper,'套单退货毛额上界')
  financialTarget({orderGross,discount},grossUpper)
  return cashNumber(g===0n?0n:((g-d)*a+g-1n)/g)
}
// Read-only legacy source estimate, preserving original four-place facts.
function legacyFinancialRefundEstimate({orderGross,discount},grossUpper){
  const g=decimalUnits(orderGross,4),d=decimalUnits(discount,4),a=decimalUnits(grossUpper,4)
  if(g<0n||d<0n||d>g||a<0n||a>g)throw new AppError('原套单估算依据不完整',409,'SALE_COMMERCIAL_SOURCE_INVALID')
  return g===0n?0:Number(((g-d)*a+g-1n)/g)/10000
}
function assertLegacyCut(basis,gross){
  const g=storedCashCents(basis.orderGross),d=storedCashCents(basis.discount),e=storedCashCents(gross)
  const legacyDiscount=g===0n?0n:halfUp(d*100n*e,g)
  const legacy=halfUp(e*100n-legacyDiscount,100n)
  if(legacy!==financialTarget(basis,gross))throw new AppError('旧套单分批会计投影与新分预算不同，请核对原期间',409,'CASH_LEGACY_PRECISION_REVIEW_REQUIRED')
}
module.exports={financialTarget,financialRefundDelta,financialRefundEstimate,legacyFinancialRefundEstimate,assertLegacyCut}
