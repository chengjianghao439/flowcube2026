'use strict'
const root = require('node:path').resolve(__dirname, '..')
const req = p => require(root + '/' + p)
process.env.NODE_ENV = 'test'
req('tests/helpers/testEnvironment').configureTestEnvironment()
const { test, before, after } = require('node:test')
const fs = require('node:fs'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const { pool } = req('backend/src/config/db'), q = (...a) => pool.query(...a)
const express = req('backend/node_modules/express'), jwt = req('backend/node_modules/jsonwebtoken'), bcrypt = req('backend/node_modules/bcryptjs')
const engine = req('backend/src/engine/containerEngine')
const evidence = { environment: { database: process.env.DB_NAME, host: process.env.DB_HOST, port: process.env.DB_PORT }, calls: [] }
let server, ctx
before(async () => {
 const suffix='R2FT'+crypto.randomBytes(6).toString('hex'); evidence.suffix=suffix
 async function insert(sql,values){return (await q(sql,values))[0].insertId}
 const wh=[];for(let i=0;i<3;i++) wh.push(await insert('INSERT INTO inventory_warehouses(code,name) VALUES(?,?)',[suffix+'W'+i,suffix+'仓'+i]))
 const loc=[];for(let i=0;i<3;i++) loc.push(await insert('INSERT INTO warehouse_locations(warehouse_id,code,name) VALUES(?,?,?)',[wh[i],suffix+'L'+i,'审计库位']))
 const product=await insert('INSERT INTO product_items(code,name,unit,sale_price_a) VALUES(?,?,?,10)',[suffix+'P','调拨审计商品','个'])
 const role=await insert('INSERT INTO sys_roles(name,code,remark,is_system) VALUES(?,?,?,0)',[suffix,suffix,'审计独占'])
 const P=req('backend/src/constants/permissions').PERMISSIONS
 for(const permission of [P.TRANSFER_ORDER_VIEW,P.TRANSFER_ORDER_CREATE,P.TRANSFER_ORDER_CONFIRM,P.TRANSFER_ORDER_EXECUTE,P.WAREHOUSE_VIEW]) if(permission) await q('INSERT INTO sys_role_permissions(role_id,permission) VALUES(?,?)',[role,permission])
 const uid=await insert('INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active) VALUES(?,?,?,?,?,1)',[suffix,bcrypt.hashSync(crypto.randomBytes(24).toString('hex'),4),'调拨审计员',role,suffix])
 await q('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES(?,?)',[uid,wh[0]])
 const token=jwt.sign({userId:uid,tokenVersion:0,tokenType:'access'},req('backend/src/config/env').env.JWT_SECRET,{expiresIn:'10m'})
 const sessions=[]; for(let i=0;i<3;i++) { const session=crypto.randomBytes(24).toString('hex');const did=await insert('INSERT INTO pda_devices(device_code,device_name,warehouse_id,status,secret_hash) VALUES(?,?,?,\'active\',?)',[suffix+'D'+i,'审计设备',wh[i],bcrypt.hashSync('fixture',4)]);await q('INSERT INTO pda_device_sessions(device_id,user_id,session_token_hash,warehouse_id,scopes,expires_at) VALUES(?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 1 DAY))',[did,uid,req('backend/src/modules/pda/pda.sessions.service').hashToken(session),wh[i],'[]']); sessions.push(session) }
 const app=express(); app.use(express.json());app.use('/api/system',req('backend/src/modules/system/system.routes'));app.use('/api/warehouses',req('backend/src/modules/warehouses/warehouses.routes'));app.use('/api/transfer',req('backend/src/modules/transfer/transfer.routes'));app.use(req('backend/src/middleware/errorHandler'));server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s))});const base='http://127.0.0.1:'+server.address().port
 async function http(label,method,path,body,device,key){const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};if(device!==undefined){headers['X-Client']='pda';headers['X-PDA-Session']=sessions[device]}if(key)headers['X-Request-Key']=suffix+key;const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});const data=await r.json();const record={label,method,path,status:r.status,response:data};if(path.includes('/scan-')) record.sqlAfter={items:(await q('SELECT order_id,quantity,deducted_qty,received_qty FROM transfer_order_items WHERE order_id=?',[Number(path.split('/')[3])]))[0],order:(await q('SELECT id,status FROM transfer_orders WHERE id=?',[Number(path.split('/')[3])]))[0],container:(await q('SELECT barcode,warehouse_id,status,transfer_order_id FROM inventory_containers WHERE barcode=?',[body.containerBarcode]))[0]};evidence.calls.push(record);return record}
 const item=quantity=>({productId:product,productCode:suffix+'P',productName:'调拨审计商品',unit:'个',quantity})
 const payload=(from,to,items)=>({fromWarehouseId:wh[from],fromWarehouseName:suffix+'仓'+from,toWarehouseId:wh[to],toWarehouseName:suffix+'仓'+to,items})

 const seedOrder=await http('seed-order','POST','/api/transfer',payload(0,1,[item(150)]));assert.equal(seedOrder.status,201)
 const containers=[]; const conn=await pool.getConnection()
 try { await conn.beginTransaction();await engine.lockStockDimension(conn,product,wh[0]);for(let i=0;i<30;i++)containers.push(await engine.createContainer(conn,{productId:product,warehouseId:wh[0],initialQty:5,unit:'个',sourceType:engine.SOURCE_TYPE.TRANSFER,sourceRefId:seedOrder.response.data.id,locationId:loc[0],barcode:suffix+'C'+i}));await engine.syncStockFromContainers(conn,product,wh[0]);await conn.commit() } catch(e) { await conn.rollback(); throw e } finally {conn.release()}
 let ci=0
 async function order(items=[item(5)]) { const r=await http('create','POST','/api/transfer',payload(0,1,items));assert.equal(r.status,201,JSON.stringify(r)); const id=r.response.data.id; const confirm=await http('confirm','POST','/api/transfer/'+id+'/confirm'); assert.equal(confirm.status,200); return id }
 async function scan(id,type,container,key,device=type==='out'?0:1) {return http('scan-'+type,'POST',`/api/transfer/${id}/scan-${type}`,{containerBarcode:container.barcode,...(type==='in'?{locationId:loc[1]}:{})},device,key)}
 async function state(id) { return (await q('SELECT quantity,deducted_qty,received_qty FROM transfer_order_items WHERE order_id=? ORDER BY id',[id]))[0].map(x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,Number(v)]))) }
 async function receipt(key,action) { return http('receipt','GET',`/api/system/request-status/${suffix+key}?action=${action}`) }
 ctx={http,item,payload,order,scan,state,receipt,wh,uid,suffix,next:()=>containers[ci++]}
 evidence.fixtures={suffix,uid,role,wh,loc,product,containers:containers.map(c=>c.containerId)}
})
after(async () => {fs.writeFileSync(process.env.FLOWCUBE_TRANSFER_EVIDENCE_PATH || '/tmp/flowcube-round2-fix-transfer-evidence.json',JSON.stringify(evidence,null,2));if(server)await new Promise(r=>server.close(r));await pool.end()})

