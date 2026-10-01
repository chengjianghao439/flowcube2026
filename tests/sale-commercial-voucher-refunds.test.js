'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const {projectCommercialReturnVoucherAmounts}=require('../backend/src/modules/accounting/voucher-sale-returns')
test('two four-place .005 actual refunds reverse original cent once in execution order',()=>{
 const result=projectCommercialReturnVoucherAmounts([{id:2,order_id:1,return_id:20,financial_amount:'0.0050'},{id:1,order_id:1,return_id:30,financial_amount:'0.0050'}])
 assert.equal(result.get(30),'0.01');assert.equal(result.get(20),'0.00')
})
