'use strict'
// Current credit workflow only. Connection targets are explicit loopback test DBs.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { prepareSmokeContext, login } = require('./helpers/smokeTestKit')
const bcrypt = require('../backend/node_modules/bcryptjs')
let ctx, applicant, applicantId, finance, financeId, noRights, admin, adminId, productId
const flowByOrder = new Map()
const ref = 'reapply' + crypto.randomBytes(5).toString('hex')
const status = (r, n) => assert.equal(r.status, n, JSON.stringify(r.data))
const post = (path, json = {}, token = applicant) => ctx.http.post(path, { token, json, headers: { 'X-Request-Key': crypto.randomUUID() } })
const detail = async id => (await ctx.http.get(`/api/credit-overrides/${id}`, { token: applicant })).data.data
before(async () => {
  ctx = await prepareSmokeContext()
  const logged = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!'); admin = logged.token || logged.data?.token
  const [[u]] = await ctx.pool.query("SELECT id FROM sys_users WHERE username='smoke_admin' AND deleted_at IS NULL"); adminId = u.id
  const [r] = await ctx.pool.query('INSERT INTO sys_roles (code,name,is_system) VALUES (?,?,0)', [ref, '合成重新申请'])
  const rights = ['sale.order.create','sale.order.update','sale.order.view','sale.order.reserve','sale.order.release','sale.order.cancel','sale.credit.override.apply','sale.credit.override.view']
  await ctx.pool.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES ?', [rights.map(p => [r.insertId,p])])
  const [user] = await ctx.pool.query('INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active) VALUES (?,?,?,?,?,1)', [ref,bcrypt.hashSync('SyntheticReapply123!',4),'合成申请人',r.insertId,'合成重新申请']); applicantId=user.insertId
  const signed = await login(ctx.http, ref, 'SyntheticReapply123!'); applicant = signed.token || signed.data?.token
  for (const [suffix, permissions] of [['finance',['sale.credit.override.approve','sale.credit.override.view','approval.task.view']],['none',[]]]) {
    const [role] = await ctx.pool.query('INSERT INTO sys_roles (code,name,is_system) VALUES (?,?,0)',[ref+suffix,'合成同步资格'])
    if (permissions.length) await ctx.pool.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES ?',[permissions.map(p=>[role.insertId,p])])
    const [created] = await ctx.pool.query('INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active) VALUES (?,?,?,?,?,1)',[ref+suffix,bcrypt.hashSync('SyntheticReapply123!',4),'合成同步资格',role.insertId,'合成同步资格'])
    const logged = await login(ctx.http,ref+suffix,'SyntheticReapply123!'), token=logged.token || logged.data?.token
    if (suffix==='finance') { finance=token;financeId=created.insertId } else noRights=token
  }
  const [p] = await ctx.pool.query("INSERT INTO product_items (code,name,unit,sale_price_a,cost_price,avg_cost) VALUES (?,?,'个',1,1,1)", [ref,'合成重新申请商品']); productId = p.insertId
  const engine = require('../backend/src/engine/containerEngine'), conn = await ctx.pool.getConnection()
  try {
    await conn.beginTransaction()
    const c = await engine.createContainer(conn, { productId,warehouseId:ctx.warehouse.id,initialQty:30,locationId:ctx.location.id,sourceType:engine.SOURCE_TYPE.MANUAL,sourceRefId:productId,remark:'本用例合成铺底',containerStatus:engine.CONTAINER_STATUS.PENDING_PUTAWAY })
    await engine.promotePendingContainerToActive(conn,c.containerId,productId,ctx.warehouse.id)
    await conn.commit()
  } catch(e) { await conn.rollback(); throw e } finally { conn.release() }
})
after(async () => { if (ctx) await ctx.close(); await require('../backend/src/config/db').pool.end() })