function success(r) { assert.equal(r.status,200,JSON.stringify(r)); return r.response.data }
test('R2-06 creation rejects both warehouses outside scope without inserting',async()=>{
 const {http,payload,item}=ctx; const [[before]]=await q('SELECT COUNT(*) n FROM transfer_orders')
 const result=await http('outside-create','POST','/api/transfer',payload(1,2,[item(1)]));assert.equal(result.status,403)
 const [[after]]=await q('SELECT COUNT(*) n FROM transfer_orders'); assert.equal(after.n,before.n)
})
test('R2-01 partial arrival keeps plan open until second batch is received',async()=>{
 const {order,item,next,scan,state}=ctx,id=await order([item(10)]),a=next(),b=next()
 success(await scan(id,'out',a,'partial-out1')); assert.equal(success(await scan(id,'in',a,'partial-in1')).completed,false)
 const [[row]]=await q('SELECT status FROM transfer_orders WHERE id=?',[id]);assert.equal(row.status,3)
 success(await scan(id,'out',b,'partial-out2'));assert.equal(success(await scan(id,'in',b,'partial-in2')).completed,true)
 assert.deepEqual(await state(id),[{quantity:10,deducted_qty:10,received_qty:10}])
})
test('R2-05 legacy duplicate lines allocate across boundaries and accept reverse arrival',async()=>{
 const {order,item,next,scan,state}=ctx,id=await order([item(3),item(7)]),a=next(),b=next()
 success(await scan(id,'out',a,'dup-out1'));success(await scan(id,'out',b,'dup-out2'))
 assert.equal(success(await scan(id,'in',b,'dup-in2')).completed,false);assert.equal(success(await scan(id,'in',a,'dup-in1')).completed,true)
 assert.deepEqual(await state(id),[{quantity:3,deducted_qty:3,received_qty:3},{quantity:7,deducted_qty:7,received_qty:7}])
})
test('R2-07 same key on two orders returns their own outgoing and incoming receipts',async()=>{
 const {order,next,scan,receipt}=ctx,a=await order(),b=await order(),ca=next(),cb=next()
 success(await scan(a,'out',ca,'shared-out'));assert.equal(success(await scan(b,'out',cb,'shared-out')).transferId,b)
 success(await scan(a,'in',ca,'shared-in'));assert.equal(success(await scan(b,'in',cb,'shared-in')).transferId,b)
 assert.equal(success(await receipt('shared-out',`transfer.scanOut.${b}`)).resourceId,b)
 assert.equal(success(await receipt('shared-in',`transfer.scanIn.${b}`)).resourceId,b)
 assert.equal(success(await receipt('shared-in','transfer.scanIn')).status,'not_found')
})
test('same-order retries do not duplicate inventory logs, events or received quantity',async()=>{
 const {order,next,scan,state}=ctx,id=await order(),c=next()
 const out=success(await scan(id,'out',c,'retry-out'));assert.deepEqual(success(await scan(id,'out',c,'retry-out')),out)
 const incoming=success(await scan(id,'in',c,'retry-in'));assert.deepEqual(success(await scan(id,'in',c,'retry-in')),incoming)
 assert.deepEqual(await state(id),[{quantity:5,deducted_qty:5,received_qty:5}])
 const [[logs]]=await q("SELECT COUNT(*) n FROM inventory_logs WHERE ref_type='transfer' AND ref_id=?",[id]);assert.equal(logs.n,2)
 const [[events]]=await q("SELECT COUNT(*) n FROM transfer_order_events WHERE transfer_order_id=? AND event_type='TRANSFER_COMPLETED'",[id]);assert.equal(events.n,1)
})
test('replayed keys still enforce bound device warehouse and nonexistent resources',async()=>{
 const {order,next,scan}=ctx,id=await order(),c=next();success(await scan(id,'out',c,'device-out'))
 assert.equal((await scan(id,'out',c,'device-out',2)).status,403)
 assert.equal((await scan(99999999,'out',c,'device-out')).status,404)
 success(await scan(id,'in',c,'device-in')); assert.equal((await scan(id,'in',c,'device-in',0)).status,403)
})
test('whole-container overflow is rejected with no move',async()=>{
 const {order,item,next,scan,state,wh}=ctx,id=await order([item(4)]),c=next();assert.equal((await scan(id,'out',c,'overflow')).status,409)
 assert.deepEqual(await state(id),[{quantity:4,deducted_qty:0,received_qty:0}]);const [[row]]=await q('SELECT warehouse_id,status FROM inventory_containers WHERE barcode=?',[c.barcode]);assert.equal(row.warehouse_id,wh[0]);assert.equal(row.status,1)
})
test('legacy generic receipt retries stay bound to its original resource',async()=>{
 const {order,next,scan,receipt,uid,suffix}=ctx,a=await order(),b=await order(),c=next();const original=success(await scan(a,'out',c,'legacy'))
 await q("UPDATE operation_requests SET action='transfer.scanOut' WHERE request_key=? AND user_id=?",[suffix+'legacy',uid])
 assert.deepEqual(success(await scan(a,'out',c,'legacy')),original)
 assert.equal((await scan(b,'out',next(),'legacy')).status,409)
 assert.equal(success(await receipt('legacy',`transfer.scanOut.${a}`)).resourceId,a)
 assert.equal(success(await receipt('legacy',`transfer.scanOut.${b}`)).status,'not_found')
})
test('old clients can query an unambiguous newly scoped receipt',async()=>{
 const {order,next,scan,receipt}=ctx,id=await order(),c=next();success(await scan(id,'out',c,'old-client'))
 assert.equal(success(await receipt('old-client','transfer.scanOut')).resourceId,id)
})

