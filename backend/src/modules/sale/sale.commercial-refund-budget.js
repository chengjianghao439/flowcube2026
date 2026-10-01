'use strict'
const {decimalUnits}=require('../accounting/voucher-sale-money')
const {projectCommercialRefund}=require('./sale.commercial-money.math')

// Draft/confirmation ceiling, never an executed refund. A cumulative rounded
// difference can exceed the independently rounded fraction by one cent.
function refundEstimateUpperBound({sourceAmount,sourceQty,quantity}) {
  projectCommercialRefund({sourceAmount,sourceQty,beforeQualifiedQty:0,afterQualifiedQty:quantity})
  const budget=decimalUnits(sourceAmount,2),denominator=decimalUnits(sourceQty,2),qty=decimalUnits(quantity,2)
  return Number((budget*qty+denominator-1n)/denominator)/100
}
module.exports={refundEstimateUpperBound}