async function order() {
  const [c] = await ctx.pool.query('INSERT INTO sale_customers (code,name,credit_limit) VALUES (?,?,1)', [ref+crypto.randomBytes(3).toString('hex'),'合成重新申请客户'])
  const price = 7000 + c.insertId * 10
  const body = { customerId:c.insertId,customerName:'合成重新申请客户',warehouseId:ctx.warehouse.id,warehouseName:ctx.warehouse.name,items:[{productId,productCode:ref,productName:'合成重新申请商品',unit:'个',quantity:2,unitPrice:price}] }
  const r = await post('/api/sale',body); status(r,201)
  return { id:Number(r.data.data.id),body,price }
}
async function request(o, approve = true, expiresAt) {
  const [f] = await ctx.pool.query("INSERT INTO approval_flows (biz_type,name,min_amount,max_amount,is_active) VALUES ('sale_credit_override',?,?,?,1)", [ref,2*o.price-1,2*o.price-1])
  flowByOrder.set(o.id,f.insertId)
  await ctx.pool.query('INSERT INTO approval_flow_steps (flow_id,step_order,approver_type,user_id) VALUES (?,1,3,?)', [f.insertId,adminId])
  const r = await post('/api/credit-overrides',{saleOrderId:o.id,reason:'合成首轮授信',...(expiresAt?{expiresAt}:{})}); status(r,201)
  const id = r.data.data.id
  status(await post(`/api/credit-overrides/${id}/submit`),200)
  if (approve) {
    const task = (await detail(id)).currentTaskId || (await ctx.http.get(`/api/credit-overrides/${id}`,{token:admin})).data.data.currentTaskId
    status(await post(`/api/credit-overrides/${id}/approve`,{expectedTaskId:task},admin),200)
  }
  return id
}
async function history(id) {
  const [document] = await ctx.pool.query('SELECT * FROM sale_credit_overrides WHERE id=?',[id])
  const [instances] = await ctx.pool.query("SELECT * FROM approval_instances WHERE biz_type='sale_credit_override' AND biz_id=? ORDER BY id",[id])
  const [tasks] = await ctx.pool.query("SELECT t.* FROM approval_instance_tasks t JOIN approval_instances i ON i.id=t.instance_id WHERE i.biz_type='sale_credit_override' AND i.biz_id=? ORDER BY t.id",[id])
  const [actions] = await ctx.pool.query('SELECT * FROM sale_credit_approval_actions WHERE override_id=? ORDER BY id',[id])
  return JSON.stringify({document,instances,tasks,actions})
}
async function changed(o) {
  const d = (await ctx.http.get(`/api/sale/${o.id}`,{token:applicant})).data.data
  const r = await ctx.http.put(`/api/sale/${o.id}`,{token:applicant,json:{...o.body,items:[{...o.body.items[0],unitPrice:o.price+1}],expectedEditFingerprint:d.editFingerprint,changeReason:'合成修改单价'},headers:{'X-Request-Key':crypto.randomUUID()}})
  status(r,200)
}
async function invalidReserve(o, reason) {
  const r = await post(`/api/sale/${o.id}/reserve`); status(r,409)
  assert.equal(r.data.code,'CREDIT_APPROVAL_INVALID')
  assert.equal(r.data.data.reasonCode,reason)
  assert.match(r.data.message,/原批准已失效/)
  return r.data.message
}
async function reapply(o, id, why) {
  const original = await history(id)
  const before = await detail(id)
  assert.equal(before.status,3); assert.equal(before.approvalValidity,'invalid'); assert.equal(before.approvalInvalidReasonCode,why)
  const r = await post('/api/credit-overrides',{saleOrderId:o.id,reason:'合成重新申请'}); status(r,201)
  assert.notEqual(r.data.data.id,id)
  assert.equal((await detail(r.data.data.id)).status,1)
  assert.equal(await history(id),original,'旧申请、审批实例、节点和逐节点审计必须逐字段保留')
  assert.equal((await detail(id)).approvalInvalidReasonCode,'SUPERSEDED')
  return r.data.data.id
}

