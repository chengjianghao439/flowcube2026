'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { loader } = require('./helpers/offlineModuleLoader')

function load(file, stubs, expose) {
  const filename = path.resolve(__dirname, '../backend/src/modules', file)
  const overrides = new Map([[require.resolve('../backend/src/config/db'), { pool: {} }]])
  for (const [name, value] of Object.entries(stubs)) {
    overrides.set(require.resolve(path.resolve(path.dirname(filename), name)), value)
  }
  return loader(overrides)(filename, expose)
}

for (const reverse of [false, true]) test('锁后按最新数量和单价出库 ' + (reverse ? '返货' : '普通销售'), async () => {
  let moved, saleColumns
  const task = {id:2,task_type:reverse?'sale_return_out':'sale_out',status:6,warehouse_id:4,return_id:reverse?11:null,sale_order_id:reverse?null:1}
  const context = {saleOrderId:task.sale_order_id,warehouseId:4,totalAmount:3,items:[{productId:5,quantity:1,unitPrice:3}]}
  const ship = load('warehouse-tasks/warehouse-tasks.ship.js', {
    '../../utils/statusTransition': {lockStatusRow: async(_conn, q)=>{
      if (q.table==='warehouse_tasks') return task
      saleColumns = q.columns
      return {id:1,status:2,warehouse_id:4,commercial_model:null,total_amount:45}
    }},
    '../../utils/qtyPrecision': {assertQtyPrecision:async()=>{}},
    '../../engine/inventoryEngine': {MOVE_TYPE:{TASK_OUT:1},moveStock:async(_conn, row)=>{moved=row;throw Error('stock boundary')}},
    '../../constants/warehouseTaskStatus':{assertWarehouseTaskAction:()=>({toStatus:7}),isValidTransition:()=>true},
    '../../utils/operationRequest':{beginResourceOperationRequest:async()=>({})},
    './warehouse-tasks.helpers':Object.fromEntries(['assertTaskScope','assertTaskPickScanClosure','assertSaleReturnReverseClosure','assertTaskCheckScanClosure','assertTaskPackagingClosure','assertTaskPackagePrintClosure'].map(k=>[k,()=>{}])),
    '../sale/sale.ordinary-return-money': {prepareShipment:async()=>({})},
    '../disposal/disposal.handling.target-guards': {readLink:async()=>null},
  })
  const conn={query:async sql=>{
    if (sql.includes('FROM warehouse_task_items')) return [[{id:12,product_id:5,product_name:'件',picked_qty:5,unit_price:9,sale_return_item_id:10}]]
    if (sql.includes('FROM sale_return_items')) return [[{id:10,product_id:5,unit_price:9}]]
    if (sql.includes('FROM sale_order_items')) return [[{product_id:5,unit_price:9}]]
    throw Error(sql)
  }}
  await assert.rejects(ship.shipWithinTransaction(conn,2,{},context), /stock boundary/)
  assert.deepEqual([moved.quantity ?? moved.qty,moved.unitPrice],[5,9])
  if (!reverse) assert.match(saleColumns,/\bcash_policy\b/)
})

for (const policyMissing of [false,true]) test(policyMissing ? '缺少快照字段时当前重读新套单的政策' : '同一次历史出库的两笔分组共享一个分位截点', async () => {
  const service = load('sale/sale.commercial-money.js', {
    './sale.commercial-store': {loadGroups:async()=>[{id:3,warehouseId:1,targetQty:3,kind:'ordinary',components:[{productId:8}]}]},
    './sale.commercial-resolver': {snapshot:()=>({})},
    './sale.commercial-money.math': {projectCommercialBatch:()=>({grossAmount:1.23})},
  })
  const prior = [1,2].map(id=>({id,task_id:6,group_id:3,quantity:1,confirmed_gross:0.01,order_gross_basis:1.25,discount_basis:0.63,basis_origin:'real_confirmation'}))
  const conn = {query:async sql=>{
    if (sql.includes('FROM sale_orders')) {
      assert.match(sql,/FOR SHARE|FOR UPDATE/)
      return [[{cash_policy:'cash-cents-v1'}]]
    }
    if (sql.includes('FROM warehouse_tasks')) return [[{id:6,shipped_at:'2099-01-01',status:7}]]
    if (sql.includes('task_id=? AND active=1')) return [[{id:3,group_id:3,quantity:1}]]
    if (sql.includes('FROM sale_dispatch_groups')) return [prior]
    if (sql.includes('warehouse_task_items')) return [[{product_id:8,picked_qty:1,required_qty:1}]]
    if (sql.includes('sale_order_items')) return [[{product_id:8,unit_price:1.23}]]
    throw Error(sql)
  }}
  const sale = policyMissing ? {id:5} : {id:5,cash_policy:null}
  const result = await service.prepareShipment(conn,{id:7,warehouse_id:1},sale)
  assert.equal(result.money.length,1)
})

test('套单关闭余量，已发折扣写回按分的实际投影', async () => {
  let discount
  const service = load('sale/sale.service.js', {
    './sale.commercial-store': {loadGroups:async()=>[],save:async()=>{}},
    './sale.commercial-resolver': {materialize:()=>({total:100})},
  }, 'closeCommercialRemainder')
  const conn = {query:async(sql,args)=>{
    if(sql.includes('SET discount_amount')) discount = args[0]
    return [[]]
  }}
  await service(conn,{id:1,commercial_revision:1,total_amount:300,discount_amount:10,cash_policy:'cash-cents-v1'})
  assert.equal(Number(discount),3.33)
})
