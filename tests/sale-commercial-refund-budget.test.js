'use strict'
const assert=require('node:assert/strict'),{test}=require('node:test')
const {refundEstimateUpperBound}=require('../backend/src/modules/sale/sale.commercial-refund-budget')
test('one cent across three pieces reserves a cent even when standalone rounded estimate is zero',()=>{
 assert.equal(refundEstimateUpperBound({sourceAmount:'0.01',sourceQty:3,quantity:1}),0.01)
 assert.equal(refundEstimateUpperBound({sourceAmount:'0.01',sourceQty:3,quantity:2}),0.01)
 assert.equal(refundEstimateUpperBound({sourceAmount:'80.00',sourceQty:3,quantity:1}),26.67)
 assert.equal(refundEstimateUpperBound({sourceAmount:'0.00',sourceQty:3,quantity:1}),0)
})