test('duplicate equal lines finish after both boxes, including interleaved receipt', async () => {
  const { order, item, next, scan, state } = ctx
  const id = await order([item(5), item(5)]), a = next(), b = next()
  success(await scan(id, 'out', a, 'equal-out1'))
  assert.equal(success(await scan(id, 'in', a, 'equal-in1')).completed, false)
  success(await scan(id, 'out', b, 'equal-out2'))
  assert.equal(success(await scan(id, 'in', b, 'equal-in2')).completed, true)
  assert.deepEqual(await state(id), [
    { quantity: 5, deducted_qty: 5, received_qty: 5 },
    { quantity: 5, deducted_qty: 5, received_qty: 5 },
  ])
})

test('four-decimal duplicate rows preserve exact totals across whole boxes', async () => {
  const { order, item, next, scan, state } = ctx
  const id = await order([item(0.0001), item(9.9999)]), a = next(), b = next()
  success(await scan(id, 'out', a, 'decimal-out1'))
  success(await scan(id, 'out', b, 'decimal-out2'))
  success(await scan(id, 'in', a, 'decimal-in1'))
  assert.equal(success(await scan(id, 'in', b, 'decimal-in2')).completed, true)
  assert.deepEqual(await state(id), [
    { quantity: 0.0001, deducted_qty: 0.0001, received_qty: 0.0001 },
    { quantity: 9.9999, deducted_qty: 9.9999, received_qty: 9.9999 },
  ])
})

