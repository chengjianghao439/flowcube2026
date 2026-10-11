'use strict'
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..'), task=process.env.FLOWCUBE_RETENTION_EVIDENCE_DIR
process.env.FLOWCUBE_REPO_ROOT=root
const req=p=>require(root+'/'+p)
const must=r=>{assert.ok(r.status>=200&&r.status<300&&r.data?.success===true,JSON.stringify(r));return r.data.data}
async function setup(label,{database='flowcube_retentionreprint20261010_test'}={}){
 const config=req('tests/helpers/testEnvironment').validateTestEnvironment();assert.equal(config.database,database)
 const mysql=req('backend/node_modules/mysql2/promise'),pool=mysql.createPool({...config,dateStrings:true,timezone:'+08:00',connectionLimit:8})
 const conn=await pool.getConnection();try{await req('tests/helpers/repairInstanceOwnership').assertOwnedRepairInstance(conn,{config});if(task){fs.mkdirSync(task,{recursive:true});fs.copyFileSync(process.env.FLOWCUBE_REPAIR_INSTANCE_FILE,path.join(task,'ownership.json'))}assert.equal((await conn.query('SELECT DATABASE() db'))[0][0].db,config.database)}finally{conn.release()}
 const c={pool,mark:'R4'+crypto.randomBytes(4).toString('hex'),evidence:[],req}
 c.rows=async(sql,a=[])=>(await pool.query(sql,a))[0];c.one=async(sql,a=[])=>(await c.rows(sql,a))[0];c.insert=async(sql,a=[])=>Number((await pool.query(sql,a))[0].insertId)
 c.wh=async(s)=>{const code=c.mark+s;const id=await c.insert('INSERT INTO inventory_warehouses(code,name) VALUES (?,?)',[code,code]);const location=await c.insert('INSERT INTO warehouse_locations(warehouse_id,code,name) VALUES (?,?,?)',[id,code,code]);return{id,name:code,location}}
 c.a=await c.wh('A');c.b=await c.wh('B')
 c.supplier={id:await c.insert('INSERT INTO supply_suppliers(code,name,settlement_type) VALUES (?,?,2)',[c.mark,c.mark]),name:c.mark}
 c.customer={id:await c.insert('INSERT INTO sale_customers(code,name,credit_limit) VALUES (?,?,NULL)',[c.mark,c.mark]),name:c.mark}
 const bcrypt=req('backend/node_modules/bcryptjs'),password=crypto.randomBytes(24).toString('hex')
 c.userId=await c.insert('INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active,allow_self_approve) VALUES (?,?,?,1,?,1,1)',[c.mark,await bcrypt.hash(password,10),c.mark,c.mark])
 c.pda=async wh=>{const code=wh.name;const secret=crypto.randomBytes(24).toString('hex');await c.insert("INSERT INTO pda_devices(device_code,device_name,warehouse_id,status,secret_hash) VALUES (?,?,?,'active',?)",[code,code,wh.id,await bcrypt.hash(secret,10)]);const s=await req('backend/src/modules/pda/pda.sessions.service').createSession({deviceCode:code,deviceSecret:secret,userId:c.userId});return{'X-Client':'pda','X-PDA-Session':s.sessionToken}}
 c.a.headers=await c.pda(c.a);c.b.headers=await c.pda(c.b)
 c.clientId=c.mark
 const print=req('tests/helpers/printClientIdentity');c.printClient=await print.provisionTestPrintClient(pool,{clientId:c.clientId,warehouseId:c.a.id})
 c.printerId=await c.insert('INSERT INTO printers(code,name,client_id,type,status,warehouse_id) VALUES (?,?,?,1,1,?)',[c.mark,c.mark,c.clientId,c.a.id])
 const raster=req('backend/src/modules/print-jobs/labelRasterService');raster.renderLabelAsync=async()=>{if(c.renderFail)throw Object.assign(new Error('synthetic renderer failure'),{code:'LABEL_RENDER_FAILED'});return {zpl:'^XA^FO10,10^ADN,18,10^FDTEST-ONLY^FS^XZ'}}
 await c.pool.query('INSERT INTO printer_bindings(warehouse_id,print_type,printer_id,printer_code) VALUES (?,?,?,?)',[c.a.id,'package_label',c.printerId,c.mark])
 c.apiPool=req('backend/src/config/db').pool
 const app=req('backend/src/app');c.server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject)})
 c.request=async(method,route,body,opts={})=>{const res=await fetch(`http://127.0.0.1:${c.server.address().port}/api${route}`,{method,redirect:'manual',signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json','X-Client-Id':c.clientId,...(c.token?{Authorization:'Bearer '+c.token}:{}),...(method==='GET'?{}:{'X-Request-Key':opts.key||(route.includes('/reprint') ? `reprint-v2-${Date.now()}-${crypto.randomUUID()}` : crypto.randomUUID())}),...opts.headers},body:body===undefined?undefined:JSON.stringify(body)});return{status:res.status,data:await res.json()}}
 c.ok=async(m,p,b,o)=>must(await c.request(m,p,b,o));const auth=await c.ok('POST','/auth/login',{username:c.mark,password});c.token=auth.token
 c.product=async(tag,options={})=>{const code=c.mark+tag;const id=await c.insert("INSERT INTO product_items(code,name,unit,sale_price_a,cost_price,avg_cost,allow_decimal_qty) VALUES (?,?,'个',?,?,?,1)",[code,code,options.sale??20,options.cost===undefined?10:options.cost,options.avg===undefined?10:options.avg]);return{id,code,name:code,unit:'个'}}
 c.receive=async(tag,qty=10)=>{const product=await c.product(tag);const po=await c.ok('POST','/purchase',{supplierId:c.supplier.id,supplierName:c.supplier.name,warehouseId:c.a.id,warehouseName:c.a.name,items:[{productId:product.id,productCode:product.code,productName:product.name,unit:'个',quantity:qty,unitPrice:10}]});await c.ok('POST',`/purchase/${po.id}/confirm`,{});const it=await c.ok('POST','/inbound-tasks',{poId:po.id});await c.ok('POST',`/inbound-tasks/${it.taskId}/submit`,{});await c.ok('POST',`/inbound-tasks/${it.taskId}/receive`,{productId:product.id,packages:[{qty}]},{headers:c.a.headers});const box=await c.one('SELECT * FROM inventory_containers WHERE inbound_task_id=?',[it.taskId]);await c.ok('POST',`/inbound-tasks/${it.taskId}/putaway`,{containerId:box.id,locationId:c.a.location},{headers:c.a.headers});return{product,poId:po.id,taskId:it.taskId,containerId:box.id,barcode:box.barcode,qty}}
 c.record=(name,input,result,expected,verdict='observed')=>{c.evidence.push({name,input,expected,result,verdict});console.log(JSON.stringify({name,verdict}))}
 c.save=()=>{if(task){fs.mkdirSync(task,{recursive:true});fs.writeFileSync(path.join(task,label+'.json'),JSON.stringify(c.evidence,null,2))}}
 c.close=async()=>{c.save();c.server?.closeAllConnections?.();if(c.server)await new Promise(r=>c.server.close(r));await c.apiPool?.end();await pool.end();console.log('CLOSED API/pools '+c.mark)}
 return c
}
module.exports={setup,req,must,root,task,assert}
