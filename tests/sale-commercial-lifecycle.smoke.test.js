'use strict'
// Owned fixtures only. Transactions are retained for audit; no global cleanup or status shortcuts.
const assert = require('node:assert/strict')
require('./helpers/testEnvironment').validateTestEnvironment()
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const { pool } = require('../backend/src/config/db')
const app = require('../backend/src/app')
const ref = `KLC-${randomUUID().slice(0, 8)}`
const fixture = { ref, products: [], kits: [], sales: [] }
let server, token, pdaHeaders={}, ownPrint
const originalSvc=require('../backend/src/modules/sale/sale.service')
const payload=input=>Object.fromEntries(Object.entries(input).filter(([k])=>!['operator','requestKey','scopeWarehouseIds'].includes(k)))
const svc={
 create:input=>http('/sale',payload(input),{expect:201,key:input.requestKey}),
 update:(id,input)=>http(`/sale/${id}`,payload(input),{method:'PUT',key:input.requestKey}),
 requestAdjustment:(id,input)=>http(`/sale/${id}/adjust`,{customerId:fixture.customerId,warehouseId:fixture.warehouseId,...payload(input)},{method:'PUT',key:input.requestKey}),
 reserveStock:(id,op,items,options)=>http(`/sale/${id}/reserve`,{...payload(options),items:items.map(i=>({...i,warehouseName:ref}))},{key:options.requestKey}),
 ship:(id,op,input)=>http(`/sale/${id}/ship`,payload(input),{key:input.requestKey}),
 cancel:(id,op,scope,key,input)=>http(`/sale/${id}/cancel`,input,{key}),
 deleteOrder:(id,op,scope,key,input)=>http(`/sale/${id}`,input,{method:'DELETE',key}),
}
const sourceRead=orderNo=>http(`/returns/sale/source-order?orderNo=${encodeURIComponent(orderNo)}`,undefined,{method:'GET'})
const sourceCreate=input=>http('/returns/sale',{...payload(input),items:input.items.map(i=>Object.fromEntries(['sourceItemId','commercialComponentId','dispatchComponentId','productId','productCode','productName','articleNumber','spec','color','unit','entryUnit','quantity','unitPrice'].filter(k=>i[k]!==undefined).map(k=>[k,i[k]])))},{expect:201,key:input.requestKey})
const operator=()=>({userId:fixture.userId,realName:ref})
const q = async (sql, params = []) => (await pool.query(sql, params))[0]
const insert = async (sql, params) => Number((await q(sql, params)).insertId)
async function http(path, body, { method = 'POST', key = randomUUID(), expect = 200, pda=false, headers={} } = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Request-Key': key,...(pda?pdaHeaders:{}),...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) })
  const json = await response.json()
  if(path==='/finance/accounts'&&response.ok)fixture.account=json.data
  if(response.status!==expect){const error=new Error(`${path}: ${response.status} ${JSON.stringify(json)}`);error.code=json.code;error.status=response.status;throw error}
  return json.data
}
async function main() {
  try {
    fixture.userId = await insert("INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active) VALUES (?,'!',?,1,'测试',1)", [ref, ref])
    token = require('../backend/node_modules/jsonwebtoken').sign({ userId: fixture.userId, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '30m' })
    fixture.warehouseId = await insert('INSERT INTO inventory_warehouses (code,name) VALUES (?,?)', [ref, ref])
    fixture.customerId = await insert('INSERT INTO sale_customers (code,name,credit_limit) VALUES (?,?,NULL)', [ref, ref])
    for (const [name, price] of [['铰链', 80], ['螺钉', 5]]) fixture.products.push(await insert("INSERT INTO product_items (code,name,unit,sale_price_a,cost_price,allow_decimal_qty) VALUES (?,?,'个',?,1,0)", [`${ref}-${fixture.products.length}`, `${ref}-${name}`, price]))
    server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); s.once('error', reject) })
    for (const price of [100, 200]) {
      const kit = await http('/kits', { code: `${ref}-${price}`, name: `${ref}-${price}`, referenceUnitPrice: price, components: fixture.products.map((productId, i) => ({ productId, baseQty: i ? 4 : 1 })) }, { expect: 201 })
      fixture.kits.push(kit)
    }
    const body = { customerId: fixture.customerId, warehouseId: fixture.warehouseId, commercialModel: 'kit-v1', commercialGroups: [
      ...fixture.kits.map((kit, i) => ({ kind: 'kit', lineKey: `K${i}`, kitVersionId: kit.currentVersionId, warehouseId: fixture.warehouseId, quantity: 1, priceSource: 'kit_default' })),
      { kind: 'ordinary', lineKey: 'O', productId: fixture.products[0], warehouseId: fixture.warehouseId, quantity: 1, unitPrice: 30, priceSource: 'manual' },
    ] }
    fixture.locationId=await insert('INSERT INTO warehouse_locations (warehouse_id,code,name) VALUES (?,?,?)',[fixture.warehouseId,ref,ref])
    fixture.supplierId=await insert('INSERT INTO supply_suppliers (code,name) VALUES (?,?)',[ref,ref])
    fixture.binId=await insert('INSERT INTO sorting_bins (warehouse_id,code) VALUES (?,?)',[fixture.warehouseId,ref])
    const secret=randomUUID()
    fixture.deviceId=await insert("INSERT INTO pda_devices (device_code,device_name,warehouse_id,status,secret_hash) VALUES (?,?,?,'active',?)",[ref,ref,fixture.warehouseId,require('../backend/node_modules/bcryptjs').hashSync(secret,4)])
    const session=await require('../backend/src/modules/pda/pda.sessions.service').createSession({deviceCode:ref,deviceSecret:secret,userId:fixture.userId})
    pdaHeaders={'X-Client':'pda','X-PDA-Session':session.sessionToken}
    const printHttp=Object.fromEntries(['get','post','put','delete'].map(method=>[method,async(path,options={})=>{try{const data=await http(path.replace(/^\/api/,''),options.json,{method:method.toUpperCase(),expect:method==='post'&&path==='/api/printers'?201:200,headers:options.headers});return {ok:true,status:200,data:{data}}}catch(e){throw e}}]))
    fixture.printHttp=undefined
    ownPrint=await require('./helpers/ownedPrintFixture').acquireOwnPackageLabelPrinter({http:printHttp,token,warehouseId:fixture.warehouseId,assert,randomRef:()=>ref+randomUUID().slice(0,5)})
    ownPrint.http=printHttp
    const ownPrinter=await http(`/printers/${ownPrint.printerId}`,undefined,{method:'GET'})
    ownPrint.code=ownPrinter.code
    await http('/printers/client-heartbeat',{clientId:ownPrint.clientId,hostname:ref})
    fixture.purchases=[];fixture.containers=[]
    async function supply(quantities){
      const po=await http('/purchase',{supplierId:fixture.supplierId,supplierName:ref,warehouseId:fixture.warehouseId,warehouseName:ref,items:quantities.map(([productId,qty])=>({productId,productCode:`${ref}-${fixture.products.indexOf(productId)}`,productName:ref,unit:'个',quantity:qty,unitPrice:1}))},{expect:201})
      fixture.purchases.push(po.id);await http(`/purchase/${po.id}/confirm`,{})
      const inbound=await http('/inbound-tasks',{poId:po.id},{expect:201});await http(`/inbound-tasks/${inbound.taskId}/submit`,{})
      for(const [productId,qty]of quantities){const received=await http(`/inbound-tasks/${inbound.taskId}/receive`,{productId,packages:productId===fixture.products[1]&&qty===8?[{qty:4},{qty:4}]:productId===fixture.products[0]&&qty===2?[{qty:1},{qty:1}]:[{qty}]},{pda:true});for(const c of received.containers){fixture.containers.push(c.containerId);await http(`/inbound-tasks/${inbound.taskId}/putaway`,{containerId:c.containerId,locationId:fixture.locationId},{pda:true})}}
    }
    async function actualShip(taskId,{beforeShip}={}){
      const task=await http(`/warehouse-tasks/${taskId}`,undefined,{method:'GET'})
      const [bin]=await q('SELECT sorting_bin_id FROM warehouse_tasks WHERE id=?',[taskId])
      if(!bin.sorting_bin_id)await http(`/warehouse-tasks/${taskId}/assign-sorting-bin`,{})
      for(const item of task.items){
        let need=item.requiredQty
        const candidates=await q('SELECT id,barcode,remaining_qty FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND status=1 AND locked_by_task_id IS NULL AND remaining_qty<=? ORDER BY remaining_qty DESC,id',[item.productId,fixture.warehouseId,need])
        for(const c of candidates){const qty=Number(c.remaining_qty);if(qty>need||!need)continue;await http('/scan-logs',{taskId,itemId:item.id,containerId:Number(c.id),barcode:c.barcode,productId:item.productId,qty,scanMode:'整件'},{pda:true,expect:201});need-=qty}
        assert.equal(need,0,'owned whole-container actual pick closes physical demand')
      }
      await http(`/warehouse-tasks/${taskId}/ready`,{},{method:'PUT',pda:true})
      const locked=await q('SELECT id,barcode FROM inventory_containers WHERE locked_by_task_id=? ORDER BY id',[taskId])
      const [[tk]]=await pool.query('SELECT sorting_bin_code FROM warehouse_tasks WHERE id=?',[taskId])
      await http(`/warehouse-tasks/${taskId}/sort-done`,{items:task.items.map(i=>({itemId:i.id,sortedQty:i.requiredQty,binCode:tk.sorting_bin_code}))},{method:'PUT',pda:true})
      for(const c of locked)await http('/scan-logs/check',{taskId,barcode:c.barcode},{pda:true,expect:201})
      for(const item of task.items){const pkg=await http('/packages',{warehouseTaskId:taskId},{pda:true});await http(`/packages/${pkg.id}/add-item`,{productCode:item.productCode,qty:item.requiredQty},{pda:true});await http(`/packages/${pkg.id}/finish`,{},{method:'PUT',pda:true})}
      for(let batch=0;batch<30;batch++){
        const claimed=await http('/print-jobs/claim-client',{clientId:ownPrint.clientId,limit:100})
        const jobs=Array.isArray(claimed)?claimed:claimed.jobs
        assert.ok(Array.isArray(jobs),'claim jobs list')
        if(!jobs.length)break
        for(const job of jobs)await http(`/print-jobs/${job.id}/complete-client`,{clientId:ownPrint.clientId,ackToken:job.ackToken},{headers:{'X-Printer-Code':ownPrint.code}})
      }
      await http(`/warehouse-tasks/${taskId}/pack-done`,{},{method:'PUT',pda:true})
      const shipKey=randomUUID(),send=()=>http(`/warehouse-tasks/${taskId}/ship`,{},{method:'PUT',pda:true,key:shipKey})
      const shipped=beforeShip?await beforeShip(send):await send()
      assert.deepEqual(await http(`/warehouse-tasks/${taskId}/ship`,{},{method:'PUT',pda:true,key:shipKey}),shipped,'same-key real shipment replay')
    }
    if(process.env.KIT_TEST_SLICE==='scope'){
      fixture.otherWarehouseId=await insert('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)',[ref+'-other',ref+'-other'])
      fixture.guardRoleId=await insert('INSERT INTO sys_roles(code,name,is_system) VALUES (?,?,0)',[ref+'-scope',ref+'-scope'])
      await q('INSERT INTO sys_role_permissions(role_id,permission) VALUES ?',[['sale.order.create','sale.order.update','sale.order.cancel','sale.order.view'].map(p=>[fixture.guardRoleId,p])])
      const inWh=warehouseId=>({...body,warehouseId,commercialGroups:[{...body.commercialGroups[0],warehouseId}]})
      const denied=[],statuses=[]
      const shrink=async()=>{await q('UPDATE sys_users SET role_id=? WHERE id=?',[fixture.guardRoleId,fixture.userId]);await q('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES (?,?)',[fixture.userId,fixture.warehouseId])}
      const restore=async()=>{await q('DELETE FROM user_warehouse_scope WHERE user_id=?',[fixture.userId]);await q('UPDATE sys_users SET role_id=1 WHERE id=?',[fixture.userId])}
      const status=async(path,input,{method='POST',key=randomUUID()}={})=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Request-Key':key},...(input===undefined?{}:{body:JSON.stringify(input)})});const json=await r.json();console.log('[scope case]',path,r.status,json.code||'');return r.status}
      try{
        const s=await http('/sale',inWh(fixture.otherWarehouseId),{expect:201});fixture.sales.push(s.id)
        const updated={...inWh(fixture.warehouseId),expectedRevision:1},key=randomUUID()
        await http(`/sale/${s.id}`,updated,{method:'PUT',key});await http(`/sale/${s.id}`,updated,{method:'PUT',key})
        const current=await http(`/sale/${s.id}`,undefined,{method:'GET'});assert.ok(current.items.some(i=>i.warehouseId===fixture.otherWarehouseId&&i.quantity===0));assert.equal(current.commercialRevision,2)
        await shrink()
        denied.push(await status(`/system/request-status/${key}?action=sale.update.${s.id}`,undefined,{method:'GET'}))
        statuses.push(await status(`/sale/${s.id}`,updated,{method:'PUT',key}))
        statuses.push(await status(`/sale/${s.id}`,{...updated,expectedRevision:2,remark:ref+'-must-refuse'},{method:'PUT'}))
        await restore();const [unchanged]=await q('SELECT commercial_revision,remark FROM sale_orders WHERE id=?',[s.id]);assert.equal(Number(unchanged.commercial_revision),2);assert.equal(unchanged.remark,null)
        const createKey=randomUUID(),created=await http('/sale',inWh(fixture.warehouseId),{expect:201,key:createKey});fixture.sales.push(created.id)
        await http(`/sale/${created.id}`,{...inWh(fixture.otherWarehouseId),expectedRevision:1},{method:'PUT'})
        assert.deepEqual(await http('/sale',inWh(fixture.warehouseId),{expect:201,key:createKey}),created,'fully authorized changed-resource create replay')
        await shrink();denied.push(await status(`/system/request-status/${createKey}?action=sale.create`,undefined,{method:'GET'}));statuses.push(await status('/sale',inWh(fixture.warehouseId),{key:createKey}));await restore()
        const ordinaryBody={customerId:fixture.customerId,customerName:ref,warehouseId:fixture.warehouseId,warehouseName:ref,items:[{productId:fixture.products[0],productCode:ref+'-0',productName:ref,unit:'个',quantity:1,unitPrice:80,priceSource:'manual'}]},ordinaryKey=randomUUID()
        const ordinary=await http('/sale',ordinaryBody,{expect:201,key:ordinaryKey});fixture.sales.push(ordinary.id)
        await http(`/sale/${ordinary.id}`,{...ordinaryBody,warehouseId:fixture.otherWarehouseId},{method:'PUT'})
        await shrink();assert.deepEqual(await http('/sale',ordinaryBody,{expect:201,key:ordinaryKey}),ordinary,'ordinary original creation replay policy');await restore();await http(`/sale/${ordinary.id}/cancel`,{})
      }finally{await restore()}
      assert.deepEqual(denied,[403,403]);assert.deepEqual(statuses,[403,403,403])
      console.log('[PASS] current saved physical warehouses including zero rows authorize kit update old/new keys and create replay; full-scope replay succeeds, ordinary original create replay unchanged')
      return
    }
    const key = randomUUID()
    const create=()=>svc.create({...body,operator:{userId:fixture.userId,realName:ref},requestKey:key})
    const sale = await create(); fixture.sales.push(sale.id)
    assert.deepEqual(await create(),sale,'same-key create replays original')
    const detail = await http(`/sale/${sale.id}`, undefined, { method: 'GET' })
    assert.equal(detail.commercialModel, 'kit-v1')
    assert.equal(detail.totalAmount, 330)
    assert.equal(detail.commercialGroups.length, 3)
    assert.deepEqual(detail.physicalItems.map(i => [i.productId, i.quantity]), [[fixture.products[0], 3], [fixture.products[1], 8]])
    assert.equal(new Set(detail.commercialGroups.flatMap(g => g.components.map(c => c.saleItemId))).size, 2)
    if(process.env.KIT_TEST_SLICE!=='gates'){
    const marker={commercialModel:'kit-v1',expectedRevision:1}
    for(const [path,input,method] of [['/sale',body,'POST'],[`/sale/${sale.id}`,{...body,...marker},'PUT'],[`/sale/${sale.id}/adjust`,{...body,...marker},'PUT'],[`/sale/${sale.id}/reserve`,marker,'POST'],[`/sale/${sale.id}/release`,marker,'POST'],[`/sale/${sale.id}/ship`,{...marker,groups:[{groupId:detail.commercialGroups[0].id,qty:1}]},'POST'],[`/sale/${sale.id}/cancel`,marker,'POST'],[`/sale/${sale.id}`,marker,'DELETE'],['/returns/sale',{customerId:fixture.customerId,customerName:ref,warehouseId:fixture.warehouseId,warehouseName:ref,saleOrderId:sale.id,saleOrderNo:sale.orderNo,...marker,items:[{sourceItemId:detail.items[0].id,commercialComponentId:detail.commercialGroups[0].components[0].id,dispatchComponentId:1,productId:fixture.products[0],productCode:ref+'-0',productName:ref,unit:'个',quantity:1,unitPrice:80}]},'POST']]){
      const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Request-Key':''},body:JSON.stringify(input)});const j=await r.json();assert.equal(r.status,400);assert.equal(j.code,'SALE_COMMERCIAL_REQUEST_KEY_REQUIRED')
    }
    await http(`/sale/${sale.id}/reserve`,{},{expect:400})
    await http(`/sale/${sale.id}/ship`,{items:[{id:detail.items[0].id,qty:1}]},{expect:400})
    await http('/sale',{...body,items:[]},{expect:400})
    await http('/sale',{...body,commercialModel:'unknown'},{expect:400})
    const editSale=await svc.create({...body,operator:operator(),requestKey:randomUUID()});fixture.sales.push(editSale.id)
    const editDetail=await http(`/sale/${editSale.id}`,undefined,{method:'GET'})
    const edited={...body,expectedRevision:1,receiverName:'R',remark:ref},updateKey=randomUUID()
    await http(`/sale/${editSale.id}`,edited,{method:'PUT',key:updateKey})
    await http(`/sale/${editSale.id}`,edited,{method:'PUT',key:updateKey})
    await http(`/sale/${editSale.id}`,edited,{method:'PUT',expect:409})
    const editedDetail=await http(`/sale/${editSale.id}`,undefined,{method:'GET'});assert.equal(editedDetail.commercialRevision,2);assert.equal(editedDetail.receiverName,'R');assert.equal(editedDetail.remark,ref);assert.deepEqual(editedDetail.items.map(i=>i.id),editDetail.items.map(i=>i.id))
    // Keep the main shipment scenario on its original expected revision by using
    // a separate owned draft for actual update tests instead of mutating this order.
    console.log('[PASS] all kit HTTP write actions require stable keys; oldclient/unknown/mixed DTO refuse; draft update freezes IDs, persists headers, oldrevision same-key replays and newkey stale409')
    const updateReceipt=await http(`/system/request-status/${updateKey}?action=sale.update.${editSale.id}`,undefined,{method:'GET'});assert.equal(Number(updateReceipt.resourceId),editSale.id)
    fixture.guardRoleId=await insert('INSERT INTO sys_roles (code,name,is_system) VALUES (?,?,0)',[ref+'-guard',ref+'-guard'])
    await q('INSERT INTO sys_role_permissions (role_id,permission) VALUES (?,?)',[fixture.guardRoleId,'sale.order.update'])
    fixture.otherWarehouseId=await insert('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)',[ref+'-other',ref+'-other'])
    try{
      await q('UPDATE sys_users SET role_id=? WHERE id=?',[fixture.guardRoleId,fixture.userId]);await q('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES (?,?)',[fixture.userId,fixture.otherWarehouseId])
      await http(`/system/request-status/${updateKey}?action=sale.update.${editSale.id}`,undefined,{method:'GET',expect:403})
      await http(`/sale/${editSale.id}`,edited,{method:'PUT',key:updateKey,expect:403})
    }finally{await q('DELETE FROM user_warehouse_scope WHERE user_id=?',[fixture.userId]);await q('UPDATE sys_users SET role_id=1 WHERE id=?',[fixture.userId])}
    const faultyKey=randomUUID(),getConnection=pool.getConnection.bind(pool);let failed=false
    pool.getConnection=async(...args)=>{const connection=await getConnection(...args),query=connection.query.bind(connection);let owned=false;connection.query=async(sql,params)=>{if(typeof sql==='string'&&sql.includes('INSERT INTO operation_requests')&&params?.includes(faultyKey))owned=true;if(owned&&!failed&&typeof sql==='string'&&sql.includes('UPDATE operation_requests')){failed=true;throw new Error('owned HTTP receipt completion fault')}return query(sql,params)};return connection}
    const beforeFault=(await q('SELECT COUNT(*) count FROM sale_orders WHERE customer_id=?',[fixture.customerId]))[0].count
    try{await http('/sale',body,{key:faultyKey,expect:500})}finally{pool.getConnection=getConnection}
    assert.equal(failed,true);assert.equal(Number((await q('SELECT COUNT(*) count FROM sale_orders WHERE customer_id=?',[fixture.customerId]))[0].count),Number(beforeFault))
    const recovered=await http('/sale',body,{key:faultyKey,expect:201});fixture.sales.push(recovered.id);assert.deepEqual(await http('/sale',body,{key:faultyKey,expect:201}),recovered)
    const [recoveredGroups]=await q('SELECT COUNT(*) count FROM sale_commercial_groups WHERE order_id=?',[recovered.id]);assert.equal(Number(recoveredGroups.count),3)
    console.log('[PASS] same-user resource receipt/update replay re-check changed warehouse scope; real HTTP receipt UPDATE fault rolls order/groups/physical facts back, original-key retry commits one order')
    if(process.env.KIT_TEST_SLICE==='guards')return
    const pendingProducts=[]
    for(let n=0;n<2;n++){const id=await insert("INSERT INTO product_items(code,name,unit,sale_price_a,cost_price,allow_decimal_qty) VALUES (?,?,'个',5,1,0)",[ref+'-adjust-'+n,ref+'-adjust-'+n]);pendingProducts.push(id);fixture.products.push(id)}
    const pendingKit=await http('/kits',{code:ref+'-adjust',name:ref+'-adjust',referenceUnitPrice:10,components:pendingProducts.map(productId=>({productId,baseQty:1}))},{expect:201})
    const pendingGroup={kind:'kit',lineKey:'PENDING',kitVersionId:pendingKit.currentVersionId,quantity:2,warehouseId:fixture.warehouseId,priceSource:'kit_default'}
    const pendingSale=await svc.create({...body,commercialGroups:[pendingGroup],operator:operator(),requestKey:randomUUID()});fixture.sales.push(pendingSale.id)
    await supply(pendingProducts.map(id=>[id,2]));const pendingBefore=await http(`/sale/${pendingSale.id}`,undefined,{method:'GET'})
    await svc.reserveStock(pendingSale.id,operator(),pendingBefore.items.map(i=>({id:i.id,warehouseId:fixture.warehouseId,qty:2})),{commercialModel:'kit-v1',expectedRevision:1,requestKey:randomUUID()})
    const pendingWT=(await svc.ship(pendingSale.id,operator(),{commercialModel:'kit-v1',expectedRevision:1,groups:[{groupId:pendingBefore.commercialGroups[0].id,qty:2}],requestKey:randomUUID()})).tasks[0].taskId
    const beforeWT=await http(`/warehouse-tasks/${pendingWT}`,undefined,{method:'GET'})
    for(const item of beforeWT.items){const [c]=await q('SELECT id,barcode FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND status=1 AND locked_by_task_id IS NULL ORDER BY id',[item.productId,fixture.warehouseId]);await http('/scan-logs',{taskId:pendingWT,itemId:item.id,containerId:Number(c.id),barcode:c.barcode,productId:item.productId,qty:2,scanMode:'整件'},{pda:true,expect:201})}
    await assert.rejects(svc.requestAdjustment(pendingSale.id,{...body,commercialGroups:[{...pendingGroup,quantity:1}],expectedRevision:1,receiverName:'must not disappear',requestKey:randomUUID()}),e=>e.code==='SALE_ADJUSTMENT_HEADER_READ_ONLY')
    const pending=await svc.requestAdjustment(pendingSale.id,{commercialModel:'kit-v1',commercialGroups:[{...pendingGroup,quantity:1}],expectedRevision:1,requestKey:randomUUID()});assert.equal(pending.pending,true)
    const pendingDetail=await http(`/sale/${pendingSale.id}`,undefined,{method:'GET'});assert.deepEqual(pendingDetail.items.map(i=>i.id),pendingBefore.items.map(i=>i.id));assert.deepEqual(pendingDetail.items.map(i=>i.reservedQty),[2,2])
    await assert.rejects(svc.ship(pendingSale.id,operator(),{commercialModel:'kit-v1',expectedRevision:2,groups:[{groupId:pendingDetail.commercialGroups[0].id,qty:1}],requestKey:randomUUID()}),e=>e.code==='SALE_COMMERCIAL_PENDING')
    await http(`/warehouse-tasks/${pendingWT}/ship`,{},{pda:true,method:'PUT',expect:409})
    const adjustment=await http(`/warehouse-tasks/adjustments/${pending.adjustmentId}`,undefined,{method:'GET'})
    for(const row of adjustment.items.flatMap(i=>i.containerReturns))await http(`/warehouse-tasks/adjustments/container-returns/${row.id}/confirm`,{targetLocationId:fixture.locationId},{pda:true})
    const cleared=await http(`/sale/${pendingSale.id}`,undefined,{method:'GET'});assert.deepEqual(cleared.items.map(i=>i.quantity),[1,1]);assert.deepEqual(cleared.items.map(i=>i.reservedQty),[1,1])
    const [clearedWT]=await q('SELECT adjustment_requested_at FROM warehouse_tasks WHERE id=?',[pendingWT]);assert.equal(clearedWT.adjustment_requested_at,null)
    const actualVector=await q('SELECT required_qty,picked_qty FROM warehouse_task_items WHERE task_id=? ORDER BY id',[pendingWT]);assert.deepEqual(actualVector.map(i=>[Number(i.required_qty),Number(i.picked_qty)]),[[1,1],[1,1]])
    await svc.cancel(pendingSale.id,operator(),null,randomUUID(),{commercialModel:'kit-v1',expectedRevision:2})
    const pendingCancel=await http(`/warehouse-tasks/${pendingWT}/cancel-return-detail`,undefined,{method:'GET'});for(const c of pendingCancel.containers)await http('/scan-logs/cancel-return',{taskId:pendingWT,containerId:c.containerId,barcode:c.barcode,locationId:fixture.locationId},{pda:true,expect:201})
    console.log('[PASS] real picked2 -> kit reduction1 stays reserved2 and blocks new dispatch/ship; actual PDA adjustment return clears physical vector1/reserved1 with IDs intact; changed headers refuse')
    if(process.env.KIT_TEST_SLICE==='adjust')return

    const zeroPreview=await http('/kits/preview',{customerId:fixture.customerId,warehouseId:fixture.warehouseId,groups:[{...body.commercialGroups[0],warehouseId:undefined,priceSource:'manual',unitPrice:0}]})
    assert.equal(zeroPreview.amount,0,'zero reference/manual quote remains a readonly preview capability')
    await assert.rejects(svc.create({...body,commercialGroups:[{...body.commercialGroups[0],priceSource:'manual',unitPrice:0}],operator:operator(),requestKey:randomUUID()}),e=>e.code==='SALE_PRICE_REQUIRED')
    const changed=await http(`/kits/${fixture.kits[0].id}`,{revision:1,isActive:false},{method:'PUT'})
    const savedPreview=await http(`/sale/${sale.id}/commercial-preview`,{...body,expectedRevision:1})
    assert.equal(savedPreview.amount,330,'saved unchanged disabled kit retains version/quote basis')
    fixture.previewRoleId=await insert('INSERT INTO sys_roles (code,name,is_system) VALUES (?,?,0)',[ref+'-preview',ref+'-preview'])
    await q('INSERT INTO sys_role_permissions (role_id,permission) VALUES ?',[[[fixture.previewRoleId,'sale.order.update'],[fixture.previewRoleId,'product.view']]])
    fixture.previewUserId=await insert("INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active) VALUES (?,'!',?,?,?,1)",[ref+'-preview',ref,fixture.previewRoleId,ref])
    const previewToken=require('../backend/node_modules/jsonwebtoken').sign({userId:fixture.previewUserId,tokenVersion:0},process.env.JWT_SECRET,{expiresIn:'30m'})
    const previewHeaders={Authorization:`Bearer ${previewToken}`}
    assert.equal((await http(`/sale/${sale.id}/commercial-preview`,{...body,expectedRevision:1},{headers:previewHeaders})).amount,330,'update-only editor can preview saved disabled kit without create permission')
    await http('/kits/preview',{customerId:fixture.customerId,warehouseId:fixture.warehouseId,groups:[{...body.commercialGroups[0],warehouseId:undefined}]},{headers:previewHeaders,expect:403})
    await http(`/kits/${fixture.kits[0].id}`,{revision:changed.revision,isActive:true},{method:'PUT'})
    console.log('[PASS] kit-v1 create persists three commercial groups, two stable physical rows, exact 330 and same-key replay')
    }
    await supply([[fixture.products[0],1],[fixture.products[1],8]])
    const items=detail.physicalItems
    const reserveKey=randomUUID()
    await svc.reserveStock(sale.id,operator(),items.map(i=>({id:i.id,warehouseId:fixture.warehouseId,qty:i.productId===fixture.products[0]?1:8})),{commercialModel:'kit-v1',expectedRevision:1,requestKey:reserveKey})
    await svc.reserveStock(sale.id,operator(),[],{commercialModel:'kit-v1',expectedRevision:1,requestKey:reserveKey})
    await assert.rejects(svc.ship(sale.id,operator(),{commercialModel:'kit-v1',expectedRevision:1,groups:detail.commercialGroups.filter(g=>g.kind==='kit').map(g=>({groupId:g.id,qty:1})),requestKey:randomUUID()}))
    const dispatchKey=randomUUID(),a=detail.commercialGroups[0]
    const dispatched=await svc.ship(sale.id,operator(),{commercialModel:'kit-v1',expectedRevision:1,groups:[{groupId:a.id,qty:1}],requestKey:dispatchKey})
    const replay=await svc.ship(sale.id,operator(),{commercialModel:'kit-v1',expectedRevision:1,groups:[{groupId:a.id,qty:1}],requestKey:dispatchKey})
    const current=await http(`/sale/${sale.id}`,undefined,{method:'GET'});fixture.taskId=current.tasks[0].taskId
    assert.equal(current.tasks.length,1,'dispatch replay never adds a task')
    await actualShip(fixture.taskId)
    const [ar]=await q('SELECT total_amount FROM payment_records WHERE type=2 AND order_id=?',[sale.id]);assert.equal(Number(ar.total_amount),100,'A real shipment gross must be 100, never shared average')
    const facts=await require('../backend/src/modules/accounting/voucher-sale-periods').loadSaleShipmentFacts(pool)
    const filtered={orders:facts.orders.filter(o=>Number(o.soId)===sale.id),items:facts.items.filter(i=>Number(i.order_id)===sale.id),shipments:facts.shipments.filter(t=>Number(t.soId)===sale.id)}
    const specs=require('../backend/src/modules/accounting/voucher-sale-periods').projectSaleShipments(filtered)
    assert.equal(specs.find(s=>s.sourceType==='sale_revenue').legs[0].amount,'100.00')
    assert.equal(specs.find(s=>s.sourceType==='sale_cogs').legs[0].amount,'5.00')
    console.log('[PASS] real purchase/PDA stock -> one complete A dispatch -> pick/sort/check/pack/client ack/ship; AR/revenue100/cost5, all idempotent')
    if(process.env.KIT_TEST_SLICE==='gates'){
      const rtSvc=require('../backend/src/modules/return-tasks/return-tasks.service')
      fixture.returns=[]
      async function makeReturn(order,legacy=false){
        const sources=await sourceRead(order.orderNo)
        const input={customerId:fixture.customerId,customerName:ref,warehouseId:fixture.warehouseId,warehouseName:ref,saleOrderId:order.id,saleOrderNo:order.orderNo,items:sources.items.map(i=>({...i,quantity:i.remainingQty})),...(!legacy?{commercialModel:'kit-v1',expectedRevision:1}:{})}
        const sr=legacy?await http('/returns/sale',{...input,items:input.items.map(i=>({sourceItemId:i.sourceItemId,productId:i.productId,productCode:i.productCode,productName:i.productName,unit:i.unit,quantity:i.quantity,unitPrice:i.unitPrice}))},{expect:201}):await sourceCreate(input)
        await http(`/returns/sale/${sr.id}/confirm`,{})
        const taskId=(await http(`/returns/sale/${sr.id}`,undefined,{method:'GET'})).task.id
        fixture.returns.push({saleId:order.id,returnId:sr.id,taskId,legacy})
        for(const i of sources.items)await http(`/return-tasks/${taskId}/receive`,{productId:i.productId,packages:[{qty:i.remainingQty}]},{pda:true})
        return {srId:sr.id,taskId,sources:sources.items}
      }
      async function serialWithOldSnapshot(rt,method,args,kit){
        const a=await pool.getConnection(),b=await pool.getConnection()
        let pending,originalQuery,timeout
        try{
          await a.beginTransaction();await b.beginTransaction()
          await b.query('SELECT id,received_qty,checked_qty,putaway_qty FROM return_task_items WHERE task_id=?',[rt.taskId])
          if(kit)await require('../backend/src/modules/sale/sale.commercial-returns').lockExecution(a,rt.taskId)
          else await a.query('SELECT id FROM return_tasks WHERE id=? FOR UPDATE',[rt.taskId])
          let queued;const waits=new Promise(resolve=>{queued=resolve});originalQuery=b.query.bind(b)
          b.query=(sql,...values)=>{if(kit?sql.includes('sale_dispatch_component_money')&&sql.includes('FOR UPDATE'):sql.includes('FROM return_tasks')&&sql.includes('FOR UPDATE'))queued();return originalQuery(sql,...values)}
          const op=n=>({userId:fixture.userId,pdaWarehouseId:fixture.warehouseId,scopeWarehouseIds:null,requestKey:randomUUID(),...args[n]})
          pending=(async()=>{try{const result=await rtSvc[method](b,rt.taskId,op(1));await b.commit();return result}catch(e){await b.rollback();throw e}})()
          await Promise.race([waits,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('owned second transaction did not queue at source/task lock')),5000)})])
          await rtSvc[method](a,rt.taskId,op(0));await a.commit();await pending
        }finally{clearTimeout(timeout);if(originalQuery)b.query=originalQuery;await a.rollback();await b.rollback();a.release();b.release()}
      }
      async function completeReturn(rt,kit,{reject=false,concurrentQA=false}={}){
        const qa=rt.sources.map(i=>({productId:i.productId,passedQty:reject?0:i.remainingQty,rejectedQty:reject?i.remainingQty:0}))
        if(concurrentQA)await serialWithOldSnapshot(rt,'check',qa,kit)
        else for(const args of qa)await http(`/return-tasks/${rt.taskId}/check`,args,{pda:true})
        const [qaStatus]=await q('SELECT status FROM return_tasks WHERE id=?',[rt.taskId]);console.log('[gate QA]',rt.taskId,Number(qaStatus.status));assert.equal(Number(qaStatus.status),reject?5:4,'last QA uses complete current RTI facts after waiting')
        if(!reject){
          const containers=await q("SELECT id FROM inventory_containers WHERE source_ref_type='sale_return' AND source_ref_id=? AND status=4 ORDER BY product_id",[rt.taskId])
          assert.equal(containers.length,2)
          await serialWithOldSnapshot(rt,'putaway',containers.map(c=>({containerId:Number(c.id),locationId:fixture.locationId})),kit)
        }
        const [task]=await q('SELECT status FROM return_tasks WHERE id=?',[rt.taskId]),[sr]=await q('SELECT status,total_amount FROM sale_returns WHERE id=?',[rt.srId]);const items=await q('SELECT received_qty,checked_qty,rejected_qty,putaway_qty FROM return_task_items WHERE task_id=? ORDER BY id',[rt.taskId])
        console.log('[gate actual]',JSON.stringify({taskId:rt.taskId,taskStatus:Number(task.status),returnStatus:Number(sr.status),items}))
        assert.equal(Number(task.status),5);assert.equal(Number(sr.status),3)
        for(const i of items){assert.equal(Number(i.checked_qty),Number(i.received_qty));assert.equal(Number(i.putaway_qty),Number(i.checked_qty)-Number(i.rejected_qty))}
        if(kit){const [proof]=await q('SELECT COUNT(*) count,SUM(refund_amount) gross FROM sale_commercial_refund_receipts WHERE return_item_id IN (SELECT id FROM sale_return_items WHERE return_id=?)',[rt.srId]);assert.equal(Number(proof.count),2);assert.equal(Number(proof.gross),reject?0:100)}
      }
      const rt=await makeReturn(sale)
      await completeReturn(rt,true,{concurrentQA:process.env.KIT_GATE_PHASE==='qa'})
      const [kitAR]=await q('SELECT total_amount FROM payment_records WHERE type=2 AND order_id=?',[sale.id]);assert.equal(Number(kitAR.total_amount),0)
      const v=(await require('../backend/src/modules/accounting/voucher-engine').buildSaleReturn(pool)).find(v=>v.sourceId===rt.srId);assert.equal(v.legs.find(l=>l.code==='1122').amount,100)
      const ordinaryBody={customerId:fixture.customerId,customerName:ref,warehouseId:fixture.warehouseId,warehouseName:ref,items:fixture.products.slice(0,2).map((productId,n)=>({productId,productCode:ref+'-'+n,productName:ref,unit:'个',quantity:n?4:1,unitPrice:n?5:80,priceSource:'manual'}))}
      const ordinary=await http('/sale',ordinaryBody,{expect:201});fixture.sales.push(ordinary.id);const od=await http(`/sale/${ordinary.id}`,undefined,{method:'GET'});await http(`/sale/${ordinary.id}/reserve`,{items:od.items.map(i=>({id:i.id,warehouseId:fixture.warehouseId,warehouseName:ref,qty:i.quantity}))});await http(`/sale/${ordinary.id}/ship`,{items:od.items.map(i=>({id:i.id,qty:i.quantity}))});const [ow]=await q('SELECT id FROM warehouse_tasks WHERE sale_order_id=?',[ordinary.id]);await actualShip(Number(ow.id))
      const ordinaryRT=await makeReturn(ordinary,true);await completeReturn(ordinaryRT,false,{concurrentQA:true});const [ordinaryAR]=await q('SELECT total_amount FROM payment_records WHERE type=2 AND order_id=?',[ordinary.id]);assert.equal(Number(ordinaryAR.total_amount),0)
      const rejectedSale=await svc.create({...body,commercialGroups:[body.commercialGroups[0]],requestKey:randomUUID()});fixture.sales.push(rejectedSale.id);const rd=await http(`/sale/${rejectedSale.id}`,undefined,{method:'GET'});await svc.reserveStock(rejectedSale.id,operator(),rd.items.map(i=>({id:i.id,warehouseId:fixture.warehouseId,qty:i.quantity})),{commercialModel:'kit-v1',expectedRevision:1,requestKey:randomUUID()});const rw=await svc.ship(rejectedSale.id,operator(),{commercialModel:'kit-v1',expectedRevision:1,groups:[{groupId:rd.commercialGroups[0].id,qty:1}],requestKey:randomUUID()});await actualShip(rw.tasks[0].taskId)
      const rejectedRT=await makeReturn(rejectedSale);await completeReturn(rejectedRT,true,{reject:true,concurrentQA:true});const [rejectedAR]=await q('SELECT total_amount FROM payment_records WHERE type=2 AND order_id=?',[rejectedSale.id]);assert.equal(Number(rejectedAR.total_amount),100)
      console.log('[PASS] old RR snapshot before source/task wait: multi-component kit and ordinary QA/putaway close actual RT5/SR3; kit receipts100/AR0/voucher100, all-reject two-component kit completes zero/AR100; single attempt no state edits')
      return
    }
    await svc.cancel(sale.id,operator(),null,randomUUID(),{commercialModel:'kit-v1',expectedRevision:1})
    const closed=await http(`/sale/${sale.id}`,undefined,{method:'GET'})
    assert.equal(closed.totalAmount,100);assert.equal(closed.commercialRevision,2)
    assert.deepEqual(closed.physicalItems.map(i=>i.id),items.map(i=>i.id),'closing keeps stable physical IDs')
    assert.deepEqual(closed.commercialGroups.map(g=>g.originalAmount),[100,200,30],'original budgets never overwritten')
    console.log('[PASS] closing remainder projects only actual A100 and retains original 330 snapshots/physical IDs')
    const source=await sourceRead(sale.orderNo)
    assert.equal(source.items.length,2,'only real A shipment is returnable')
    const hinge=source.items.find(i=>i.productId===fixture.products[0]);assert.equal(hinge.sourceBudgetAmount,80)
    const ret=await sourceCreate({customerId:fixture.customerId,customerName:ref,warehouseId:fixture.warehouseId,warehouseName:ref,saleOrderId:sale.id,saleOrderNo:sale.orderNo,commercialModel:'kit-v1',expectedRevision:2,items:[{...hinge,quantity:1}],operator:operator(),requestKey:randomUUID()})
    fixture.returnId=ret.id;await http(`/returns/sale/${ret.id}/confirm`,{})
    const returnDetail=await http(`/returns/sale/${ret.id}`,undefined,{method:'GET'})
    const rt=returnDetail.task.id
    const receive=await http(`/return-tasks/${rt}/receive`,{productId:hinge.productId,packages:[{qty:1}]},{pda:true})
    const qa=await http(`/return-tasks/${rt}/check`,{productId:hinge.productId,passedQty:1,rejectedQty:0},{pda:true})
    const [returned]=await q("SELECT id FROM inventory_containers WHERE source_ref_type='sale_return' AND source_ref_id=? AND status=4",[rt])
    await http(`/return-tasks/${rt}/putaway`,{containerId:Number(returned.id),locationId:fixture.locationId},{pda:true})
    const [arAfter]=await q('SELECT total_amount FROM payment_records WHERE type=2 AND order_id=?',[sale.id]);assert.equal(Number(arAfter.total_amount),20,'qualified source hinge refunds80, never physical average120')
    const [sr]=await q('SELECT total_amount,status FROM sale_returns WHERE id=?',[ret.id]);assert.equal(Number(sr.total_amount),80);assert.equal(Number(sr.status),3)
    console.log('[PASS] real source hinge A return receive/QA/putaway freezes80, AR20, no unshipped B source')

    const centKit=await http('/kits',{code:ref+'-cent',name:ref+'-cent',referenceUnitPrice:0.01,components:[{productId:fixture.products[0],baseQty:3}]},{expect:201})
    const centSale=await svc.create({customerId:fixture.customerId,warehouseId:fixture.warehouseId,commercialModel:'kit-v1',commercialGroups:[{kind:'kit',lineKey:'C',kitVersionId:centKit.currentVersionId,warehouseId:fixture.warehouseId,quantity:1,priceSource:'kit_default'}],operator:operator(),requestKey:randomUUID()});fixture.sales.push(centSale.id)
    await supply([[fixture.products[0],3]])
    const centDetail=await http(`/sale/${centSale.id}`,undefined,{method:'GET'})
    await svc.reserveStock(centSale.id,operator(),centDetail.physicalItems.map(i=>({id:i.id,warehouseId:fixture.warehouseId,qty:i.quantity})),{commercialModel:'kit-v1',expectedRevision:1,requestKey:randomUUID()})
    const centDispatch=await svc.ship(centSale.id,operator(),{commercialModel:'kit-v1',expectedRevision:1,groups:[{groupId:centDetail.commercialGroups[0].id,qty:1}],requestKey:randomUUID()})
    await actualShip(centDispatch.tasks[0].taskId)
    const [centAR]=await q('SELECT id FROM payment_records WHERE type=2 AND order_id=?',[centSale.id])
    fixture.account=await http('/finance/accounts',{name:ref,type:2,openingBalance:0},{expect:201})
    const today=require('../backend/src/utils/backendTime').beijingTodayYmd()
    await http('/payments/receipts',{type:2,partyName:ref,amount:0.01,paymentDate:today,accountId:fixture.account.id,allocations:[{recordId:Number(centAR.id),amount:0.01}]},{expect:201})
    let paidCent=true
    const centSource=(await sourceRead(centSale.orderNo)).items[0]
    async function prepareCentReturn(){
      const sr=await sourceCreate({customerId:fixture.customerId,customerName:ref,warehouseId:fixture.warehouseId,warehouseName:ref,saleOrderId:centSale.id,saleOrderNo:centSale.orderNo,commercialModel:'kit-v1',expectedRevision:1,items:[{...centSource,quantity:1}],operator:operator(),requestKey:randomUUID()})
      const [draft]=await q('SELECT total_amount FROM sale_returns WHERE id=?',[sr.id]);assert.equal(Number(draft.total_amount),0.01,'draft ceiling never silently skips one-cent confirmation headroom')
      if(paidCent){
        await http(`/returns/sale/${sr.id}/confirm`,{},{expect:409})
        const refund=await http('/refunds',{saleOrderId:centSale.id,amount:0.01,accountId:fixture.account.id,refundDate:today,remark:ref})
        await http(`/refunds/${refund.id}/submit`,{});await http(`/refunds/${refund.id}/execute`,{})
        paidCent=false
      }
      await http(`/returns/sale/${sr.id}/confirm`,{})
      const rt=(await http(`/returns/sale/${sr.id}`,undefined,{method:'GET'})).task.id
      await http(`/return-tasks/${rt}/receive`,{productId:centSource.productId,packages:[{qty:1}]},{pda:true})
      await http(`/return-tasks/${rt}/check`,{productId:centSource.productId,passedQty:1,rejectedQty:0},{pda:true})
      const [container]=await q("SELECT id FROM inventory_containers WHERE source_ref_type='sale_return' AND source_ref_id=? AND status=4",[rt])
      return {srId:sr.id,taskId:rt,containerId:Number(container.id),key:randomUUID()}
    }
    const partials=[await prepareCentReturn(),await prepareCentReturn(),await prepareCentReturn()]
    const rtSvc=require('../backend/src/modules/return-tasks/return-tasks.service')
    const blocker=await pool.getConnection(),workers=await Promise.all([pool.getConnection(),pool.getConnection()])
    let queued=0,releaseQueue;const bothQueued=new Promise(r=>{releaseQueue=r})
    try{
      await blocker.beginTransaction();await blocker.query('SELECT id FROM sale_dispatch_component_money WHERE id=? FOR UPDATE',[centSource.dispatchComponentId])
      const executions=workers.map(async(conn,n)=>{
        await conn.beginTransaction();await conn.query('SELECT COUNT(*) FROM sale_commercial_refund_receipts') // establish RR before waiting
        const query=conn.query.bind(conn)
        conn.query=(sql,...args)=>{if(sql.includes('sale_dispatch_component_money')&&sql.includes('FOR UPDATE')){if(++queued===2)releaseQueue()}return query(sql,...args)}
        const p=partials[n]
        try{await rtSvc.putaway(conn,p.taskId,{containerId:p.containerId,locationId:fixture.locationId,requestKey:p.key,userId:fixture.userId,pdaWarehouseId:fixture.warehouseId});await conn.commit()}catch(e){await conn.rollback();throw e}finally{conn.query=query}
      })
      await bothQueued;await blocker.commit();await Promise.all(executions)
    }finally{await blocker.rollback();blocker.release();for(const conn of workers)conn.release()}
    const [refunds]=await q('SELECT SUM(refund_amount) AS amount,SUM(qualified_qty) AS qty FROM sale_commercial_refund_receipts WHERE dispatch_component_id=?',[centSource.dispatchComponentId])
    assert.equal(Number(refunds.amount),0.01);assert.equal(Number(refunds.qty),2,'both current-read completions retain their exact actual facts')
    const last=partials[2],fault=await pool.getConnection(),query=fault.query.bind(fault)
    try{
      await fault.beginTransaction();fault.query=(sql,...args)=>{if(sql.startsWith('UPDATE operation_requests'))throw new Error('owned injected receipt persistence failure');return query(sql,...args)}
      await assert.rejects(rtSvc.putaway(fault,last.taskId,{containerId:last.containerId,locationId:fixture.locationId,requestKey:last.key,userId:fixture.userId,pdaWarehouseId:fixture.warehouseId}),/owned injected receipt/)
      await fault.rollback()
    }finally{fault.query=query;fault.release()}
    const [unchanged]=await q('SELECT status FROM inventory_containers WHERE id=?',[last.containerId]);assert.equal(Number(unchanged.status),4,'receipt failure rolls back physical stock movement')
    await http(`/return-tasks/${last.taskId}/putaway`,{containerId:last.containerId,locationId:fixture.locationId},{pda:true,key:last.key})
    const [finalRefund]=await q('SELECT SUM(refund_amount) AS amount,SUM(qualified_qty) AS qty FROM sale_commercial_refund_receipts WHERE dispatch_component_id=?',[centSource.dispatchComponentId])
    assert.equal(Number(finalRefund.amount),0.01);assert.equal(Number(finalRefund.qty),3)
    console.log('[PASS] cent/3pcs concurrent actual putaway with pre-wait RR snapshots consumes exact one cent; receipt fault rolls back stock/QA/money and original-key retry completes')

    const cancelSale=await svc.create({...body,commercialGroups:[body.commercialGroups[0]],operator:operator(),requestKey:randomUUID()});fixture.sales.push(cancelSale.id)
    await supply([[fixture.products[0],1],[fixture.products[1],4]])
    const cancelDetail=await http(`/sale/${cancelSale.id}`,undefined,{method:'GET'})
    await svc.reserveStock(cancelSale.id,operator(),cancelDetail.physicalItems.map(i=>({id:i.id,warehouseId:fixture.warehouseId,qty:i.quantity})),{commercialModel:'kit-v1',expectedRevision:1,requestKey:randomUUID()})
    const cancelDispatch=await svc.ship(cancelSale.id,operator(),{commercialModel:'kit-v1',expectedRevision:1,groups:[{groupId:cancelDetail.commercialGroups[0].id,qty:1}],requestKey:randomUUID()})
    const cancelTask=await http(`/warehouse-tasks/${cancelDispatch.tasks[0].taskId}`,undefined,{method:'GET'})
    const hingeItem=cancelTask.items.find(i=>i.productId===fixture.products[0])
    const [toReturn]=await q('SELECT id,barcode FROM inventory_containers WHERE product_id=? AND warehouse_id=? AND status=1 AND locked_by_task_id IS NULL AND remaining_qty=1 ORDER BY id',[fixture.products[0],fixture.warehouseId])
    await http('/scan-logs',{taskId:cancelTask.id,itemId:hingeItem.id,containerId:Number(toReturn.id),barcode:toReturn.barcode,productId:hingeItem.productId,qty:1,scanMode:'整件'},{pda:true,expect:201})
    const cancelKey=randomUUID()
    await svc.cancel(cancelSale.id,operator(),null,cancelKey,{commercialModel:'kit-v1',expectedRevision:1})
    const cancelled=await http(`/sale/${cancelSale.id}`,undefined,{method:'GET'})
    assert.equal(cancelled.totalAmount,100,'unshipped cancellation retains commercial ordering history')
    assert.equal(cancelled.commercialGroups[0].quantity,1)
    assert.equal(cancelled.physicalItems.find(i=>i.productId===fixture.products[0]).reservedQty,1,'actually held hinge stays reserved until normal PDA return')
    assert.equal(cancelled.physicalItems.find(i=>i.productId===fixture.products[1]).reservedQty,0,'unpicked screw reservation releases')
    await assert.rejects(svc.deleteOrder(cancelSale.id,operator(),null,randomUUID(),{commercialModel:'kit-v1',expectedRevision:1}),e=>e.code==='SALE_COMMERCIAL_PHYSICAL_RETURN_PENDING')
    const returnKey=randomUUID(),returnPayload={taskId:cancelTask.id,containerId:Number(toReturn.id),barcode:toReturn.barcode,locationId:fixture.locationId}
    const cancelReturned=await http('/scan-logs/cancel-return',returnPayload,{pda:true,expect:201,key:returnKey})
    assert.deepEqual(await http('/scan-logs/cancel-return',returnPayload,{pda:true,expect:201,key:returnKey}),cancelReturned,'same PDA return key never double releases')
    const [left]=await q("SELECT COALESCE(SUM(qty),0) AS qty FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=? AND status=1",[cancelSale.id]);assert.equal(Number(left.qty),0)
    await svc.cancel(cancelSale.id,operator(),null,cancelKey,{commercialModel:'kit-v1',expectedRevision:1})
    const deleteKey=randomUUID();await svc.deleteOrder(cancelSale.id,operator(),null,deleteKey,{commercialModel:'kit-v1',expectedRevision:1});await svc.deleteOrder(cancelSale.id,operator(),null,deleteKey,{commercialModel:'kit-v1',expectedRevision:1})
    console.log('[PASS] unshipped kit cancel preserves original target100, keeps picked reservation until actual PDA return, blocks delete pending return, original keys replay without double release/delete')

    const amendSale=await svc.create({...body,commercialGroups:[body.commercialGroups[0]],operator:operator(),requestKey:randomUUID()});fixture.sales.push(amendSale.id)
    await supply([[fixture.products[0],2],[fixture.products[1],8]])
    const amendDetail=await http(`/sale/${amendSale.id}`,undefined,{method:'GET'})
    await svc.reserveStock(amendSale.id,operator(),amendDetail.physicalItems.map(i=>({id:i.id,warehouseId:fixture.warehouseId,qty:i.quantity})),{commercialModel:'kit-v1',expectedRevision:1,requestKey:randomUUID()})
    const amendTask=(await svc.ship(amendSale.id,operator(),{commercialModel:'kit-v1',expectedRevision:1,groups:[{groupId:amendDetail.commercialGroups[0].id,qty:1}],requestKey:randomUUID()})).tasks[0].taskId
    const increase=await svc.requestAdjustment(amendSale.id,{commercialModel:'kit-v1',expectedRevision:1,commercialGroups:[{...body.commercialGroups[0],quantity:2}],operator:operator(),requestKey:randomUUID()})
    assert.equal(increase.pending,false)
    const increased=await http(`/sale/${amendSale.id}`,undefined,{method:'GET'})
    assert.equal(increased.totalAmount,200);assert.deepEqual(increased.physicalItems.map(i=>i.id),amendDetail.physicalItems.map(i=>i.id))
    const reduceKey=randomUUID(),reduceBody={commercialModel:'kit-v1',expectedRevision:2,commercialGroups:[body.commercialGroups[0]],operator:operator(),requestKey:reduceKey}
    const reduced=await svc.requestAdjustment(amendSale.id,reduceBody);assert.equal(reduced.pending,false)
    assert.deepEqual(await svc.requestAdjustment(amendSale.id,reduceBody),reduced,'old expectedRevision replay returns original adjustment')
    const amended=await http(`/sale/${amendSale.id}`,undefined,{method:'GET'})
    assert.equal(amended.totalAmount,100);assert.equal(amended.commercialRevision,3)
    assert.equal(amended.commercialGroups[0].originalAmount,200,'reduction keeps increased original snapshot frozen')
    await assert.rejects(svc.requestAdjustment(amendSale.id,{...reduceBody,requestKey:randomUUID()}),e=>e.code==='SALE_COMMERCIAL_REVISION_CONFLICT')
    const actualAmendTask=await http(`/warehouse-tasks/${amendTask}`,undefined,{method:'GET'})
    assert.deepEqual(actualAmendTask.items.map(i=>i.requiredQty),[1,4])
    await svc.cancel(amendSale.id,operator(),null,randomUUID(),{commercialModel:'kit-v1',expectedRevision:3})
    console.log('[PASS] single zero-shipped task kit increase/reduction preserves physical IDs, updates actual task vector and commercial mapping, keeps immutable increased200 budget, replays old revision and rejects new stale key')

    for(const first of ['return','ship']){
      const crossed=await svc.create({...body,discountAmount:30,commercialGroups:body.commercialGroups.slice(0,2),operator:operator(),requestKey:randomUUID()});fixture.sales.push(crossed.id)
      await supply([[fixture.products[0],2],[fixture.products[1],8]])
      const initial=await http(`/sale/${crossed.id}`,undefined,{method:'GET'})
      await svc.reserveStock(crossed.id,operator(),initial.physicalItems.map(i=>({id:i.id,warehouseId:fixture.warehouseId,qty:i.quantity})),{commercialModel:'kit-v1',expectedRevision:1,requestKey:randomUUID()})
      const taskA=(await svc.ship(crossed.id,operator(),{commercialModel:'kit-v1',expectedRevision:1,groups:[{groupId:initial.commercialGroups[0].id,qty:1}],requestKey:randomUUID()})).tasks[0].taskId
      const taskB=(await svc.ship(crossed.id,operator(),{commercialModel:'kit-v1',expectedRevision:1,groups:[{groupId:initial.commercialGroups[1].id,qty:1}],requestKey:randomUUID()})).tasks[0].taskId
      await actualShip(taskA)
      const original=(await sourceRead(crossed.orderNo)).items.find(i=>i.productId===fixture.products[0])
      const sr=await sourceCreate({customerId:fixture.customerId,customerName:ref,warehouseId:fixture.warehouseId,warehouseName:ref,saleOrderId:crossed.id,saleOrderNo:crossed.orderNo,commercialModel:'kit-v1',expectedRevision:1,items:[{...original,quantity:1}],operator:operator(),requestKey:randomUUID()})
      await http(`/returns/sale/${sr.id}/confirm`,{})
      const rt=(await http(`/returns/sale/${sr.id}`,undefined,{method:'GET'})).task.id
      await http(`/return-tasks/${rt}/receive`,{productId:original.productId,packages:[{qty:1}]},{pda:true})
      await http(`/return-tasks/${rt}/check`,{productId:original.productId,passedQty:1,rejectedQty:0},{pda:true})
      const [c]=await q("SELECT id FROM inventory_containers WHERE source_ref_type='sale_return' AND source_ref_id=? AND status=4",[rt])
      await actualShip(taskB,{beforeShip:async(send)=>{
        const blocking=await pool.getConnection(),refund=await pool.getConnection()
        async function waitStockWaiters(count){const end=Date.now()+5000;while(Date.now()<end){const [r]=await q('SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits w JOIN information_schema.innodb_trx b ON b.trx_id=w.BLOCKING_ENGINE_TRANSACTION_ID WHERE b.trx_mysql_thread_id=?',[blocking.threadId]);if(Number(r.count)>=count)return;await new Promise(r=>setTimeout(r,20))}throw new Error('owned interleaving stock wait barrier timed out')}
        const completeRefund=async()=>{try{await refund.beginTransaction();await refund.query('SELECT COUNT(*) FROM sale_commercial_refund_receipts');await rtSvc.putaway(refund,rt,{containerId:Number(c.id),locationId:fixture.locationId,requestKey:randomUUID(),userId:fixture.userId,pdaWarehouseId:fixture.warehouseId});await refund.commit()}catch(e){await refund.rollback();throw e}}
        let shipPromise,returnPromise
        try{await blocking.beginTransaction();await require('../backend/src/engine/containerEngine').lockStockDimension(blocking,fixture.products[0],fixture.warehouseId)
          if(first==='return'){returnPromise=completeRefund();await waitStockWaiters(1);shipPromise=send()}else{shipPromise=send();await waitStockWaiters(1);returnPromise=completeRefund()}
          await waitStockWaiters(2);await blocking.commit();const [shipped]=await Promise.all([shipPromise,returnPromise]);return shipped
        }finally{await blocking.rollback();await Promise.allSettled([shipPromise,returnPromise].filter(Boolean));blocking.release();refund.release()}
      }})
      const [finalAR]=await q('SELECT total_amount FROM payment_records WHERE type=2 AND order_id=?',[crossed.id]);assert.equal(Number(finalAR.total_amount),198,'later shipment net270 preserves frozen A hinge gross80/financial72 refund')
      const [refundEvidence]=await q('SELECT SUM(refund_amount) gross,SUM(financial_amount) financial FROM sale_commercial_refund_receipts WHERE order_id=?',[crossed.id]);assert.equal(Number(refundEvidence.gross),80);assert.equal(Number(refundEvidence.financial),72)
      const vouchers=await require('../backend/src/modules/accounting/voucher-engine').buildSaleReturn(pool);const reverse=vouchers.find(v=>v.sourceId===sr.id);assert.equal(reverse.legs.find(l=>l.code==='1122').amount,72)
      const completed=await http(`/sale/${crossed.id}`,undefined,{method:'GET'});assert.equal(completed.totalAmount,300)
      const splitSources=(await sourceRead(crossed.orderNo)).items.filter(i=>i.productId===fixture.products[1])
      const sourceReturnBody={customerId:fixture.customerId,customerName:ref,warehouseId:fixture.warehouseId,warehouseName:ref,saleOrderId:crossed.id,saleOrderNo:crossed.orderNo,commercialModel:'kit-v1',expectedRevision:1,operator:operator()}
      await assert.rejects(sourceCreate({...sourceReturnBody,items:splitSources.map(i=>({...i,quantity:1})),requestKey:randomUUID()}),e=>e.code==='SALE_RETURN_SAME_SKU_SOURCE_SPLIT_REQUIRED')
      for(const [index,i] of splitSources.entries()){
        const split=await sourceCreate({...sourceReturnBody,items:[{...i,quantity:1}],requestKey:randomUUID()});await http(`/returns/sale/${split.id}/confirm`,{})
        const task=(await http(`/returns/sale/${split.id}`,undefined,{method:'GET'})).task.id;await http(`/return-tasks/${task}/receive`,{productId:i.productId,packages:[{qty:1}]},{pda:true});await http(`/return-tasks/${task}/check`,{productId:i.productId,passedQty:index?0:1,rejectedQty:index?1:0},{pda:true})
        if(!index){const [c]=await q("SELECT id FROM inventory_containers WHERE source_ref_type='sale_return' AND source_ref_id=? AND status=4",[task]);await http(`/return-tasks/${task}/putaway`,{containerId:Number(c.id),locationId:fixture.locationId},{pda:true})}
        const executed=await http(`/returns/sale/${split.id}`,undefined,{method:'GET'});assert.equal(executed.status,3);assert.equal(executed.totalAmount,index?0:4.5)
      }
      const [afterSplit]=await q('SELECT total_amount FROM payment_records WHERE type=2 AND order_id=?',[crossed.id]);assert.equal(Number(afterSplit.total_amount),193.5)
    }
    console.log('[PASS] real B shipment HTTP and real A-source refund service execution wait on owned stock barrier in both orders; no lock cycle/lost refund, discounted later AR198, gross80/net72 voucher; sameSKU two sources split and B allreject completes0 (AR193.5 after A screw)')

    for(const closeTail of [false,true]){
    const discounted=await svc.create({...body,discountAmount:closeTail?.0101:10,commercialGroups:closeTail?body.commercialGroups.slice(0,2):[body.commercialGroups[0]],operator:operator(),requestKey:randomUUID()});fixture.sales.push(discounted.id)
    await supply([[fixture.products[0],1],[fixture.products[1],4]])
    const discountedDetail=await http(`/sale/${discounted.id}`,undefined,{method:'GET'})
    await svc.reserveStock(discounted.id,operator(),discountedDetail.physicalItems.map(i=>({id:i.id,warehouseId:fixture.warehouseId,qty:i.quantity})),{commercialModel:'kit-v1',expectedRevision:1,requestKey:randomUUID()})
    const discountedTask=(await svc.ship(discounted.id,operator(),{commercialModel:'kit-v1',expectedRevision:1,groups:[{groupId:discountedDetail.commercialGroups[0].id,qty:1}],requestKey:randomUUID()})).tasks[0].taskId
    await actualShip(discountedTask)
    if(closeTail)await svc.cancel(discounted.id,operator(),null,randomUUID(),{commercialModel:'kit-v1',expectedRevision:1})
    const discountedSources=await sourceRead(discounted.orderNo)
    const discountedSR=await sourceCreate({customerId:fixture.customerId,customerName:ref,warehouseId:fixture.warehouseId,warehouseName:ref,saleOrderId:discounted.id,saleOrderNo:discounted.orderNo,commercialModel:'kit-v1',expectedRevision:closeTail?2:1,items:discountedSources.items.map(i=>({...i,quantity:i.remainingQty})),operator:operator(),requestKey:randomUUID()})
    if(closeTail){
      const [tailAR]=await q('SELECT id FROM payment_records WHERE type=2 AND order_id=?',[discounted.id])
      await http('/payments/receipts',{type:2,partyName:ref,amount:.01,paymentDate:today,accountId:fixture.account.id,allocations:[{recordId:Number(tailAR.id),amount:.01}]},{expect:201})
      await http(`/returns/sale/${discountedSR.id}/confirm`,{},{expect:409})
      const tailRefund=await http('/refunds',{saleOrderId:discounted.id,amount:.01,accountId:fixture.account.id,refundDate:today,remark:ref});await http(`/refunds/${tailRefund.id}/submit`,{});await http(`/refunds/${tailRefund.id}/execute`,{})
    }
    await http(`/returns/sale/${discountedSR.id}/confirm`,{})
    const discountedRT=(await http(`/returns/sale/${discountedSR.id}`,undefined,{method:'GET'})).task.id
    for(const i of discountedSources.items)await http(`/return-tasks/${discountedRT}/receive`,{productId:i.productId,packages:[{qty:i.remainingQty}]},{pda:true})
    for(const i of discountedSources.items)await http(`/return-tasks/${discountedRT}/check`,{productId:i.productId,passedQty:i.remainingQty,rejectedQty:0},{pda:true})
    const discountedContainers=await q("SELECT id FROM inventory_containers WHERE source_ref_type='sale_return' AND source_ref_id=? AND status=4",[discountedRT])
    for(const c of discountedContainers)await http(`/return-tasks/${discountedRT}/putaway`,{containerId:Number(c.id),locationId:fixture.locationId},{pda:true})
    const [discountedAR]=await q('SELECT total_amount FROM payment_records WHERE type=2 AND order_id=?',[discounted.id]);assert.equal(Number(discountedAR.total_amount),0)
    const [discountProof]=await q('SELECT SUM(refund_amount) gross,SUM(financial_amount) financial FROM sale_commercial_refund_receipts WHERE order_id=?',[discounted.id]);assert.equal(Number(discountProof.gross),100);assert.equal(Number(discountProof.financial),closeTail?99.9966:90)
    const reverseDiscount=(await require('../backend/src/modules/accounting/voucher-engine').buildSaleReturn(pool)).find(v=>v.sourceId===discountedSR.id);assert.equal(reverseDiscount.legs.find(l=>l.code==='1122').amount,closeTail?100:90)
    const [basis]=await q('SELECT order_gross_basis,discount_basis,basis_origin FROM sale_dispatch_groups WHERE order_id=? AND confirmed_at IS NOT NULL',[discounted.id]);assert.equal(Number(basis.order_gross_basis),closeTail?300:100);assert.equal(Number(basis.discount_basis),closeTail?.0101:10);assert.equal(basis.basis_origin,'real_confirmation')
    console.log(closeTail?'[PASS] original300/discount.0101 -> A100 close AR99.9966; real paid.01 blocks confirm, real refund unlocks full source net99.9966 -> AR0':'[PASS] discounted100 less10 full qualified return retains gross100 evidence and reduces real AR90 to0')

    }
    const tinyKit=await http('/kits',{code:ref+'-tiny-net',name:ref+'-tiny-net',referenceUnitPrice:.02,components:[{productId:fixture.products[0],baseQty:2}]},{expect:201})
    const tiny=await svc.create({...body,discountAmount:.01,commercialGroups:[{kind:'kit',lineKey:'TINY',kitVersionId:tinyKit.currentVersionId,quantity:1,warehouseId:fixture.warehouseId,priceSource:'kit_default'}],operator:operator(),requestKey:randomUUID()});fixture.sales.push(tiny.id)
    await supply([[fixture.products[0],2]])
    const tinyDetail=await http(`/sale/${tiny.id}`,undefined,{method:'GET'});await svc.reserveStock(tiny.id,operator(),tinyDetail.items.map(i=>({id:i.id,warehouseId:fixture.warehouseId,qty:i.quantity})),{commercialModel:'kit-v1',expectedRevision:1,requestKey:randomUUID()})
    const tinyTask=(await svc.ship(tiny.id,operator(),{commercialModel:'kit-v1',expectedRevision:1,groups:[{groupId:tinyDetail.commercialGroups[0].id,qty:1}],requestKey:randomUUID()})).tasks[0].taskId;await actualShip(tinyTask)
    const tinySource=(await sourceRead(tiny.orderNo)).items[0],tinyReturns=[]
    for(let part=0;part<2;part++){
      const sr=await sourceCreate({customerId:fixture.customerId,customerName:ref,warehouseId:fixture.warehouseId,warehouseName:ref,saleOrderId:tiny.id,saleOrderNo:tiny.orderNo,commercialModel:'kit-v1',expectedRevision:1,items:[{...tinySource,quantity:1}],operator:operator(),requestKey:randomUUID()});tinyReturns.push(sr.id);await http(`/returns/sale/${sr.id}/confirm`,{})
      const task=(await http(`/returns/sale/${sr.id}`,undefined,{method:'GET'})).task.id;await http(`/return-tasks/${task}/receive`,{productId:tinySource.productId,packages:[{qty:1}]},{pda:true});await http(`/return-tasks/${task}/check`,{productId:tinySource.productId,passedQty:1,rejectedQty:0},{pda:true});const [c]=await q("SELECT id FROM inventory_containers WHERE source_ref_type='sale_return' AND source_ref_id=? AND status=4",[task]);await http(`/return-tasks/${task}/putaway`,{containerId:Number(c.id),locationId:fixture.locationId},{pda:true})
    }
    const tinyVouchers=(await require('../backend/src/modules/accounting/voucher-engine').buildSaleReturn(pool)).filter(v=>tinyReturns.includes(v.sourceId))
    const tinyReverse=tinyVouchers.flatMap(v=>v.legs).filter(l=>l.code==='1122').reduce((n,l)=>n+Number(l.amount),0)
    assert.equal(tinyReverse,.01,'two actual net.005 refunds must reverse original income.01 exactly once')
    console.log('[PASS] real .02/discount.01 source2pcs partial returns each financial.005, cumulative voucher reversal total.01')

    const auxProduct=await insert("INSERT INTO product_items(code,name,unit,sale_price_a,cost_price,allow_decimal_qty) VALUES (?,?,'个',80,10,0)",[ref+'-2',ref+'-包装组件']);fixture.products.push(auxProduct)
    await q("INSERT INTO product_units(product_id,unit_name,conversion_rate) VALUES (?,'箱',3)",[auxProduct])
    async function supplyAux(){
      const po=await http('/purchase',{supplierId:fixture.supplierId,supplierName:ref,warehouseId:fixture.warehouseId,warehouseName:ref,items:[{productId:auxProduct,productCode:ref+'-2',productName:ref,unit:'个',entryUnit:'箱',quantity:1,unitPrice:30,priceSource:'manual'}]},{expect:201});fixture.purchases.push(po.id)
      const purchased=await http(`/purchase/${po.id}`,undefined,{method:'GET'});assert.equal(purchased.items[0].quantity,3);assert.equal(purchased.items[0].amount,30);assert.equal(purchased.items[0].unitPrice,10)
      await http(`/purchase/${po.id}/confirm`,{})
      const inbound=await http('/inbound-tasks',{poId:po.id},{expect:201});await http(`/inbound-tasks/${inbound.taskId}/submit`,{})
      const received=await http(`/inbound-tasks/${inbound.taskId}/receive`,{productId:auxProduct,packages:[{qty:1},{qty:1},{qty:1}]},{pda:true})
      for(const c of received.containers){fixture.containers.push(c.containerId);await http(`/inbound-tasks/${inbound.taskId}/putaway`,{containerId:c.containerId,locationId:fixture.locationId},{pda:true})}
    }
    await supplyAux()
    const componentKit=await http('/kits',{code:ref+'-pack-component',name:ref+'-pack-component',referenceUnitPrice:20,components:[{productId:auxProduct,baseQty:1}]},{expect:201})
    const fromPackage=await svc.create({customerId:fixture.customerId,warehouseId:fixture.warehouseId,commercialModel:'kit-v1',commercialGroups:[{kind:'kit',lineKey:'PK',kitVersionId:componentKit.currentVersionId,quantity:1,warehouseId:fixture.warehouseId,priceSource:'kit_default'}],operator:operator(),requestKey:randomUUID()});fixture.sales.push(fromPackage.id)
    const packDetail=await http(`/sale/${fromPackage.id}`,undefined,{method:'GET'})
    await svc.reserveStock(fromPackage.id,operator(),packDetail.physicalItems.map(i=>({id:i.id,warehouseId:fixture.warehouseId,qty:1})),{commercialModel:'kit-v1',expectedRevision:1,requestKey:randomUUID()})
    const packTask=(await svc.ship(fromPackage.id,operator(),{commercialModel:'kit-v1',expectedRevision:1,groups:[{groupId:packDetail.commercialGroups[0].id,qty:1}],requestKey:randomUUID()})).tasks[0].taskId
    await actualShip(packTask)
    const [cost]=await q('SELECT wti.picked_qty,soi.cost_snapshot FROM warehouse_task_items wti JOIN warehouse_tasks wt ON wt.id=wti.task_id JOIN sale_order_items soi ON soi.order_id=wt.sale_order_id AND soi.product_id=wti.product_id AND soi.warehouse_id=wt.warehouse_id WHERE wti.task_id=?',[packTask]);assert.equal(Number(cost.picked_qty),1);assert.equal(Number(cost.cost_snapshot),10)
    const [remainingAux]=await q('SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',[auxProduct,fixture.warehouseId]);assert.equal(Number(remainingAux.quantity),2)
    await supplyAux()
    const mixedBox=await svc.create({customerId:fixture.customerId,warehouseId:fixture.warehouseId,commercialModel:'kit-v1',commercialGroups:[{kind:'ordinary',lineKey:'BOX',productId:auxProduct,entryUnit:'箱',quantity:1,unitPrice:1,warehouseId:fixture.warehouseId,priceSource:'manual'}],operator:operator(),requestKey:randomUUID()});fixture.sales.push(mixedBox.id)
    const mixedDetail=await http(`/sale/${mixedBox.id}`,undefined,{method:'GET'});assert.equal(mixedDetail.totalAmount,1);assert.equal(mixedDetail.commercialGroups[0].originalQty,3);assert.deepEqual(mixedDetail.commercialGroups[0].entry,{entryUnit:'箱',entryQty:1,conversionRate:3,entryUnitPrice:1})
    await svc.reserveStock(mixedBox.id,operator(),mixedDetail.physicalItems.map(i=>({id:i.id,warehouseId:fixture.warehouseId,qty:3})),{commercialModel:'kit-v1',expectedRevision:1,requestKey:randomUUID()})
    const boxTask=(await svc.ship(mixedBox.id,operator(),{commercialModel:'kit-v1',expectedRevision:1,groups:[{groupId:mixedDetail.commercialGroups[0].id,qty:3}],requestKey:randomUUID()})).tasks[0].taskId
    await actualShip(boxTask)
    const [boxAR]=await q('SELECT total_amount FROM payment_records WHERE type=2 AND order_id=?',[mixedBox.id]);assert.equal(Number(boxAR.total_amount),1,'frozen entry gross1 never reverse-computes .99999999')
    console.log('[PASS] actual purchase1 box=3 base pieces then kit consumes1/cost10/stock2 exactly once; mixed ordinary1 box at1 freezes entry/base metadata and actual full shipment AR1')
    await supplyAux()
    const ordinary=await http('/sale',{customerId:fixture.customerId,customerName:ref,warehouseId:fixture.warehouseId,warehouseName:ref,items:[{productId:auxProduct,productCode:ref+'-2',productName:ref,unit:'个',entryUnit:'箱',quantity:1,unitPrice:1,priceSource:'manual'}]},{expect:201});fixture.sales.push(ordinary.id)
    const ordinaryDetail=await http(`/sale/${ordinary.id}`,undefined,{method:'GET'});assert.equal(ordinaryDetail.commercialModel,null);assert.equal(ordinaryDetail.totalAmount,1);assert.equal(ordinaryDetail.items[0].quantity,3)
    await http(`/sale/${ordinary.id}/reserve`,{items:ordinaryDetail.items.map(i=>({id:i.id,warehouseId:fixture.warehouseId,warehouseName:ref,qty:i.quantity}))})
    await http(`/sale/${ordinary.id}/ship`,{items:ordinaryDetail.items.map(i=>({id:i.id,qty:i.quantity}))})
    const [ordinaryWT]=await q('SELECT id FROM warehouse_tasks WHERE sale_order_id=?',[ordinary.id]);await actualShip(Number(ordinaryWT.id))
    const oldSources=await http(`/returns/sale/source-order?orderNo=${ordinary.orderNo}`,undefined,{method:'GET'})
    const oldSR=await http('/returns/sale',{customerId:fixture.customerId,customerName:ref,warehouseId:fixture.warehouseId,warehouseName:ref,saleOrderId:ordinary.id,saleOrderNo:ordinary.orderNo,items:oldSources.items.map(i=>({sourceItemId:i.sourceItemId,productId:i.productId,productCode:i.productCode,productName:i.productName,unit:i.unit,quantity:i.remainingQty,unitPrice:i.unitPrice}))},{expect:201})
    await http(`/returns/sale/${oldSR.id}/confirm`,{})
    const oldRT=(await http(`/returns/sale/${oldSR.id}`,undefined,{method:'GET'})).task.id
    await http(`/return-tasks/${oldRT}/receive`,{productId:auxProduct,packages:[{qty:3}]},{pda:true});await http(`/return-tasks/${oldRT}/check`,{productId:auxProduct,passedQty:3,rejectedQty:0},{pda:true})
    const [oldC]=await q("SELECT id FROM inventory_containers WHERE source_ref_type='sale_return' AND source_ref_id=? AND status=4",[oldRT]);await http(`/return-tasks/${oldRT}/putaway`,{containerId:Number(oldC.id),locationId:fixture.locationId},{pda:true})
    const [oldAR]=await q('SELECT total_amount FROM payment_records WHERE type=2 AND order_id=?',[ordinary.id]);assert.equal(Number(oldAR.total_amount),0)
    const ordinaryCancelled=await http('/sale',{customerId:fixture.customerId,customerName:ref,warehouseId:fixture.warehouseId,warehouseName:ref,items:[{productId:auxProduct,productCode:ref+'-2',productName:ref,unit:'个',quantity:1,unitPrice:1,priceSource:'manual'}]},{expect:201});fixture.sales.push(ordinaryCancelled.id)
    await http(`/sale/${ordinaryCancelled.id}/reserve`,{});await http(`/sale/${ordinaryCancelled.id}/cancel`,{})
    const [oldLedger]=await q("SELECT COUNT(*) count FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=? AND status=1",[ordinaryCancelled.id]);assert.equal(Number(oldLedger.count),0)
    console.log('[PASS] legacy ordinary HTTP create auxiliary unit/reserve/dispatch/actual PDA ship/source return/QA/putaway leaves AR0; unshipped cancel releases original reservation rule')

  } finally {
    fs.writeFileSync(`/tmp/flowcube-kits-lifecycle-${ref}.json`, JSON.stringify(fixture, null, 2), { mode: 0o600 })
    try {
      for(const id of fixture.sales){
        const [sale]=await q('SELECT status,commercial_revision,commercial_model FROM sale_orders WHERE id=?',[id])
        if(sale&&[1,2,3,6].includes(Number(sale.status))){
          await originalSvc.cancel(id,operator(),null,randomUUID(),sale.commercial_model==='kit-v1'?{commercialModel:'kit-v1',expectedRevision:Number(sale.commercial_revision)}:{})
          const tasks=await q('SELECT id FROM warehouse_tasks WHERE sale_order_id=? AND cancel_requested_at IS NOT NULL AND status<>8',[id])
          for(const task of tasks){
            const pending=await http(`/warehouse-tasks/${task.id}/cancel-return-detail`,undefined,{method:'GET'})
            for(const pkg of pending.packages)await http('/scan-logs/cancel-return/box',{taskId:Number(task.id),packageId:pkg.packageId,barcode:pkg.barcode},{pda:true,expect:201})
            for(const c of pending.containers)await http('/scan-logs/cancel-return',{taskId:Number(task.id),containerId:c.containerId,barcode:c.barcode,locationId:fixture.locationId},{pda:true,expect:201})
          }
        }
      }
    } finally {
      try {
      if(ownPrint)await require('./helpers/ownedPrintFixture').releaseOwnPackageLabelPrinter(ownPrint,{http:ownPrint.http,token,assert})
      } finally {
      if(fixture.deviceId){await q('DELETE FROM pda_device_sessions WHERE device_id=?',[fixture.deviceId]);await q('DELETE FROM pda_devices WHERE id=?',[fixture.deviceId])}
      if (fixture.userId) await q('UPDATE sys_users SET is_active=0,token_version=token_version+1 WHERE id=?', [fixture.userId]) }
      if(fixture.previewUserId)await q('UPDATE sys_users SET is_active=0,token_version=token_version+1 WHERE id=?',[fixture.previewUserId])
      if(fixture.guardRoleId)await q('DELETE FROM sys_role_permissions WHERE role_id=?',[fixture.guardRoleId])
      if(fixture.previewRoleId)await q('DELETE FROM sys_role_permissions WHERE role_id=?',[fixture.previewRoleId])
      if(fixture.account)await q('UPDATE finance_accounts SET is_active=0 WHERE id=?',[fixture.account.id])
      try { if (server) await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())) } finally { await pool.end() }
    }
    console.log(`[fixtures] /tmp/flowcube-kits-lifecycle-${ref}.json; test user disabled; server/pool closed`)
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