test('concurrent duplicate requests move one container once', async () => {
  const { order, next, scan, state } = ctx
  const id = await order(), c = next()
  const outgoing = await Promise.all([scan(id, 'out', c, 'parallel-out'), scan(id, 'out', c, 'parallel-out')])
  assert.deepEqual(success(outgoing[0]), success(outgoing[1]))
  const incoming = await Promise.all([scan(id, 'in', c, 'parallel-in'), scan(id, 'in', c, 'parallel-in')])
  assert.deepEqual(success(incoming[0]), success(incoming[1]))
  assert.deepEqual(await state(id), [{ quantity: 5, deducted_qty: 5, received_qty: 5 }])
})

test('incoming legacy receipts remain replayable after completion and reject another order', async () => {
  const { order, next, scan, receipt, uid, suffix } = ctx
  const a = await order(), b = await order(), ca = next(), cb = next()
  success(await scan(a, 'out', ca, 'legacy-in-out1'))
  success(await scan(b, 'out', cb, 'legacy-in-out2'))
  const original = success(await scan(a, 'in', ca, 'legacy-in'))
  await q("UPDATE operation_requests SET action='transfer.scanIn' WHERE request_key=? AND user_id=?", [suffix + 'legacy-in', uid])
  assert.deepEqual(success(await scan(a, 'in', ca, 'legacy-in')), original)
  assert.equal((await scan(b, 'in', cb, 'legacy-in')).status, 409)
  assert.equal(success(await receipt('legacy-in', `transfer.scanIn.${a}`)).resourceId, a)
  assert.equal(success(await receipt('legacy-in', `transfer.scanIn.${b}`)).status, 'not_found')
})

test('PDA list returns this authorized page of ordered duplicate-line quantities', async () => {
  const { order, item, next, scan, http, payload, wh } = ctx
  const id = await order([item(0.0001), item(9.9999)])
  success(await scan(id, 'out', next(), 'list-partial-out'))
  const [[head]] = await q('SELECT order_no FROM transfer_orders WHERE id=?', [id])
  const listed = success(await http('partial-list', 'GET', `/api/transfer?page=1&pageSize=1&keyword=${encodeURIComponent(head.order_no)}`))
  assert.equal(listed.pagination.total, 1)
  assert.equal(listed.list.length, 1)
  assert.equal(listed.list[0].id, id)
  assert.equal(listed.list[0].status, 3)
  assert.ok(Array.isArray(listed.list[0].items), '列表必须携带逐行数量')
  assert.deepEqual(listed.list[0].items.map(i => [i.quantity, i.deductedQty, i.receivedQty]), [[0.0001, 0.0001, 0], [9.9999, 4.9999, 0]])
  assert.ok(listed.list[0].items[0].id < listed.list[0].items[1].id)
  const hidden = await req('backend/src/modules/transfer/transfer.service').create({ ...payload(1, 2, [item(1)]), operator: { userId: ctx.uid, realName: '列表范围夹具' } })
  const hiddenPage = success(await http('hidden-list', 'GET', `/api/transfer?keyword=${encodeURIComponent(hidden.orderNo)}`))
  assert.deepEqual(hiddenPage.list, [])
  assert.equal(hiddenPage.pagination.total, 0)
  const page = success(await http('bounded-list', 'GET', '/api/transfer?page=1&pageSize=1'))
  assert.equal(page.list.length, 1)
  assert.ok(page.list.every(o => o.fromWarehouseId === wh[0] || o.toWarehouseId === wh[0]))
  const [[expected]] = await q('SELECT COUNT(*) n FROM transfer_order_items WHERE order_id=?', [page.list[0].id])
  assert.equal(page.list[0].items.length, Number(expected.n))
})

test('fixture quantity remains conserved and stock caches match ACTIVE containers', async () => {
  const { product } = evidence.fixtures
  const [[total]] = await q('SELECT SUM(remaining_qty) n, MIN(remaining_qty) minimum FROM inventory_containers WHERE product_id=?', [product])
  assert.equal(Number(total.n), 150)
  assert.ok(Number(total.minimum) >= 0)
  const [stocks] = await q(`SELECT s.warehouse_id, s.quantity,
    (SELECT COALESCE(SUM(c.remaining_qty),0) FROM inventory_containers c
     WHERE c.product_id=s.product_id AND c.warehouse_id=s.warehouse_id AND c.status=1 AND c.deleted_at IS NULL) actual
    FROM inventory_stock s WHERE s.product_id=?`, [product])
  for (const row of stocks) assert.equal(Number(row.quantity), Number(row.actual))
  const [items] = await q('SELECT quantity,deducted_qty,received_qty FROM transfer_order_items WHERE product_id=?', [product])
  for (const row of items) {
    assert.ok(Number(row.quantity) >= Number(row.deducted_qty))
    assert.ok(Number(row.deducted_qty) >= Number(row.received_qty))
  }
  evidence.conservation = { total: Number(total.n), minimum: Number(total.minimum), stocks }
})
