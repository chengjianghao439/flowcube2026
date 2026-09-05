'use strict'
const root=require('node:path').resolve(__dirname, '../..'); const req=p=>require(root+'/'+p)
process.env.NODE_ENV='test'; process.env.DB_NAME ||= 'flowcube_fix_24_test'; /* FLOWCUBE_TEST_ENV_FILE must be supplied explicitly by the caller. */
req('tests/helpers/testEnvironment').configureTestEnvironment()
const fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict')
const {pool}=req('backend/src/config/db'); const q=(...a)=>pool.query(...a)
const express=req('backend/node_modules/express'),jwt=req('backend/node_modules/jsonwebtoken'),bcrypt=req('backend/node_modules/bcryptjs')
const svc=req('backend/src/modules/transfer/transfer.service'),engine=req('backend/src/engine/containerEngine')
const evidence={environment:{database:process.env.DB_NAME,host:process.env.DB_HOST,port:process.env.DB_PORT},calls:[],sql:{}}; let server
async function main(){
 const suffix='R2T'+Date.now(); evidence.suffix=suffix
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
 const app=express(); app.use(express.json());app.use('/api/warehouses',req('backend/src/modules/warehouses/warehouses.routes'));app.use('/api/transfer',req('backend/src/modules/transfer/transfer.routes'));app.use(req('backend/src/middleware/errorHandler'));server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s))});const base='http://127.0.0.1:'+server.address().port
 async function http(label,method,path,body,device,key){const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};if(device!==undefined){headers['X-Client']='pda';headers['X-PDA-Session']=sessions[device]}if(key)headers['X-Request-Key']=suffix+key;const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});const data=await r.json();const record={label,method,path,status:r.status,response:data};if(path.includes('/scan-')) record.sqlAfter={items:(await q('SELECT order_id,quantity,deducted_qty,received_qty FROM transfer_order_items WHERE order_id=?',[Number(path.split('/')[3])]))[0],order:(await q('SELECT id,status FROM transfer_orders WHERE id=?',[Number(path.split('/')[3])]))[0],container:(await q('SELECT barcode,warehouse_id,status,transfer_order_id FROM inventory_containers WHERE barcode=?',[body.containerBarcode]))[0]};evidence.calls.push(record);console.log(JSON.stringify(record));return record}
 const item=quantity=>({productId:product,productCode:suffix+'P',productName:'调拨审计商品',unit:'个',quantity})
 const payload=(from,to,items)=>({fromWarehouseId:wh[from],fromWarehouseName:suffix+'仓'+from,toWarehouseId:wh[to],toWarehouseName:suffix+'仓'+to,items})
 await http('scope-frontend-active-warehouses','GET','/api/warehouses/active');const outside=await http('scope-outside-create','POST','/api/transfer',payload(1,2,[item(1)])); assert.equal(outside.status,201);const outId=outside.response.data.id
 await http('scope-outside-read','GET','/api/transfer/'+outId); await http('scope-outside-confirm','POST','/api/transfer/'+outId+'/confirm')
 const containers=[];const conn=await pool.getConnection();try{await conn.beginTransaction();await engine.lockStockDimension(conn,product,wh[0]);for(let i=0;i<8;i++)containers.push(await engine.createContainer(conn,{productId:product,warehouseId:wh[0],initialQty:5,unit:'个',sourceType:engine.SOURCE_TYPE.TRANSFER,sourceRefId:outId,locationId:loc[0],barcode:suffix+'C'+i}));await engine.syncStockFromContainers(conn,product,wh[0]);await conn.commit()}finally{conn.release()}
 async function order(label,items){const r=await http(label+'-create','POST','/api/transfer',payload(0,1,items));const id=r.response.data.id;await http(label+'-confirm','POST','/api/transfer/'+id+'/confirm');return id}
 async function scan(label,id,type,c,key,device=type==='out'?0:1){return http(label,'POST',`/api/transfer/${id}/scan-${type}`,{containerBarcode:containers[c].barcode,...(type==='in'?{locationId:loc[1]}:{})},device,key)}
 const dup=await order('duplicate',[item(5),item(5)]);await scan('duplicate-first-out',dup,'out',0,'d1');await scan('duplicate-second-out',dup,'out',1,'d2');await scan('duplicate-first-in',dup,'in',0,'di');await scan('duplicate-after-completed',dup,'out',1,'d3')
 const a=await order('replay-A',[item(5)]),b=await order('replay-B',[item(5)]);await scan('replay-A-out',a,'out',2,'shared-out');await scan('replay-B-out-same-key',b,'out',3,'shared-out');await scan('replay-nonexistent-out-same-key',99999999,'out',3,'shared-out',2);await scan('replay-B-out-new-key',b,'out',3,'b-out');await scan('replay-A-in',a,'in',2,'shared-in');await scan('replay-B-in-same-key',b,'in',3,'shared-in');await scan('replay-B-in-new-key',b,'in',3,'b-in')
 const partial=await order('unique-partial',[item(10)]);await scan('unique-first-out',partial,'out',4,'p-out');await scan('unique-first-in',partial,'in',4,'p-in');await scan('unique-second-out-after-completed',partial,'out',5,'p-out2')
 evidence.ids={uid,role,wh,loc,product,orders:[outId,dup,a,b,partial],containers:containers.map(c=>c.containerId)}
 evidence.sql.orders=(await q('SELECT id,status,from_warehouse_id,to_warehouse_id FROM transfer_orders WHERE id IN (?)',[evidence.ids.orders]))[0]
 evidence.sql.items=(await q('SELECT order_id,product_id,quantity,deducted_qty,received_qty FROM transfer_order_items WHERE order_id IN (?) ORDER BY id',[evidence.ids.orders]))[0]
 evidence.sql.containers=(await q('SELECT id,barcode,warehouse_id,status,remaining_qty,transfer_order_id FROM inventory_containers WHERE id IN (?)',[evidence.ids.containers]))[0]
 evidence.sql.operationRequests=(await q('SELECT request_key,action,resource_id,response_json FROM operation_requests WHERE request_key LIKE ?',[suffix+'%']))[0]
 console.log(JSON.stringify(evidence.sql,null,2))
}
main().catch(e=>{evidence.error={message:e.message,stack:e.stack};console.error(e)}).finally(async()=>{fs.writeFileSync('/tmp/flowcube-round2-transfer-evidence.json',JSON.stringify(evidence,null,2));if(server)await new Promise(r=>server.close(r));await pool.end();process.exit(evidence.error?1:0)})
