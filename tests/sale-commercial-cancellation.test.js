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
