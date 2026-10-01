'use strict'
// Exact owned resources; actual purchase/PDA/pick/cancel/return, no state shortcuts.
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto')
require('./helpers/testEnvironment').validateTestEnvironment()
const {pool}=require('../backend/src/config/db'),app=require('../backend/src/app')
const ref='KPC-'+randomUUID().slice(0,8),f={ref,sales:[],products:[],containers:[],cases:[]},violations=[]
let server,token,pda
const q=async(sql,params=[]) => (await pool.query(sql,params))[0]
const ins=async(sql,p)=>Number((await q(sql,p)).insertId)
const units=n=>Math.round(Number(n)*100)
async function http(path,body,{method='POST',expect=200,key=randomUUID(),device=false,auth=token,deviceHeaders=pda}={}) {
 const res=await fetch('http://127.0.0.1:'+server.address().port+'/api'+path,{method,headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json','X-Request-Key':key,...(device?deviceHeaders:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)})
 const json=await res.json();if(res.status!==expect)throw Object.assign(new Error(path+' '+res.status+' '+JSON.stringify(json)),{status:res.status});return json.data
}
async function reserveQty(orderId){const [r]=await q("SELECT COALESCE(SUM(qty),0) qty FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=? AND status=1",[orderId]);return units(r.qty)}
async function supply(productId,packages){
 const qty=packages.reduce((s,p)=>s+units(p),0)/100
 const po=await http('/purchase',{supplierId:f.supplierId,supplierName:ref,warehouseId:f.warehouseId,warehouseName:ref,items:[{productId,productCode:ref,productName:ref,unit:'个',quantity:qty,unitPrice:1}]},{expect:201})
 await http('/purchase/'+po.id+'/confirm',{})
 const task=await http('/inbound-tasks',{poId:po.id},{expect:201});await http('/inbound-tasks/'+task.taskId+'/submit',{})
 const receive=await http('/inbound-tasks/'+task.taskId+'/receive',{productId,packages:packages.map(qty=>({qty}))},{device:true})
 for(const c of receive.containers){f.containers.push(c.containerId);await http('/inbound-tasks/'+task.taskId+'/putaway',{containerId:c.containerId,locationId:f.locationId},{device:true})}
 return q('SELECT id,barcode,remaining_qty FROM inventory_containers WHERE id IN (?) ORDER BY id',[receive.containers.map(c=>c.containerId)])
}
async function scenario(name,target,baseQty,packages,picks,otherQty){
 const productId=await ins("INSERT INTO product_items(code,name,unit,sale_price_a,cost_price,allow_decimal_qty) VALUES (?,?,'个',10,1,?)",[ref+'-'+name,ref+'-'+name,baseQty<1?1:0]);f.products.push(productId)
 const kit=await http('/kits',{code:ref+'-'+name,name:ref+'-'+name,referenceUnitPrice:10,components:[{productId,baseQty}]},{expect:201})
 const containers=await supply(productId,packages)
 const so=await http('/sale',{customerId:f.customerId,warehouseId:f.warehouseId,commercialModel:'kit-v1',commercialGroups:[{kind:'kit',lineKey:'A',kitVersionId:kit.currentVersionId,quantity:target,priceSource:'kit_default'}]},{expect:201});f.sales.push(so.id)
 const detail=await http('/sale/'+so.id,undefined,{method:'GET'}),marker={commercialModel:'kit-v1',expectedRevision:1}
 await http('/sale/'+so.id+'/reserve',{...marker,items:[{id:detail.items[0].id,warehouseId:f.warehouseId,warehouseName:ref,qty:units(target*baseQty)/100}]})
 const other=await http('/sale',{customerId:f.customerId,customerName:ref,warehouseId:f.warehouseId,warehouseName:ref,items:[{productId,productCode:ref+'-'+name,productName:ref,unit:'个',quantity:otherQty,unitPrice:10,priceSource:'manual'}]},{expect:201});f.sales.push(other.id)
 await http('/sale/'+other.id+'/reserve',{})
 const dispatch=await http('/sale/'+so.id+'/ship',{...marker,groups:[{groupId:detail.commercialGroups[0].id,qty:target}]})
 const taskId=dispatch.tasks[0].taskId,task=await http('/warehouse-tasks/'+taskId,undefined,{method:'GET'})
 for(let i=0;i<picks.length;i++)await http('/scan-logs',{taskId,itemId:task.items[0].id,containerId:Number(containers[i].id),barcode:containers[i].barcode,productId,qty:picks[i],scanMode:'散件'},{expect:201,device:true})
 const cancelKey=randomUUID();await http('/sale/'+so.id+'/cancel',marker,{key:cancelKey});await http('/sale/'+so.id+'/cancel',marker,{key:cancelKey})
 const picked=picks.reduce((n,p)=>n+units(p),0),evidence={name,saleId:so.id,otherSaleId:other.id,taskId,containers,target,baseQty,picks,afterCancelReserved:(await reserveQty(so.id))/100,expectedAfterCancel:picked/100,returns:[]};f.cases.push(evidence)
 console.log('[cancel actual]',JSON.stringify(evidence));if(units(evidence.afterCancelReserved)!==picked)violations.push(name+' cancel retains container remainder rather than PICK')
 const cancelled=await http('/sale/'+so.id,undefined,{method:'GET'});assert.equal(cancelled.totalAmount,target*10);assert.equal(cancelled.commercialGroups[0].quantity,target)
 await http('/sale/'+so.id,marker,{method:'DELETE',expect:409})
 await http('/scan-logs',{taskId,itemId:task.items[0].id,containerId:Number(containers[0].id),barcode:containers[0].barcode,productId,qty:picks[0],scanMode:'散件'},{expect:409,device:true})
 let expected=picked
 for(let i=0;i<picks.length;i++){
  const c=containers[i],key=randomUUID(),body={taskId,containerId:Number(c.id),barcode:c.barcode,locationId:f.locationId},actual={containerId:Number(c.id),picked:picks[i]}
  if(i===0&&['single','multiple'].includes(name)){
   const getConnection=pool.getConnection.bind(pool);let injected=false
   pool.getConnection=async(...args)=>{const conn=await getConnection(...args),query=conn.query.bind(conn);conn.query=async(sql,params)=>{
    if(!injected&&typeof sql==='string'&&(name==='single'?sql.includes('FROM scan_logs WHERE task_id IN'):sql.includes('SELECT id, qty FROM stock_reservations')&&Number(params?.[1])===Number(so.id))){injected=true;return [[]]}
    return query(sql,params)
   };return conn}
   try{await http('/scan-logs/cancel-return',body,{expect:409,device:true,key})}finally{pool.getConnection=getConnection}
   assert.equal(injected,true);assert.equal(await reserveQty(so.id),expected)
   const [stillLocked]=await q('SELECT locked_by_task_id FROM inventory_containers WHERE id=?',[c.id]);assert.equal(Number(stillLocked.locked_by_task_id),taskId)
   const [receipt]=await q('SELECT COUNT(*) count FROM operation_requests WHERE request_key=?',[key]);assert.equal(Number(receipt.count),0,'failed source proof rolls receipt back with no unlock/release')
   console.log('[PASS fault]',name==='single'?'missing PICK':'own reservation missing','409 rollback keeps container lock/reservation, same original key retries next')
  }
  try{const returned=await http('/scan-logs/cancel-return',body,{expect:201,device:true,key});assert.deepEqual(await http('/scan-logs/cancel-return',body,{expect:201,device:true,key}),returned);actual.status=201;expected-=units(picks[i])}catch(e){actual.status=e.status;actual.error=e.message;violations.push(name+' actual return failed '+e.status)}
  actual.reserved=(await reserveQty(so.id))/100;actual.otherReserved=(await reserveQty(other.id))/100
  const locked=await q('SELECT id FROM inventory_containers WHERE locked_by_task_id=? ORDER BY id',[taskId]);actual.locked=locked.map(r=>Number(r.id));evidence.returns.push(actual);console.log('[return actual]',JSON.stringify(actual))
  if(units(actual.reserved)!==expected)violations.push(name+' releases wrong container share')
  assert.equal(units(actual.otherReserved),units(otherQty),'another order reservation is never released')
  const [stock]=await q('SELECT quantity,reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',[productId,f.warehouseId]);assert.equal(units(stock.quantity),packages.reduce((n,p)=>n+units(p),0),'cancel/return never deducts physical stock')
  assert.equal(units(stock.reserved),units(actual.reserved)+units(otherQty),'reservation cache follows only exact own ledger release')
 }
 const [returns]=await q('SELECT COUNT(*) count,COALESCE(SUM(qty),0) qty FROM scan_logs WHERE task_id=? AND scan_purpose=3',[taskId]);assert.equal(Number(returns.count),picks.length);assert.equal(units(returns.qty),picked)
 const [wt]=await q('SELECT status,sorting_bin_id FROM warehouse_tasks WHERE id=?',[taskId]);evidence.finalStatus=Number(wt.status)
 if(evidence.finalStatus!==8||(await reserveQty(so.id))!==0)violations.push(name+' final task/reservation not closed')
 await http('/sale/'+other.id+'/cancel',{})
 if(evidence.finalStatus===8){assert.equal(wt.sorting_bin_id,null);const current=await http('/sale/'+so.id,undefined,{method:'GET'});assert.equal(current.items[0].reservedQty,0);assert.equal(current.totalAmount,target*10)}
}
async function ordinaryScenario(){
 const productId=await ins("INSERT INTO product_items(code,name,unit,sale_price_a,cost_price,allow_decimal_qty) VALUES (?,?,'个',10,1,0)",[ref+'-ordinary',ref+'-ordinary']);f.products.push(productId)
 const [container]=await supply(productId,[10])
 const sale=await http('/sale',{customerId:f.customerId,customerName:ref,warehouseId:f.warehouseId,warehouseName:ref,items:[{productId,productCode:ref+'-ordinary',productName:ref,unit:'个',quantity:5,unitPrice:10,priceSource:'manual'}]},{expect:201});f.sales.push(sale.id)
 await http('/sale/'+sale.id+'/reserve',{})
 await http('/sale/'+sale.id+'/ship',{})
 const tasks=await q('SELECT id FROM warehouse_tasks WHERE sale_order_id=? AND deleted_at IS NULL ORDER BY id',[sale.id]);assert.equal(tasks.length,1)
 const taskId=Number(tasks[0].id),task=await http('/warehouse-tasks/'+taskId,undefined,{method:'GET'})
 await http('/scan-logs',{taskId,itemId:task.items[0].id,containerId:Number(container.id),barcode:container.barcode,productId,qty:1,scanMode:'散件'},{expect:201,device:true})
 await http('/sale/'+sale.id+'/cancel',{});assert.equal(await reserveQty(sale.id),0,'ordinary cancellation retains original immediate release policy')
 const body={taskId,containerId:Number(container.id),barcode:container.barcode,locationId:f.locationId},key=randomUUID(),result=await http('/scan-logs/cancel-return',body,{expect:201,device:true,key});assert.deepEqual(await http('/scan-logs/cancel-return',body,{expect:201,device:true,key}),result)
 const [wt]=await q('SELECT status FROM warehouse_tasks WHERE id=?',[taskId]),[c]=await q('SELECT locked_by_task_id,remaining_qty FROM inventory_containers WHERE id=?',[container.id]),[scan]=await q('SELECT COUNT(*) count,SUM(qty) qty FROM scan_logs WHERE task_id=? AND scan_purpose=3',[taskId]);assert.equal(Number(wt.status),8);assert.equal(c.locked_by_task_id,null);assert.equal(Number(c.remaining_qty),10);assert.equal(Number(scan.count),1);assert.equal(Number(scan.qty),10,'ordinary return scan keeps original container remainder quantity')
 f.cases.push({name:'ordinary',saleId:sale.id,taskId,containers:[container],afterCancelReserved:0,finalStatus:8});console.log('[PASS ordinary] reserve5/PICK1/container10: original immediate reservation release, return scan10, replay once, WT8/lock0/stock10')
}
async function scopeScenario(){
 f.headWarehouseId=await ins('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)',[ref+'-head',ref+'-head'])
 const productId=await ins("INSERT INTO product_items(code,name,unit,sale_price_a,cost_price,allow_decimal_qty) VALUES (?,?,'个',10,1,0)",[ref+'-scope',ref+'-scope']);f.products.push(productId)
 const kit=await http('/kits',{code:ref+'-scope',name:ref+'-scope',referenceUnitPrice:10,components:[{productId,baseQty:1}]},{expect:201}),[container]=await supply(productId,[10])
 const sale=await http('/sale',{customerId:f.customerId,warehouseId:f.headWarehouseId,commercialModel:'kit-v1',commercialGroups:[{kind:'kit',lineKey:'A',warehouseId:f.warehouseId,kitVersionId:kit.currentVersionId,quantity:5,priceSource:'kit_default'}]},{expect:201});f.sales.push(sale.id)
 const detail=await http('/sale/'+sale.id,undefined,{method:'GET'}),marker={commercialModel:'kit-v1',expectedRevision:1}
 await http('/sale/'+sale.id+'/reserve',{...marker,items:[{id:detail.items[0].id,warehouseId:f.warehouseId,warehouseName:ref,qty:5}]})
 const other=await http('/sale',{customerId:f.customerId,customerName:ref,warehouseId:f.warehouseId,warehouseName:ref,items:[{productId,productCode:ref+'-scope',productName:ref,unit:'个',quantity:1,unitPrice:10,priceSource:'manual'}]},{expect:201});f.sales.push(other.id);await http('/sale/'+other.id+'/reserve',{})
 const dispatch=await http('/sale/'+sale.id+'/ship',{...marker,groups:[{groupId:detail.commercialGroups[0].id,qty:5}]}),taskId=dispatch.tasks[0].taskId,task=await http('/warehouse-tasks/'+taskId,undefined,{method:'GET'})
 await http('/scan-logs',{taskId,itemId:task.items[0].id,containerId:Number(container.id),barcode:container.barcode,productId,qty:1,scanMode:'散件'},{expect:201,device:true});await http('/sale/'+sale.id+'/cancel',marker)
 const evidence={name:'scope',saleId:sale.id,otherSaleId:other.id,taskId,containers:[container],headWarehouseId:f.headWarehouseId,taskWarehouseId:f.warehouseId};f.cases.push(evidence)
 f.scopeRoleId=await ins('INSERT INTO sys_roles(code,name,is_system) VALUES (?,?,0)',[ref+'-scope',ref+'-scope'])
 await q('INSERT INTO sys_role_permissions(role_id,permission) VALUES ?',[['warehouse.task.view','warehouse.task.cancel_return','warehouse.task.cancel_return.view','scan.log.view','sale.order.view'].map(p=>[f.scopeRoleId,p])])
 f.scopeUserId=await ins("INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active) VALUES (?,'!',?,?,?,1)",[ref+'-scope',ref+'-scope',f.scopeRoleId,ref+'-scope'])
 const auth=require('../backend/node_modules/jsonwebtoken').sign({userId:f.scopeUserId,tokenVersion:0},process.env.JWT_SECRET,{expiresIn:'30m'}),key=randomUUID(),body={taskId,containerId:Number(container.id),barcode:container.barcode,locationId:f.locationId};evidence.returnKey=key
 const scope=async ids=>{await q('DELETE FROM user_warehouse_scope WHERE user_id=?',[f.scopeUserId]);await q('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES ?',[ids.map(id=>[f.scopeUserId,id])])}
 f.scopeDeviceIds=[]
 const device=async(warehouseId,suffix)=>{const secret=randomUUID(),code=ref+'-'+suffix,id=await ins("INSERT INTO pda_devices(device_code,device_name,warehouse_id,status,secret_hash) VALUES (?,?,?,'active',?)",[code,code,warehouseId,require('../backend/node_modules/bcryptjs').hashSync(secret,4)]);f.scopeDeviceIds.push(id);const s=await require('../backend/src/modules/pda/pda.sessions.service').createSession({deviceCode:code,deviceSecret:secret,userId:f.scopeUserId});return {'X-Client':'pda','X-PDA-Session':s.sessionToken}}
 const correct=await device(f.warehouseId,'correct'),wrong=await device(f.headWarehouseId,'wrong'),opts={device:true,auth,deviceHeaders:correct,key,expect:201}
 await scope([f.warehouseId]);await http('/warehouse-tasks/'+taskId,undefined,{method:'GET',auth});await http('/warehouse-tasks/'+taskId+'/cancel-return-detail',undefined,{method:'GET',auth});await http('/sale/'+sale.id,undefined,{method:'GET',auth,expect:403})
 if(process.env.KIT_CANCEL_SCOPE_RED==='1'){
  let status=201;try{await http('/scan-logs/cancel-return',body,opts)}catch(e){status=e.status}
  await scope([f.warehouseId,f.headWarehouseId]);await http('/scan-logs/cancel-return',body,opts);await http('/sale/'+other.id+'/cancel',{});evidence.finalStatus=8
  console.log('[scope red actual]',JSON.stringify({...evidence,expected:201,actual:status}));assert.equal(status,201,'own task/device warehouse must authorize return without SO head scope');return
 }
 await scope([f.warehouseId,f.headWarehouseId])
 const wrongKey=randomUUID();evidence.wrongDeviceKey=wrongKey;await http('/scan-logs/cancel-return',{...body,pdaWarehouseId:f.warehouseId},{...opts,key:wrongKey,deviceHeaders:wrong,expect:403})
 const [locked]=await q('SELECT locked_by_task_id FROM inventory_containers WHERE id=?',[container.id]),[missing]=await q('SELECT COUNT(*) count FROM operation_requests WHERE request_key=?',[wrongKey]);assert.equal(Number(locked.locked_by_task_id),taskId);assert.equal(Number(missing.count),0);assert.equal(await reserveQty(sale.id),100);assert.equal(await reserveQty(other.id),100)
 await scope([f.warehouseId]);const returned=await http('/scan-logs/cancel-return',body,opts);assert.deepEqual(await http('/scan-logs/cancel-return',body,opts),returned)
 await scope([f.headWarehouseId]);await http('/scan-logs/cancel-return',body,{...opts,expect:403})
 await scope([f.warehouseId,f.headWarehouseId]);await http('/scan-logs/cancel-return',body,{...opts,deviceHeaders:wrong,expect:403})
 await scope([f.warehouseId]);assert.deepEqual(await http('/scan-logs/cancel-return',body,opts),returned);await http('/sale/'+sale.id,undefined,{method:'GET',auth,expect:403})
 const [wt]=await q('SELECT status FROM warehouse_tasks WHERE id=?',[taskId]),[scan]=await q('SELECT COUNT(*) count,SUM(qty) qty FROM scan_logs WHERE task_id=? AND scan_purpose=3',[taskId]),[receipt]=await q('SELECT COUNT(*) count FROM operation_requests WHERE request_key=?',[key]);assert.equal(Number(wt.status),8);assert.equal(Number(scan.count),1);assert.equal(Number(scan.qty),1);assert.equal(Number(receipt.count),1);assert.equal(await reserveQty(sale.id),0);assert.equal(await reserveQty(other.id),100)
 const [identity]=await q('SELECT resource_type,resource_id,user_id FROM operation_requests WHERE request_key=?',[key]);assert.equal(identity.resource_type,'warehouse_task');assert.equal(Number(identity.resource_id),taskId);assert.equal(Number(identity.user_id),f.scopeUserId)
 const [stock]=await q('SELECT quantity,reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',[productId,f.warehouseId]);assert.equal(Number(stock.quantity),10);assert.equal(Number(stock.reserved),1)
 await http('/sale/'+other.id+'/cancel',{});evidence.finalStatus=8
 console.log('[PASS scope] own WT/device WH with SO head outside scope returns201 once while GET SO403; narrowed successful-key replay403; wrong bound device with full actor scope403/no mutation, body cannot override device fact')
}
async function main(){try{
 f.userId=await ins("INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active) VALUES (?,'!',?,1,'测试',1)",[ref,ref]);token=require('../backend/node_modules/jsonwebtoken').sign({userId:f.userId,tokenVersion:0},process.env.JWT_SECRET,{expiresIn:'30m'})
 f.warehouseId=await ins('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)',[ref,ref]);f.customerId=await ins('INSERT INTO sale_customers(code,name,credit_limit) VALUES (?,?,NULL)',[ref,ref]);f.supplierId=await ins('INSERT INTO supply_suppliers(code,name) VALUES (?,?)',[ref,ref]);f.locationId=await ins('INSERT INTO warehouse_locations(warehouse_id,code,name) VALUES (?,?,?)',[f.warehouseId,ref,ref]);f.binId=await ins('INSERT INTO sorting_bins(warehouse_id,code) VALUES (?,?)',[f.warehouseId,ref])
 const secret=randomUUID();f.deviceId=await ins("INSERT INTO pda_devices(device_code,device_name,warehouse_id,status,secret_hash) VALUES (?,?,?,'active',?)",[ref,ref,f.warehouseId,require('../backend/node_modules/bcryptjs').hashSync(secret,4)])
 const session=await require('../backend/src/modules/pda/pda.sessions.service').createSession({deviceCode:ref,deviceSecret:secret,userId:f.userId});pda={'X-Client':'pda','X-PDA-Session':session.sessionToken}
 server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject)})
 if(process.env.KIT_CANCEL_SLICE!=='scope'){await scenario('single',5,1,[10],[1],1);await scenario('multiple',2,1,[2,3],[1,1],1);await scenario('decimal',3,.1,[1,2],[.1,.2],.1);await scenario('equal',2,1,[2,1],[2],1);await ordinaryScenario()}
 await scopeScenario()
 assert.deepEqual(violations,[],'actual PICK quantities preserve and release exactly each pending container share')
 console.log('[PASS] single reserve5/PICK1/container10, two containers PICK1 each and decimal .1/.2: exact own pending reservations, same-key cancel/return once, other order preserved, WT8/locks0/reserves0, stock unchanged')
}finally{
 const path='/tmp/flowcube-kit-partial-cancel-'+ref+'.json';fs.writeFileSync(path,JSON.stringify(f,null,2),{mode:0o600});console.log('[fixtures]',path)
 try{
 if(f.deviceId){await q('DELETE FROM pda_device_sessions WHERE device_id=?',[f.deviceId]);await q('DELETE FROM pda_devices WHERE id=?',[f.deviceId])}
 if(f.userId)await q('UPDATE sys_users SET is_active=0,token_version=token_version+1 WHERE id=?',[f.userId])
 for(const id of f.scopeDeviceIds||[]){await q('DELETE FROM pda_device_sessions WHERE device_id=?',[id]);await q('DELETE FROM pda_devices WHERE id=?',[id])}
 if(f.scopeUserId){await q('DELETE FROM user_warehouse_scope WHERE user_id=?',[f.scopeUserId]);await q('UPDATE sys_users SET is_active=0,token_version=token_version+1 WHERE id=?',[f.scopeUserId])}
 if(f.scopeRoleId)await q('DELETE FROM sys_role_permissions WHERE role_id=?',[f.scopeRoleId])
 }finally{try{if(server)await new Promise(resolve=>server.close(resolve))}finally{await pool.end()}}
 console.log('[cleanup] exact own actor/device closed; transaction evidence retained; pending failed business facts never force-cleared; server/pool closed')
}}
main().catch(e=>{console.error(e);process.exitCode=1})
