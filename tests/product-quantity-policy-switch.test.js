'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { CHECKS, assertCanDisableDecimals } = require('../backend/src/modules/products/products.quantity-policy')
const { assertQtyPrecision, assertQtyPrecisionWith } = require('../backend/src/utils/qtyPrecision')

for (const [label, targetSql] of CHECKS) {
  test(`关闭开关拒绝依赖：${label}，只读检查不修改事实`, async () => {
    const seen = []
    const conn = { query: async (sql, params) => {
      seen.push(sql)
      assert.match(sql, /^SELECT /)
      assert.deepEqual(params, [7])
      return [sql === targetSql ? [{ conflict: 1 }] : []]
    } }
    await assert.rejects(assertCanDisableDecimals(conn, 7), error => error.statusCode === 409
      && error.code === 'PRODUCT_QTY_POLICY_CONFLICT' && error.message.includes(label))
    assert.equal(seen.length, CHECKS.length + 1)
  })
}
test('无数量依赖可关闭，价格、金额与已完成历史不作为整数冲突', async () => {
  const conn = { query: async sql => {
    assert.doesNotMatch(sql, /MOD\([^\n]*(?:cost_price|unit_price|amount|avg_cost)/)
    return [[]]
  } }
  await assert.doesNotReject(assertCanDisableDecimals(conn, 7))
})
test('默认库存策略可在同一切换中显式改为整数，其他仓小数策略仍拒绝', async () => {
  const conn = values => ({query:async sql=>[sql.includes('FROM product_stock_policies') ? values : []]})
  const original = [{warehouse_id:0,safety_stock:.3,reorder_point:.2,target_stock:null}]
  await assert.rejects(assertCanDisableDecimals(conn(original),7),{code:'PRODUCT_QTY_POLICY_CONFLICT'})
  await assert.doesNotReject(assertCanDisableDecimals(conn(original),7,{safetyStock:1,reorderPoint:2}))
  await assert.rejects(assertCanDisableDecimals(conn([...original,{warehouse_id:3,safety_stock:1,reorder_point:0,target_stock:.3}]),7,{safetyStock:1,reorderPoint:2}),{code:'PRODUCT_QTY_POLICY_CONFLICT'})
})
test('当前商品策略按稳定ID当前共享读；历史快照和调用选项不能绕过', async () => {
  let flag=0
  const seen=[]
  const conn={query:async(sql,params)=>{seen.push([sql,params]);return [[{id:1,allow_decimal_qty:flag},{id:2,allow_decimal_qty:flag}]]}}
  await assert.rejects(assertQtyPrecision(conn,[{productId:2,qty:.3,allowDecimalSnapshot:1},{productId:1,qty:1}],{enforceShippingPolicy:false}),{code:'QTY_INTEGER_REQUIRED'})
  assert.deepEqual(seen[0][1],[[1,2]]);assert.match(seen[0][0],/ORDER BY id FOR SHARE$/)
  flag=1
  await assert.doesNotReject(assertQtyPrecision(conn,[{productId:1,qty:.3,allowDecimalSnapshot:0}]))
  assert.equal(seen.length,2,'每次读取当前策略，不跨事务缓存')
  assert.throws(()=>assertQtyPrecisionWith({allowDecimal:false},-.3,'调整数量',{enforceShippingPolicy:false}),{code:'QTY_INTEGER_REQUIRED'})
  assert.doesNotThrow(()=>assertQtyPrecisionWith({allowDecimal:true},-.3,'调整数量'))
  assert.throws(()=>assertQtyPrecisionWith({allowDecimal:true},-.005,'调整数量'),{code:'QTY_DECIMALS_EXCEEDED'})
})

test('retired requisition quantities cannot block current product decimal policy', () => {
  assert.ok(CHECKS.length > 0)
  for (const [, sql] of CHECKS) assert.doesNotMatch(sql, /purchase_requisition/)
})
