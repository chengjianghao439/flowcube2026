'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { projectSaleShipments } = require('../backend/src/modules/accounting/voucher-sale-periods')

function facts({ quantities = ['1.00','1.00','1.00'], price = '1.00500000', cost = '1.0050', orderGross = '3.0150', discount = '0.0000' } = {}) {
  const shipped = quantities.reduce((s,q)=>s+Math.round(Number(q)*100),0)/100
  return {
    orders:[{soId:1,order_no:'精确金额回归',customer_id:1,customer_name:'回归客户',orderGross,discount}],
    items:[{id:1,order_id:1,shipped_qty:String(shipped),unit_price:price,cost_snapshot:cost}],
    shipments:quantities.map((qty,i)=>({soId:1,taskId:i+1,taskItemId:i+1,saleItemId:1,qty,shippedAt:`2097-${String(i+1).padStart(2,'0')}-01`})),
  }
}
const amounts = (specs,code) => specs.filter(s=>s.legs.some(l=>l.code===code)).map(s=>s.legs.find(l=>l.code===code).amount)

test('1.005三次拆单与一次发货都精确计3.02，期间尾差为1.01/1.00/1.01',()=>{
  const split=projectSaleShipments(facts())
  for(const code of ['1122','6401']) assert.deepEqual(amounts(split,code),['1.01','1.00','1.01'])
  const together=projectSaleShipments(facts({quantities:['3.00']}))
  for(const code of ['1122','6401']) assert.deepEqual(amounts(together,code),['3.02'])
})

test('保留多单位换算的八位单价，不能压成四位',()=>{
  const specs=projectSaleShipments(facts({quantities:['1000.00'],price:'0.00005001',cost:'0.0000',orderGross:'0.0500'}))
  assert.deepEqual(amounts(specs,'1122'),['0.05'])
})

test('合法大金额分值不经过Number而丢分，数据库最大凭证金额可表达',()=>{
  const specs=projectSaleShipments(facts({quantities:['9999999.99'],price:'10000000.00999999',cost:'0.0000',orderGross:'9999999999.9999'}))
  // 9999999.99 × 10000000.00999999 = 99999999999999.8999000001
  assert.deepEqual(amounts(specs,'1122'),['99999999999999.90'])
})

test('累计折扣按四位分摊再净额化，税额累计差额只分配一次',()=>{
  const specs=projectSaleShipments(facts({discount:'0.0100'}),new Map([[1,'1.02']]))
  assert.deepEqual(amounts(specs,'1122'),['1.01','0.99','1.01'])
  assert.deepEqual(amounts(specs,'222102'),['1.01','0.01'])
  assert.deepEqual(amounts(specs,'6401'),['1.01','1.00','1.01'])
})

test('数量与价格非法精度必须拒绝，不能截断',()=>{
  assert.throws(()=>projectSaleShipments(facts({quantities:['1.001']})),e=>e.code==='ACCT_SALE_SOURCE_INVALID')
  assert.throws(()=>projectSaleShipments(facts({price:'1.000000001'})),e=>e.code==='ACCT_SALE_SOURCE_INVALID')
})

test('单张销售凭证金额超过DECIMAL(16,2)须明确拒绝',()=>{
  assert.throws(()=>projectSaleShipments(facts({quantities:['9999999999.99'],price:'9999999999.99999999',cost:'0',orderGross:'9999999999.9999'})),e=>e.code==='ACCT_SALE_AMOUNT_OUT_OF_RANGE')
})

test('大额销项税额仍保留最后一分钱，收入税额拆分精确相抵',()=>{
  const specs=projectSaleShipments(facts({quantities:['9999999.99'],price:'10000000.00999999',cost:'0',orderGross:'9999999999.9999'}),new Map([[1,'99999999999999.89']]))
  assert.deepEqual(amounts(specs,'1122'),['99999999999999.90'])
  assert.deepEqual(amounts(specs,'6001'),['0.01'])
  assert.deepEqual(amounts(specs,'222102'),['99999999999999.89'])
})

test('销售normalize与balance保持最大合法金额字符串，并拒绝总额超界',()=>{
  const {normalizeSaleLegs,saleBalance}=require('../backend/src/modules/accounting/voucher-sale-money')
  const legs=normalizeSaleLegs([{code:'1122',direction:1,amount:'99999999999999.99'},{code:'6001',direction:2,amount:'99999999999999.9900'}])
  assert.equal(legs[1].amount,'99999999999999.99')
  assert.deepEqual(saleBalance(legs),{debit:'99999999999999.99',credit:'99999999999999.99'})
  assert.throws(()=>saleBalance([...legs,{code:'1122',direction:1,amount:'0.01'},{code:'6001',direction:2,amount:'0.01'}]),e=>e.code==='ACCT_SALE_AMOUNT_OUT_OF_RANGE')
  assert.throws(()=>normalizeSaleLegs([{direction:1,amount:'1.001'}]),e=>e.code==='ACCT_SALE_DECIMAL_INVALID')
})