test('改价后明确提示失效、无需取消旧批准即可重新申请，完整保留历史',async()=>{
  const o=await order(), id=await request(o)
  await changed(o)
  const message=await invalidReserve(o,'CONTENT_CHANGED')
  const conn=await ctx.pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[current]]=await conn.query('SELECT * FROM sale_orders WHERE id=? FOR UPDATE',[o.id])
    const ship=require('../backend/src/modules/warehouse-tasks/warehouse-tasks.ship')
    await assert.rejects(ship.assertCreditWithinLimit(conn,current.customer_id,Number(current.total_amount),{userId:adminId,roleId:1},o.id),e=>e.code==='CREDIT_APPROVAL_INVALID' && e.message===message)
    await conn.rollback()
  } finally {conn.release()}
  await reapply(o,id,'CONTENT_CHANGED')
})

test('无内容证明的旧批准不补证、不恢复，也不阻塞新的正常申请',async()=>{
  const o=await order(), id=await request(o)
  // Only this case's synthetic proof is removed to model a pre-294 approval.
  await ctx.pool.query('DELETE FROM sale_credit_approval_proofs WHERE override_id=?',[id])
  await invalidReserve(o,'MISSING_PROOF')
  await reapply(o,id,'MISSING_PROOF')
  const [[r]]=await ctx.pool.query('SELECT COUNT(*) n FROM sale_credit_approval_proofs WHERE override_id=?',[id]);assert.equal(Number(r.n),0)
})

test('过期后保留原预占，禁止新增占库，部分占库单可重申且仍能正常释放',async()=>{
  const o=await order(), id=await request(o,true,new Date(Date.now()+86400000).toISOString())
  const [[item]]=await ctx.pool.query('SELECT id FROM sale_order_items WHERE order_id=?',[o.id])
  status(await post(`/api/sale/${o.id}/reserve`,{items:[{id:item.id,warehouseId:ctx.warehouse.id,warehouseName:ctx.warehouse.name,qty:1}]}),200)
  const stock=async()=>{const [r]=await ctx.pool.query('SELECT quantity,reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',[productId,ctx.warehouse.id]);return JSON.stringify(r)}
  const originalStock=await stock()
  await ctx.pool.query('UPDATE sale_credit_approval_proofs SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE override_id=?',[id])
  await invalidReserve(o,'EXPIRED')
  assert.equal(await stock(),originalStock)
  await reapply(o,id,'EXPIRED')
  assert.equal(await stock(),originalStock,'新申请不会释放或重新构造原预占')
  const another=await post('/api/sale',o.body);status(another,201)
  const [orders]=await ctx.pool.query('SELECT * FROM sale_orders WHERE id IN (?)',[[o.id,another.data.data.id]])
  const exposure=require('../backend/src/utils/creditExposure')
  const batch=await exposure.getCustomerCreditUsedForOrders(ctx.pool,orders)
  for(const r of orders)assert.equal(batch.get(Number(r.id)),await exposure.getCustomerCreditUsed(ctx.pool,r.customer_id,{excludeSaleOrderId:r.id}))
  assert.ok(batch.get(Number(another.data.data.id))>0,'另单应计入当前真实部分占库敞口')
  status(await post(`/api/sale/${o.id}/release`,{items:[{id:item.id,qty:1}]}),200)
  const [[row]]=await ctx.pool.query('SELECT reserved_qty FROM sale_order_items WHERE id=?',[item.id]);assert.equal(Number(row.reserved_qty),0)
})

test('有效批准、草稿和待审批申请继续防重复，旧审批不被重做',async()=>{
  for(const state of ['valid','draft','pending']){
    const o=await order()
    let id
    if(state==='draft'){const r=await post('/api/credit-overrides',{saleOrderId:o.id,reason:'合成草稿'});status(r,201);id=r.data.data.id}
    else id=await request(o,state==='valid')
    const original=await history(id)
    const r=await post('/api/credit-overrides',{saleOrderId:o.id,reason:'合成重复'});status(r,409);assert.equal(r.data.code,'CREDIT_OVERRIDE_DUPLICATE')
    assert.equal(await history(id),original)
  }
})

