'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module')
function fixture({scans,containers,reserved}={}){
 const tasks=[{id:21,sale_order_id:7,warehouse_id:2}],items=[{id:31,task_id:21,product_id:11,picked_qty:1}],cs=containers||[{id:41,product_id:11,warehouse_id:2,locked_by_task_id:21,remaining_qty:10,status:1}],logs=scans??[{id:51,task_id:21,item_id:31,container_id:41,product_id:11,qty:1}],calls=[]
 const conn={query:async(sql)=>{calls.push(sql);if(sql.startsWith('UPDATE'))return [{affectedRows:1}];assert.ok(sql.includes('FOR UPDATE'),'proof facts are current reads');if(sql.includes('FROM sale_order_items'))return [[{product_id:11,warehouse_id:2}]];if(sql.includes('FROM warehouse_tasks'))return [tasks];if(sql.includes('FROM warehouse_task_items'))return [items];if(sql.includes('FROM inventory_containers'))return [cs];if(sql.includes('FROM scan_logs')){assert.ok(sql.includes('COALESCE(scan_purpose,1)=1'));return [logs]};if(sql.includes('FROM stock_reservations'))return [reserved||[{id:61,product_id:11,warehouse_id:2,qty:5}]];throw new Error(sql)}}
 const released=[],file=path.resolve(__dirname,'../backend/src/modules/sale/sale.commercial-cancellation.js'),real=createRequire(file),module={exports:{}}
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,require:name=>name==='../../engine/reservationEngine'?{partialReleaseByProduct:async(conn,args)=>{released.push(args)}}:name==='../../engine/containerEngine'?{lockStockDimension:async()=>calls.push('DIM'),CONTAINER_STATUS:{ACTIVE:1}}:name==='../../utils/warehouseScope'?{assertInScope:()=>{}}:real(name)},{filename:file})
 return {api:module.exports,conn,calls,released,tasks,cs}
}
test('kit cancel retains PICK1 of container10, releases unpicked4 and locks dimension before container proof',async()=>{
 const f=fixture();await f.api.releaseUnpicked(f.conn,7)
 assert.equal(f.released.length,1);assert.equal(f.released[0].qty,4)
 assert.ok(f.calls.indexOf('DIM')<f.calls.findIndex(q=>q.includes('FROM inventory_containers')))
})
test('kit container return releases its own PICK share and accepts existing NULL-purpose SQL convention',async()=>{
 const f=fixture();assert.equal(await f.api.releaseReturned(f.conn,7,f.tasks[0],f.cs[0],31),1);assert.equal(f.released[0].qty,1)
})
test('missing/cross-item PICK and insufficient own reservation fail loudly without releasing',async()=>{
 for(const opts of [{scans:[]},{scans:[{id:51,task_id:21,item_id:99,container_id:41,product_id:11,qty:1}]},{reserved:[{id:61,product_id:11,warehouse_id:2,qty:.5}]}]){
  const f=fixture(opts);await assert.rejects(f.api.releaseUnpicked(f.conn,7),e=>e.code==='SALE_COMMERCIAL_PICK_SOURCE_INVALID');assert.equal(f.released.length,0)
 }
})
test('kit return SO lock is only a mutex; task scope authorizes outside the SO head warehouse',async()=>{
 const f=fixture(),calls=[],conn={query:async sql=>{calls.push(sql);if(sql.includes('JOIN sale_orders'))return [[{sale_order_id:7,commercial_model:'kit-v1'}]];assert.equal(sql,'SELECT id FROM sale_orders WHERE id=? FOR UPDATE');return [[{id:7}]]}}
 assert.equal(await f.api.lockReturnOrder(conn,21),7);assert.equal(calls.length,2)
})

function warehouseCancelFixture(saleOrderId = 7) {
  const calls = []
  const conn = {
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
    async query(sql) {
      if (sql.includes('FROM warehouse_tasks') && sql.endsWith('FOR UPDATE')) {
        calls.push('lock task')
        return [[{ id: 21, task_no: 'WT-21', sale_order_id: saleOrderId, status: 2, warehouse_id: 2 }]]
      }
      if (sql.includes('FROM inventory_containers')) return [[]]
      if (sql.startsWith('UPDATE warehouse_tasks')) {
        calls.push('cancel task')
        return [{ affectedRows: 1 }]
      }
      assert.fail(sql)
    },
  }
  const onConnection = label => async actual => {
    assert.equal(actual, conn)
    calls.push(label)
  }
  const file = path.resolve(__dirname, '../backend/src/modules/warehouse-tasks/warehouse-tasks.command.js')
  const real = createRequire(file)
  const module = { exports: {} }
  const stubs = {
    '../../config/db': { pool: { getConnection: async () => conn } },
    '../../utils/warehouseScope': { assertInScope: scope => assert.equal(scope ?? null, null) },
    '../../engine/reservationEngine': { releaseByRef: onConnection('release order reservation') },
    '../../engine/containerEngine': { unlockContainersByTask: onConnection('unlock containers') },
    '../sorting-bins/sorting-bins.service': { releaseByTask: onConnection('release sorting bin') },
    '../packages/packages.service': { cancelByTaskId: onConnection('cancel packages') },
    '../fulfillment/fulfillment.refresh': { commitFulfillment: actual => actual.commit() },
    './warehouse-task-events.service': { WT_EVENT: { TASK_CANCELLED: 'TASK_CANCELLED' }, record: onConnection('record event') },
    './warehouse-tasks.helpers': {},
    './warehouse-tasks.query': {},
  }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, require: name => stubs[name] || real(name) }, { filename: file })
  return { command: module.exports, conn, calls, releaseOrderReservation: onConnection('release order reservation') }
}

test('warehouse cancel cannot bypass the sales-order entry point with an option', async () => {
  const { command, calls } = warehouseCancelFixture()
  await assert.rejects(command.cancel(21, { syncSaleStatus: false }), { statusCode: 409, code: 'SALE_ORDER_CANCEL_REQUIRED' })
  assert.deepEqual(calls, ['begin', 'lock task', 'rollback', 'release'])
})

test('sales can cancel only a task belonging to its locked order', async () => {
  const { command, conn, calls, releaseOrderReservation } = warehouseCancelFixture()
  await assert.rejects(command.cancelForSaleWithinTransaction(conn, 21, { saleOrderId: 8, releaseOrderReservation }),
    { statusCode: 409, code: 'SALE_ORDER_CANCEL_TASK_MISMATCH' })
  assert.deepEqual(calls, ['lock task'])
})

test('sales owns the connection and releases ordinary reservations at the existing point in task cancellation', async () => {
  const { command, conn, calls, releaseOrderReservation } = warehouseCancelFixture()
  await command.cancelForSaleWithinTransaction(conn, 21, { saleOrderId: 7, releaseOrderReservation })
  assert.deepEqual(calls, ['lock task', 'cancel task', 'unlock containers', 'release sorting bin',
    'release order reservation', 'cancel packages', 'record event'])
})

test('warehouse owns commit and resource release for a task without a sales order', async () => {
  const { command, calls } = warehouseCancelFixture(null)
  await command.cancel(21)
  assert.deepEqual(calls, ['begin', 'lock task', 'cancel task', 'unlock containers', 'release sorting bin',
    'cancel packages', 'record event', 'commit', 'release'])
})
