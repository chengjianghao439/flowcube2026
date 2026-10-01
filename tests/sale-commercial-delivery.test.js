'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const {allocateCommercialDelivery}=require('../backend/src/modules/sale/sale.commercial-delivery')
test('shared physical and expected supply is consumed once across two kits',()=>{
 const groups=[1,2].map(id=>({id,lineKey:'K'+id,kind:'kit',targetQty:1,components:[{saleItemId:7,baseQty:1},{saleItemId:8,baseQty:4}]}))
 const items=[{id:7,physical:1,processingDays:0,sources:[{quantity:1,date:'2026-10-03',stage:'待到货'}]},{id:8,physical:8,processingDays:0,sources:[]}]
 const result=allocateCommercialDelivery(groups,new Map(),items,'2026-10-01')
 assert.equal(result[0].readyDate,'2026-10-01');assert.equal(result[1].readyDate,'2026-10-03')
 assert.equal(result.flatMap(g=>g.components).reduce((n,c)=>n+c.physical,0),9)
 assert.equal(result[1].components[0].sources[0].quantity,1)
})
test('undated allocated source leaves complete kit date unknown with an explanation',()=>{
 const result=allocateCommercialDelivery([{id:1,lineKey:'K',kind:'kit',targetQty:1,components:[{saleItemId:7,baseQty:1}]}],new Map(),[{id:7,physical:0,sources:[{quantity:1,date:null}],processingDays:0}],'2026-10-01')
 assert.equal(result[0].readyDate,null);assert.match(result[0].readyDateExplanation,/日期/)
})