test('失效批准下的两个并发重申只新建一张草稿，原历史不变',async()=>{
  const o=await order(),id=await request(o)
  await changed(o)
  const original=await history(id)
  const results=await Promise.all([post('/api/credit-overrides',{saleOrderId:o.id,reason:'合成并发甲'}),post('/api/credit-overrides',{saleOrderId:o.id,reason:'合成并发乙'})])
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409])
  assert.equal(results.find(r=>r.status===409).data.code,'CREDIT_OVERRIDE_DUPLICATE')
  const [[r]]=await ctx.pool.query('SELECT COUNT(*) n FROM sale_credit_overrides WHERE sale_order_id=? AND status=1',[o.id]);assert.equal(Number(r.n),1)
  assert.equal(await history(id),original)
})

test('新申请取消后也不自动复活被替代的旧批准',async()=>{
  const o=await order(),id=await request(o,true,new Date(Date.now()+86400000).toISOString())
  await ctx.pool.query('UPDATE sale_credit_approval_proofs SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE override_id=?',[id])
  const next=await reapply(o,id,'EXPIRED')
  status(await post(`/api/credit-overrides/${next}/cancel`),200)
  // Adversarial fixture restoration cannot bypass permanent supersession.
  await ctx.pool.query('UPDATE sale_credit_approval_proofs SET expires_at=DATE_ADD(NOW(),INTERVAL 1 DAY) WHERE override_id=?',[id])
  await invalidReserve(o,'SUPERSEDED')
  assert.equal((await detail(id)).status,3)
})

test('重申链保留独立权限：无权或仅审批不能申请，申请权加自批开关不能审批，合法财务可批新单',async()=>{
  const o=await order(),id=await request(o,true,new Date(Date.now()+86400000).toISOString())
  await ctx.pool.query('UPDATE sale_credit_approval_proofs SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE override_id=?',[id])
  const original=await history(id)
  for (const token of [noRights,finance]) status(await post('/api/credit-overrides',{saleOrderId:o.id,reason:'合成越权重申'},token),403)
  const [[count]]=await ctx.pool.query('SELECT COUNT(*) n FROM sale_credit_overrides WHERE sale_order_id=?',[o.id]);assert.equal(Number(count.n),1)
  assert.equal(await history(id),original)
  const next=await reapply(o,id,'EXPIRED')
  // This case's synthetic template configures the next request; the completed
  // original instance/tasks remain byte-for-byte unchanged.
  await ctx.pool.query('UPDATE approval_flow_steps SET user_id=? WHERE flow_id=?',[financeId,flowByOrder.get(o.id)])
  await ctx.pool.query('UPDATE sys_users SET allow_self_approve=1 WHERE id=?',[applicantId])
  try {
    status(await post(`/api/credit-overrides/${next}/submit`),200)
    const d=(await ctx.http.get(`/api/credit-overrides/${next}`,{token:finance})).data.data
    assert.equal(d.canApprove,true);assert.equal(d.canManage,false);assert.ok(d.currentTaskId)
    const body={expectedTaskId:d.currentTaskId,reason:'合成独立财务审批'}
    status(await post(`/api/credit-overrides/${next}/approve`,body),403)
    assert.equal((await detail(next)).status,2)
    const [[actions]]=await ctx.pool.query('SELECT COUNT(*) n FROM sale_credit_approval_actions WHERE override_id=?',[next]);assert.equal(Number(actions.n),0)
    status(await post(`/api/credit-overrides/${next}/approve`,body,finance),200)
    assert.equal((await detail(next)).status,3)
    const [[audit]]=await ctx.pool.query('SELECT approver_id,is_self_approval,authorization_basis FROM sale_credit_approval_actions WHERE override_id=?',[next])
    assert.equal(Number(audit.approver_id),Number(financeId));assert.equal(Number(audit.is_self_approval),0)
    const basis=typeof audit.authorization_basis==='string'?JSON.parse(audit.authorization_basis):audit.authorization_basis
    assert.ok(basis.requiredPermissions.includes('sale.credit.override.approve'));assert.ok(!basis.requiredPermissions.includes('sale.credit.override.apply'))
    status(await post(`/api/sale/${o.id}/reserve`),200)
    assert.equal(await history(id),original)
    assert.equal((await detail(id)).approvalInvalidReasonCode,'SUPERSEDED')
  } finally { await ctx.pool.query('UPDATE sys_users SET allow_self_approve=0 WHERE id=?',[applicantId]) }
})
