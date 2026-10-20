'use strict'
const { test,before,after }=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('node:crypto')
const bcrypt=require('../backend/node_modules/bcryptjs')
const {prepareSmokeContext,login}=require('./helpers/smokeTestKit')
const policy=require('../backend/src/modules/credit-overrides/credit-overrides.policy')
const ref='pending'+crypto.randomBytes(5).toString('hex')
let ctx,owner,reviewer,ownerId,reviewerId,productId,admin
const status=(r,n)=>assert.equal(r.status,n,JSON.stringify(r.data))
const post=(path,json={},token=owner)=>ctx.http.post(path,{token,json,headers:{'X-Request-Key':crypto.randomUUID()}})
const detail=async(id,token=owner)=>(await ctx.http.get(`/api/credit-overrides/${id}`,{token})).data.data
before(async()=>{
 ctx=await prepareSmokeContext();const a=await login(ctx.http,'smoke_admin','SmokeAdmin123!');admin=a.token||a.data?.token
 for(const [kind,permissions]of[['owner',['sale.order.create','sale.order.view','sale.order.reserve','sale.credit.override.apply','sale.credit.override.view']],['reviewer',policy.ACTION_PERMISSIONS]]){
  const[r]=await ctx.pool.query('INSERT INTO sys_roles (code,name,is_system) VALUES (?,?,0)',[ref+kind,'合成过期回归'])
  await ctx.pool.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES ?',[permissions.map(p=>[r.insertId,p])])
  const[u]=await ctx.pool.query('INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active) VALUES (?,?,?,?,?,1)',[ref+kind,bcrypt.hashSync('SyntheticPending123!',4),'合成过期回归',r.insertId,'合成过期回归'])
  await ctx.pool.query('INSERT INTO user_warehouse_scope (user_id,warehouse_id) VALUES (?,?)',[u.insertId,ctx.warehouse.id])
  const l=await login(ctx.http,ref+kind,'SyntheticPending123!'),token=l.token||l.data?.token
  if(kind==='owner'){owner=token;ownerId=u.insertId}else{reviewer=token;reviewerId=u.insertId}
 }
 const[p]=await ctx.pool.query("INSERT INTO product_items (code,name,unit,sale_price_a,cost_price,avg_cost) VALUES (?,?,'个',10,1,1)",[ref,'合成过期商品']);productId=p.insertId
 const engine=require('../backend/src/engine/containerEngine'),c=await ctx.pool.getConnection()
 try{await c.beginTransaction();const stock=await engine.createContainer(c,{productId,warehouseId:ctx.warehouse.id,initialQty:20,locationId:ctx.location.id,sourceType:engine.SOURCE_TYPE.MANUAL,sourceRefId:productId,remark:'合成过期测试铺底',containerStatus:engine.CONTAINER_STATUS.PENDING_PUTAWAY});await engine.promotePendingContainerToActive(c,stock.containerId,productId,ctx.warehouse.id);await c.commit()}catch(e){await c.rollback();throw e}finally{c.release()}
})
after(async()=>{if(ctx)await ctx.close();await require('../backend/src/config/db').pool.end()})
async function pending(expiresAt=new Date(Date.now()+86400000).toISOString()){
 const[c]=await ctx.pool.query('INSERT INTO sale_customers (code,name,credit_limit) VALUES (?,?,1)',[ref+crypto.randomBytes(3).toString('hex'),'合成待审批过期客户'])
 const price=9000+c.insertId*10,amount=2*price-1
 const so=await post('/api/sale',{customerId:c.insertId,customerName:'合成待审批过期客户',warehouseId:ctx.warehouse.id,warehouseName:ctx.warehouse.name,items:[{productId,productCode:ref,productName:'合成过期商品',unit:'个',quantity:2,unitPrice:price}]});status(so,201)
 const[f]=await ctx.pool.query("INSERT INTO approval_flows (biz_type,name,min_amount,max_amount,is_active) VALUES ('sale_credit_override',?,?,?,1)",[ref,amount,amount])
 await ctx.pool.query('INSERT INTO approval_flow_steps (flow_id,step_order,approver_type,user_id) VALUES (?,1,3,?)',[f.insertId,reviewerId])
 const applied=await post('/api/credit-overrides',{saleOrderId:so.data.data.id,reason:'合成过期申请',expiresAt});status(applied,201)
 const id=applied.data.data.id;status(await post(`/api/credit-overrides/${id}/submit`),200)
 const d=await detail(id,reviewer)
 return{id,orderId:so.data.data.id,taskId:d.currentTaskId}
}
async function expire(id){await ctx.pool.query('UPDATE sale_credit_approval_proofs SET expires_at=NOW() WHERE override_id=?',[id])}
async function history(id){
 const[document]=await ctx.pool.query('SELECT * FROM sale_credit_overrides WHERE id=?',[id])
 const[proof]=await ctx.pool.query('SELECT * FROM sale_credit_approval_proofs WHERE override_id=?',[id])
 const[instances]=await ctx.pool.query("SELECT * FROM approval_instances WHERE biz_type='sale_credit_override' AND biz_id=? ORDER BY id",[id])
 const[tasks]=await ctx.pool.query("SELECT t.* FROM approval_instance_tasks t JOIN approval_instances i ON i.id=t.instance_id WHERE i.biz_type='sale_credit_override' AND i.biz_id=? ORDER BY t.id",[id])
 const[actions]=await ctx.pool.query('SELECT * FROM sale_credit_approval_actions WHERE override_id=? ORDER BY id',[id])
 return JSON.stringify({document,proof,instances,tasks,actions})
}
test('过期待审在列表与详情明确显示，可直接重申且完整保留原申请及审批历史',async()=>{
 const o=await pending();await expire(o.id);const old=await history(o.id)
 const d=await detail(o.id);assert.equal(d.status,2);assert.equal(d.statusName,'已过期');assert.match(d.requestInvalidReason,/已过期/);assert.equal(d.canReapply,true)
 const list=await ctx.http.get(`/api/credit-overrides?saleOrderId=${o.orderId}`,{token:owner});status(list,200)
 const row=list.data.data.list.find(r=>r.id===o.id);assert.equal(row.statusName,'已过期');assert.equal(row.canReapply,true)
 const n=await post('/api/credit-overrides',{saleOrderId:o.orderId,reason:'合成过期待审重申'});status(n,201)
 assert.equal((await detail(n.data.data.id)).status,1);assert.equal(await history(o.id),old)
 assert.equal((await detail(o.id)).canReapply,false)
})
test('过期待审并发重申只建一张新草稿，旧历史不取消也不改写',async()=>{
 const o=await pending();await expire(o.id);const old=await history(o.id)
 const r=await Promise.all([post('/api/credit-overrides',{saleOrderId:o.orderId,reason:'并发重申甲'}),post('/api/credit-overrides',{saleOrderId:o.orderId,reason:'并发重申乙'})])
 assert.deepEqual(r.map(v=>v.status).sort(),[201,409]);assert.equal(r.find(v=>v.status===409).data.code,'CREDIT_OVERRIDE_DUPLICATE')
 const[[count]]=await ctx.pool.query('SELECT COUNT(*) n FROM sale_credit_overrides WHERE sale_order_id=? AND status=1',[o.orderId]);assert.equal(Number(count.n),1);assert.equal(await history(o.id),old)
})
test('过期待审不能批准或占库，合法审批人直接调用API也被拒绝且没有业务副作用',async()=>{
 const o=await pending();await expire(o.id);const old=await history(o.id)
 const d=await detail(o.id,reviewer);assert.equal(d.canApprove,false)
 const a=await post(`/api/credit-overrides/${o.id}/approve`,{expectedTaskId:o.taskId,reason:'合成过期审批'},reviewer);status(a,409);assert.equal(a.data.code,'CREDIT_APPROVAL_EXPIRED')
 const r=await post(`/api/sale/${o.orderId}/reserve`);status(r,409);assert.equal(r.data.code,'CREDIT_LIMIT_EXCEEDED');assert.equal(await history(o.id),old)
})
test('未过期待审仍防重复，合法节点仍可批准；原申请人无审批资格不能自批',async()=>{
 const o=await pending();assert.equal(!!(await detail(o.id)).canReapply,false)
 const dup=await post('/api/credit-overrides',{saleOrderId:o.orderId,reason:'合成重复'});status(dup,409)
 await ctx.pool.query('UPDATE sys_users SET allow_self_approve=1 WHERE id=?',[ownerId])
 try{status(await post(`/api/credit-overrides/${o.id}/approve`,{expectedTaskId:o.taskId,reason:'合成越权自批'}),403)}finally{await ctx.pool.query('UPDATE sys_users SET allow_self_approve=0 WHERE id=?',[ownerId])}
 status(await post(`/api/credit-overrides/${o.id}/approve`,{expectedTaskId:o.taskId,reason:'合成正常审批'},reviewer),200)
})
test('定位占库额外403：申请人可读本单预览，但不能读取仓库目录或审批待办；有权账号仍可读目录',async()=>{
 const o=await pending();status(await ctx.http.get(`/api/sale/${o.orderId}/reserve-preview`,{token:owner}),200)
 const denied=await ctx.http.get('/api/warehouses/active',{token:owner});status(denied,403);assert.match(denied.data.message,/无操作权限/)
 status(await ctx.http.get('/api/approvals/pending',{token:owner}),403)
 status(await ctx.http.get('/api/warehouses/active',{token:admin}),200)
})

