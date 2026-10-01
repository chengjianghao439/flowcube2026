'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {financialRefundDelta,financialRefundEstimate}=require('../backend/src/modules/sale/sale.commercial-financial')
test('original whole order discount reversal preserves gross source and four-place net cumulative differences',()=>{
 const basis={orderGross:100,discount:10}
 assert.equal(financialRefundDelta(basis,0,80),72)
 assert.equal(financialRefundDelta(basis,80,100),18)
 assert.equal(financialRefundDelta(basis,0,100),90)
 assert.equal(financialRefundEstimate(basis,100),90)
 for(const amounts of [[.01,.01,.01],[80,20],[20,80]]){
  let before=0,net=0
  for(const amount of amounts){net+=financialRefundDelta(basis,before,before+amount);before+=amount}
  assert.equal(Math.round(net*10000),Math.round(financialRefundDelta(basis,0,before)*10000))
 }
})
