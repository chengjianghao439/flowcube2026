'use strict'
const assert=require('node:assert/strict'),{test}=require('node:test')
const {foldEntryItemWithRate}=require('../backend/src/utils/unitConversion')
test('default basic-unit quote converts to entry unit while manual quote stays in entry unit',()=>{
 const input={productId:1,unit:'个',entryUnit:'箱',quantity:1,unitPrice:80}
 const manual=foldEntryItemWithRate(input,3)
 assert.equal(manual.amount,80)
 const quoted=foldEntryItemWithRate({...input,priceIsBase:true},3)
 assert.equal(quoted.amount,240)
 assert.equal(quoted.unitPrice,80)
 assert.equal(quoted.quantity,3)
})
test('ordinary entry amount retains existing half-cent round2 behavior',()=>{assert.equal(foldEntryItemWithRate({unit:'个',quantity:1,unitPrice:1.005},1).amount,1)})
