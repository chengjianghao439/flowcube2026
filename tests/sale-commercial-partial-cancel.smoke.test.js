'use strict'
const { issueFixtureAccessToken, cleanupFixtureSessionFamilies } = require('./helpers/fixtureAuthSession')

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
 // Every injected fact is an exact owned source row and rolls back before actual returns.
 const read=require('../backend/src/modules/warehouse-tasks/warehouse-tasks.kit-return-read'),proofTask=(await q('SELECT id,warehouse_id FROM warehouse_tasks WHERE id=?',[taskId]))[0],proofContainers=await q('SELECT * FROM inventory_containers WHERE locked_by_task_id=? ORDER BY id',[taskId]);
 const proof=await pool.getConnection();try{await proof.beginTransaction();const [[owned]]=await proof.query('SELECT id,item_id FROM scan_logs WHERE task_id=? AND container_id=? AND COALESCE(scan_purpose,1)=1',[taskId,containers[0].id]);assert.ok(owned);
 for(const fault of ['missing','cross-item','over-remaining','over-picked']){await proof.query('SAVEPOINT owned_read_fault');if(fault==='missing')await proof.query('DELETE FROM scan_logs WHERE id=?',[owned.id]);else if(fault==='cross-item')await proof.query('UPDATE scan_logs SET item_id=? WHERE id=?',[owned.item_id+100000,owned.id]);else if(fault==='over-remaining')await proof.query('UPDATE scan_logs SET qty=? WHERE id=?',[Number(containers[0].remaining_qty)+1,owned.id]);else await proof.query('UPDATE warehouse_task_items SET picked_qty=0 WHERE id=?',[owned.item_id]);await assert.rejects(read.load(proof,proofTask,proofContainers),e=>e.code==='SALE_COMMERCIAL_PICK_SOURCE_INVALID');await proof.query('ROLLBACK TO SAVEPOINT owned_read_fault')}
 const query=proof.query.bind(proof);let count=0;proof.query=async(...args)=>{assert.equal(/FOR (UPDATE|SHARE)/.test(args[0]),false,'read projection never acquires write/business locks');count++;return query(...args)};assert.equal((await read.load(proof,proofTask,proofContainers)).size,proofContainers.length);assert.equal(count,2,'two batch reads irrespective of container count');proof.query=query;
 }finally{await proof.rollback();proof.release()}
 const returnDetail=await http('/warehouse-tasks/'+taskId+'/cancel-return-detail',undefined,{method:'GET'});
 for(let n=0;n<picks.length;n++){const c=returnDetail.containers.find(c=>c.containerId===Number(containers[n].id));if(c?.taskReturnQty!==picks[n]||c?.remainingQty!==Number(containers[n].remaining_qty)||c?.quantitySource!=='active_pick'||c?.qty!==Number(containers[n].remaining_qty))violations.push(name+' detail must distinguish own PICK from physical remainder')}
 const cancelled=await http('/sale/'+so.id,undefined,{method:'GET'});assert.equal(cancelled.totalAmount,target*10);assert.equal(cancelled.commercialGroups[0].quantity,target);if(cancelled.commercialGroups[0].dispatch?.activeAllocatedQty!==0||cancelled.commercialGroups[0].dispatch?.outstandingQty!==0||cancelled.commercialGroups[0].dispatch?.confirmedShippedQty!==0)violations.push(name+' cancel withdraws only unconfirmed allocation');assert.equal(cancelled.commercialDispatches[0].active,false)
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
 await http('/sale/'+sale.id+'/cancel',{});const dto=await http('/warehouse-tasks/'+taskId+'/cancel-return-detail',undefined,{method:'GET'});assert.equal(dto.containers[0].qty,10);assert.equal(Object.hasOwn(dto.containers[0],'taskReturnQty'),false);assert.equal(Object.hasOwn(await http('/sale/'+sale.id,undefined,{method:'GET'}),'commercialGroups'),false);assert.equal(await reserveQty(sale.id),0,'ordinary cancellation retains original immediate release policy')
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
 const auth=await issueFixtureAccessToken(pool, f.scopeUserId, {expiresIn:'30m'}),key=randomUUID(),body={taskId,containerId:Number(container.id),barcode:container.barcode,locationId:f.locationId};evidence.returnKey=key
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
 await scope([f.warehouseId]);const precise=await http('/warehouse-tasks/'+taskId+'/cancel-return-detail',undefined,{method:'GET',auth});if(precise.containers[0].taskReturnQty!==1||precise.containers[0].remainingQty!==10)violations.push('task-only scope detail exact PICK1/remainder10');const returned=await http('/scan-logs/cancel-return',body,opts);assert.deepEqual(await http('/scan-logs/cancel-return',body,opts),returned)
 await scope([f.headWarehouseId]);await http('/scan-logs/cancel-return',body,{...opts,expect:403})
 await scope([f.warehouseId,f.headWarehouseId]);await http('/scan-logs/cancel-return',body,{...opts,deviceHeaders:wrong,expect:403})
 await scope([f.warehouseId]);assert.deepEqual(await http('/scan-logs/cancel-return',body,opts),returned);await http('/sale/'+sale.id,undefined,{method:'GET',auth,expect:403})
 const [wt]=await q('SELECT status FROM warehouse_tasks WHERE id=?',[taskId]),[scan]=await q('SELECT COUNT(*) count,SUM(qty) qty FROM scan_logs WHERE task_id=? AND scan_purpose=3',[taskId]),[receipt]=await q('SELECT COUNT(*) count FROM operation_requests WHERE request_key=?',[key]);assert.equal(Number(wt.status),8);assert.equal(Number(scan.count),1);assert.equal(Number(scan.qty),1);assert.equal(Number(receipt.count),1);assert.equal(await reserveQty(sale.id),0);assert.equal(await reserveQty(other.id),100)
 for(const action of ['scan-log.cancel-return','scan-log.cancel-return.'+taskId]){let actual=200;try{const receipt=await http('/system/request-status/'+key+'?action='+action,undefined,{method:'GET',auth});assert.equal(receipt.status,'success');assert.equal(receipt.resourceId,taskId);assert.deepEqual(receipt.data,returned);assert.equal(Object.hasOwn(receipt,'matchedAction'),false)}catch(e){actual=e.status||500}if(actual!==200)violations.push('task-only original receipt '+action+' actual '+actual+' expected 200');console.log('[readonly receipt actual]',JSON.stringify({saleId:sale.id,taskId,userId:f.scopeUserId,action,expected:200,actual}))}
 await scope([f.headWarehouseId]);await http('/system/request-status/'+key+'?action=scan-log.cancel-return',undefined,{method:'GET',auth,expect:403});await scope([f.warehouseId]);
 const wrongReceipt=await http('/system/request-status/'+key+'?action=scan-log.cancel-return.'+(taskId+100000),undefined,{method:'GET',auth});assert.equal(wrongReceipt.status,'not_found');await http('/system/request-status/'+key+'?action=scan-log',undefined,{method:'GET',auth,expect:403});
 // Legacy/scoped/ambiguous/action evidence comes from only this owned receipt;
 // transaction rollback plus operation-read routing lets real HTTP see it without committing faults.
 const proof=await pool.getConnection(),poolQuery=pool.query.bind(pool);
 try{await proof.beginTransaction();const [[ownedReceipt]]=await proof.query('SELECT * FROM operation_requests WHERE request_key=? AND user_id=?',[key,f.scopeUserId]);assert.equal(Number(ownedReceipt.resource_id),taskId);
 pool.query=(sql,...params)=>typeof sql==='string'&&/^\s*SELECT/.test(sql)&&(sql.includes('FROM operation_requests')||sql.includes('FROM warehouse_tasks t JOIN sale_orders s'))?proof.query(sql,...params):poolQuery(sql,...params);
 await proof.query('UPDATE operation_requests SET action=? WHERE id=?',['scan-log.cancel-return',ownedReceipt.id]);
 for(const action of ['scan-log.cancel-return','scan-log.cancel-return.'+taskId]){const receipt=await http('/system/request-status/'+key+'?action='+action,undefined,{method:'GET',auth});assert.equal(receipt.status,'success');assert.equal(receipt.resourceId,taskId);assert.deepEqual(receipt.data,returned)}
 await proof.query('INSERT INTO operation_requests(request_key,action,user_id,status,response_json,resource_type,resource_id) VALUES (?,?,?,?,?,?,?)',[key,'scan-log.cancel-return.'+(taskId+100000),f.scopeUserId,1,ownedReceipt.response_json,'warehouse_task',taskId]);
 // An exact legacy base keeps the existing exact-first matching behavior; use a
 // scoped request that has two resource-identical candidates to test ambiguity.
 const ambiguous=await http('/system/request-status/'+key+'?action=scan-log.cancel-return.'+taskId,undefined,{method:'GET',auth});assert.equal(ambiguous.status,'not_found');
 await http('/system/request-status/'+key+'?action=scan-log.cancel-return.'+(taskId+100000),undefined,{method:'GET',auth,expect:403});
 await proof.query('UPDATE warehouse_tasks SET task_type=? WHERE id=?',['transfer_out',taskId]);await http('/system/request-status/'+key+'?action=scan-log.cancel-return',undefined,{method:'GET',auth,expect:403});await proof.query('UPDATE warehouse_tasks SET task_type=? WHERE id=?',['sale_out',taskId]);
 const otherKey=randomUUID();await proof.query('INSERT INTO operation_requests(request_key,action,user_id,status,response_json,resource_type,resource_id) VALUES (?,?,?,?,?,?,?)',[otherKey,'scan-log.cancel-return-box.'+taskId,f.scopeUserId,1,ownedReceipt.response_json,'warehouse_task',taskId]);await http('/system/request-status/'+otherKey+'?action=scan-log.cancel-return-box.'+taskId,undefined,{method:'GET',auth,expect:403});
 }finally{pool.query=poolQuery;await proof.rollback();proof.release()}
 await q('DELETE FROM sys_role_permissions WHERE role_id=?',[f.scopeRoleId]);const noWritePermission=await http('/system/request-status/'+key+'?action=scan-log.cancel-return',undefined,{method:'GET',auth});assert.equal(noWritePermission.status,'success','own receipt read requires neither business write permission nor PDA device headers');
 const otherUserReceipt=await http('/system/request-status/'+key+'?action=scan-log.cancel-return',undefined,{method:'GET'});assert.equal(otherUserReceipt.status,'not_found','same request key is private to original actor');
 const [identity]=await q('SELECT resource_type,resource_id,user_id FROM operation_requests WHERE request_key=?',[key]);assert.equal(identity.resource_type,'warehouse_task');assert.equal(Number(identity.resource_id),taskId);assert.equal(Number(identity.user_id),f.scopeUserId)
 const [stock]=await q('SELECT quantity,reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',[productId,f.warehouseId]);assert.equal(Number(stock.quantity),10);assert.equal(Number(stock.reserved),1)
 await http('/sale/'+other.id+'/cancel',{});evidence.finalStatus=8
 console.log('[PASS scope] own WT/device WH with SO head outside scope returns201 once while GET SO403; narrowed successful-key replay403; wrong bound device with full actor scope403/no mutation, body cannot override device fact')
}
async function main(){
 let businessError
 const cleanupErrors=[]
 const clean=async(stage,action)=>{try{await action()}catch(error){cleanupErrors.push(new Error(`cleanup ${stage} failed`,{cause:error}))}}
 try{
 const [target]=await q('SELECT DATABASE() name');assert.equal(target.name,process.env.DB_NAME);console.log('[db target]',target.name);
 f.userId=await ins("INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active) VALUES (?,'!',?,1,'测试',1)",[ref,ref]);token=await issueFixtureAccessToken(pool, f.userId, {expiresIn:'30m'})
 f.warehouseId=await ins('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)',[ref,ref]);f.customerId=await ins('INSERT INTO sale_customers(code,name,credit_limit) VALUES (?,?,NULL)',[ref,ref]);f.supplierId=await ins('INSERT INTO supply_suppliers(code,name) VALUES (?,?)',[ref,ref]);f.locationId=await ins('INSERT INTO warehouse_locations(warehouse_id,code,name) VALUES (?,?,?)',[f.warehouseId,ref,ref]);f.binId=await ins('INSERT INTO sorting_bins(warehouse_id,code) VALUES (?,?)',[f.warehouseId,ref])
 const secret=randomUUID();f.deviceId=await ins("INSERT INTO pda_devices(device_code,device_name,warehouse_id,status,secret_hash) VALUES (?,?,?,'active',?)",[ref,ref,f.warehouseId,require('../backend/node_modules/bcryptjs').hashSync(secret,4)])
 const session=await require('../backend/src/modules/pda/pda.sessions.service').createSession({deviceCode:ref,deviceSecret:secret,userId:f.userId});pda={'X-Client':'pda','X-PDA-Session':session.sessionToken}
 server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject)})
 if(process.env.KIT_CANCEL_SLICE!=='scope'){await scenario('single',5,1,[10],[1],1);await scenario('multiple',2,1,[2,3],[1,1],1);await scenario('decimal',3,.1,[1,2],[.1,.2],.1);await scenario('equal',2,1,[2,1],[2],1);await ordinaryScenario()}
 await scopeScenario()
 assert.deepEqual(violations,[],'actual PICK quantities preserve and release exactly each pending container share')
 console.log('[PASS] single reserve5/PICK1/container10, two containers PICK1 each and decimal .1/.2: exact own pending reservations, same-key cancel/return once, other order preserved, WT8/locks0/reserves0, stock unchanged')
}catch(error){
 businessError = error
}finally{
 try{
 const path='/tmp/flowcube-kit-partial-cancel-'+ref+'.json'
 await clean('fixture manifest',()=>fs.writeFileSync(path,JSON.stringify(f,null,2),{mode:0o600}))
 const deviceIds=[f.deviceId,...(f.scopeDeviceIds||[])].filter(Boolean),userIds=[f.userId,f.scopeUserId].filter(Boolean)
 for(const id of deviceIds){
  await clean(`device ${id} sessions`,()=>q('DELETE FROM pda_device_sessions WHERE device_id=?',[id]))
  await clean(`device ${id}`,()=>q('DELETE FROM pda_devices WHERE id=?',[id]))
 }
 if(f.scopeUserId)await clean('actor scope',()=>q('DELETE FROM user_warehouse_scope WHERE user_id=?',[f.scopeUserId]))
 for(const id of userIds)await clean(`actor ${id}`,()=>q('UPDATE sys_users SET is_active=0,token_version=token_version+1 WHERE id=?',[id]))
 if(f.scopeRoleId)await clean('scope role permissions',()=>q('DELETE FROM sys_role_permissions WHERE role_id=?',[f.scopeRoleId]))
 const proof={}
 if(userIds.length)await clean('actor proof',async()=>{const [r]=await q('SELECT COUNT(*) count FROM sys_users WHERE id IN (?) AND is_active=1',[userIds]);proof.activeActors=Number(r.count);assert.equal(proof.activeActors,0)})
 if(deviceIds.length){
  await clean('device proof',async()=>{const [r]=await q('SELECT COUNT(*) count FROM pda_devices WHERE id IN (?)',[deviceIds]);proof.devices=Number(r.count);assert.equal(proof.devices,0)})
  await clean('session proof',async()=>{const [r]=await q('SELECT COUNT(*) count FROM pda_device_sessions WHERE device_id IN (?)',[deviceIds]);proof.sessions=Number(r.count);assert.equal(proof.sessions,0)})
 }
 if(f.scopeUserId)await clean('scope proof',async()=>{const [r]=await q('SELECT COUNT(*) count FROM user_warehouse_scope WHERE user_id=?',[f.scopeUserId]);proof.scopes=Number(r.count);assert.equal(proof.scopes,0)})
 if(f.sales.length){
  await clean('container lock proof',async()=>{const [r]=await q('SELECT COUNT(*) count FROM inventory_containers WHERE locked_by_task_id IN (SELECT id FROM warehouse_tasks WHERE sale_order_id IN (?))',[f.sales]);proof.locks=Number(r.count);assert.equal(proof.locks,0)})
  await clean('reservation proof',async()=>{const [r]=await q("SELECT COALESCE(SUM(qty),0) qty FROM stock_reservations WHERE ref_type='sale_order' AND ref_id IN (?) AND status=1",[f.sales]);proof.reserved=Number(r.qty);assert.equal(proof.reserved,0)})
 }
 if(f.products.length)await clean('stock cache proof',async()=>{const [r]=await q('SELECT COUNT(*) count FROM inventory_stock s WHERE s.product_id IN (?) AND s.quantity <> (SELECT COALESCE(SUM(c.remaining_qty),0) FROM inventory_containers c WHERE c.product_id=s.product_id AND c.warehouse_id=s.warehouse_id AND c.status=1 AND c.deleted_at IS NULL)',[f.products]);proof.stockCacheMismatches=Number(r.count);assert.equal(proof.stockCacheMismatches,0)})
 console.log('[fixtures]',path)
 console.log('[cleanup proof]',JSON.stringify({...proof,verified:cleanupErrors.length===0}))
 }finally{
  try{await clean('server.close',async()=>{if(server)await new Promise((resolve,reject)=>server.close(error => error ? reject(error) : resolve()))})}
  finally{
   try{await clean('session families',()=>cleanupFixtureSessionFamilies(pool))}
   finally{await clean('pool.end',()=>pool.end())}
  }
 }
 const failures=[...cleanupErrors]
 if (businessError) failures.unshift(businessError)
 if(cleanupErrors.length)throw new AggregateError(failures,'Business/cleanup failures; owned audit facts retained')
 if(businessError)throw businessError
 console.log('[cleanup] exact own actor/device closed; transaction evidence retained; pending failed business facts never force-cleared; server/pool closed')
}}
main().catch(e=>{console.error(e);process.exitCode=1})
