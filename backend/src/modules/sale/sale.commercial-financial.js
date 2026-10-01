'use strict'
// Reverse the existing whole-order proportional discount at four-place AR
// precision. This is separate from immutable two-place component gross refunds.
const {calculateDiscountApplied}=require('./sale.contracts')
const AppError=require('../../utils/AppError')
function financialRefundDelta({orderGross,discount},beforeGross,afterGross){
  if(!(Number(orderGross)>0)||!Number.isFinite(Number(discount))||beforeGross<0||afterGross<beforeGross||afterGross>Number(orderGross))throw new AppError('原出库批次的折扣依据或退货金额不完整',409,'SALE_COMMERCIAL_SOURCE_INVALID')
  const before=calculateDiscountApplied({discount,shippedGross:beforeGross,orderGross})
  const after=calculateDiscountApplied({discount,shippedGross:afterGross,orderGross})
  return Math.round(((afterGross-beforeGross)-(after-before))*10000)/10000
}
function financialRefundEstimate({orderGross,discount},grossUpper){
  financialRefundDelta({orderGross,discount},0,Math.min(grossUpper,Number(orderGross)))
  const grossCents=BigInt(Math.round(Number(orderGross)*100)),discountUnits=BigInt(Math.round(Number(discount)*10000)),upperUnits=BigInt(Math.round(grossUpper*10000))
  const denominator=grossCents*100n,numerator=upperUnits*(denominator-discountUnits)
  return Number((numerator+denominator-1n)/denominator)/10000
}
module.exports={financialRefundDelta,financialRefundEstimate}
