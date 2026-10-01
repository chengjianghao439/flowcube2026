'use strict'
const assert=require('node:assert/strict')
const {test}=require('node:test')
const {projectSaleShipments,loadSaleShipmentFacts}=require('../backend/src/modules/accounting/voucher-sale-periods')
test('shared physical average never prices a confirmed commercial shipment; actual cost is counted once',()=>{
 const specs=projectSaleShipments({orders:[{soId:1,order_no:'K',customer_id:1,commercialModel:'kit-v1',orderGross:300,discount:0}],items:[{id:1,order_id:1,shipped_qty:1,unit_price:120,cost_snapshot:2},{id:2,order_id:1,shipped_qty:4,unit_price:7.5,cost_snapshot:1}],shipments:[{taskId:1,soId:1,taskItemId:1,saleItemId:1,qty:1,shippedAt:'2026-10-01',confirmedGross:100},{taskId:1,soId:1,taskItemId:2,saleItemId:2,qty:4,shippedAt:'2026-10-01',confirmedGross:100}]})
 assert.equal(specs.find(s=>s.sourceType==='sale_revenue').legs[0].amount,'100.00')
 assert.equal(specs.find(s=>s.sourceType==='sale_cogs').legs[0].amount,'6.00')
})

test('closing remaining quantities keeps original shipment discount basis and prior period revenue',async()=>{
 const data=[
  [{soId:1,order_no:'K',commercialModel:'kit-v1',orderGross:'2.00',discount:'0.0101'}],
  [{id:1,order_id:1,shipped_qty:2,cost_snapshot:0}],
  [{taskId:1,soId:1,taskItemId:1,saleItemId:1,qty:1,shippedAt:'2026-09-30'}, {taskId:2,soId:1,taskItemId:2,saleItemId:1,qty:1,shippedAt:'2026-10-01'}],
  [1,2].map(task_id=>({task_id,order_id:1,gross:'1.00',unknown_basis:0,missing_basis:0,gross_basis:'3.00',max_gross_basis:'3.00',discount_basis:'0.0151',max_discount_basis:'0.0151'}))
 ]
 let calls=0
 const facts=await loadSaleShipmentFacts({query:async()=>[data[calls++]]})
 const revenue=projectSaleShipments(facts).filter(s=>s.sourceType==='sale_revenue')
 assert.deepEqual(revenue.map(s=>s.legs[0].amount),['1.00','0.99'])
 assert.equal(calls,4)
})
test('shipment loader refuses unknown or inconsistent frozen discount basis',async()=>{
 const good={task_id:1,order_id:1,gross:'1.00',unknown_basis:0,missing_basis:0,gross_basis:'3.00',max_gross_basis:'3.00',discount_basis:'0.0151',max_discount_basis:'0.0151'}
 for(const money of [[{...good,unknown_basis:1}],[{...good,missing_basis:1}],[{...good,max_discount_basis:'0.0101'}],[good,{...good,task_id:2,discount_basis:'0.0101',max_discount_basis:'0.0101'}]]){
  let call=0
  await assert.rejects(loadSaleShipmentFacts({query:async()=>[[[],[],[],money][call++]]}),e=>e.code==='ACCT_SALE_SOURCE_INVALID')
 }
})