async function crossExpiryWhileProofLocked(o,send){
 const holder=await ctx.pool.getConnection(),appPool=require('../backend/src/config/db').pool,original=appPool.getConnection
 let signal;const started=new Promise(resolve=>{signal=resolve});let response,timer
 await holder.beginTransaction();await holder.query('SELECT override_id FROM sale_credit_approval_proofs WHERE override_id=? FOR UPDATE',[o.id])
 appPool.getConnection=async()=>{
  const c=await original.call(appPool)
  return new Proxy(c,{get(target,key){
   if(key==='query')return async(sql,params)=>{if(String(sql).includes('sale_credit_approval_proofs'))signal();return target.query(sql,params)}
   const value=target[key];return typeof value==='function'?value.bind(target):value
  }})
 }
 try{
  response=send()
  await Promise.race([started,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('未进入真实证明锁等待')),5000)})]);clearTimeout(timer)
  const until=Date.now()+6000
  while(true){const[[r]]=await holder.query('SELECT expires_at<=NOW() expired FROM sale_credit_approval_proofs WHERE override_id=?',[o.id]);if(Number(r.expired))break;assert.ok(Date.now()<until,'未跨过实际数据库截止时间');await new Promise(resolve=>setTimeout(resolve,25))}
  await holder.commit();return await response
 }finally{clearTimeout(timer);await holder.rollback();holder.release();if(response)await Promise.allSettled([response]);appPool.getConnection=original}
}
test('审批等待证明锁跨过截止时间后必须拒绝，不能使用等待前的NOW放行',async()=>{
 const o=await pending(new Date(Date.now()+3500).toISOString())
 const r=await crossExpiryWhileProofLocked(o,()=>post(`/api/credit-overrides/${o.id}/approve`,{expectedTaskId:o.taskId,reason:'合成锁等待审批'},reviewer))
 status(r,409);assert.equal(r.data.code,'CREDIT_APPROVAL_EXPIRED');assert.equal((await detail(o.id)).status,2)
})
test('重申等待证明锁跨过截止时间后按锁后的时间判断，可以创建新草稿',async()=>{
 const o=await pending(new Date(Date.now()+3500).toISOString())
 const r=await crossExpiryWhileProofLocked(o,()=>post('/api/credit-overrides',{saleOrderId:o.orderId,reason:'合成锁等待重申'}))
 status(r,201);assert.equal((await detail(o.id)).status,2);assert.equal((await detail(r.data.data.id)).status,1)
})
test('重申取消后旧待审也不复活，待办/按钮/API共同拒绝已被替代的旧节点',async()=>{
 const o=await pending();await expire(o.id)
 const r=await post('/api/credit-overrides',{saleOrderId:o.orderId,reason:'合成替代申请'});status(r,201)
 status(await post(`/api/credit-overrides/${r.data.data.id}/cancel`),200)
 // Adversarial restoration is fixture-only; production never edits old proof.
 await ctx.pool.query('UPDATE sale_credit_approval_proofs SET expires_at=DATE_ADD(NOW(),INTERVAL 1 DAY) WHERE override_id=?',[o.id])
 const d=await detail(o.id,reviewer);assert.equal(d.status,2);assert.equal(d.requestValidity,'superseded');assert.equal(d.canApprove,false)
 const todo=await ctx.http.get('/api/approvals/pending',{token:reviewer});status(todo,200);assert.ok(!todo.data.data.list.some(x=>Number(x.bizId)===Number(o.id)&&x.bizType==='sale_credit_override'))
 const a=await post(`/api/credit-overrides/${o.id}/approve`,{expectedTaskId:o.taskId,reason:'合成旧待审复活攻击'},reviewer);status(a,409);assert.equal(a.data.code,'CREDIT_APPROVAL_SUPERSEDED')
 const another=await post('/api/credit-overrides',{saleOrderId:o.orderId,reason:'合成再次申请'});status(another,201)
})
