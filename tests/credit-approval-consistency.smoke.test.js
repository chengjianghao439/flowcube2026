// Synthetic, isolated HTTP/MySQL regression. No historical database or cleanup.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { prepareSmokeContext, login } = require('./helpers/smokeTestKit')
const bcrypt = require('../backend/node_modules/bcryptjs')

async function main() {
  const ctx = await prepareSmokeContext({ requestTimeoutMs: 20000 })
  const { pool, http } = ctx
  const ref = 'credit' + crypto.randomBytes(5).toString('hex')
  let passed = 0
  const check = (label, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('PASS', label) })
  const expectStatus = (result, status) => assert.equal(result.status, status, JSON.stringify(result.data))
  try {
    const admin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    const adminToken = admin.token || admin.data?.token
    const permissions = ['sale.order.create','sale.order.view','sale.order.update','sale.order.reserve','sale.order.release','sale.order.ship','sale.order.cancel','sale.credit.override','sale.credit.override.apply','sale.credit.override.approve','sale.credit.override.view','approval.task.view']
    const [role] = await pool.query('INSERT INTO sys_roles (code,name,is_system) VALUES (?,?,0)', [ref, '合成授信回归'])
    await pool.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES ?', [permissions.map(p => [role.insertId,p])])
    const [financeRole] = await pool.query('INSERT INTO sys_roles (code,name,is_system) VALUES (?,?,0)', [ref+'Finance', '合成仅审批财务'])
    const financePermissions = ['sale.credit.view','sale.credit.override.view','sale.credit.override.approve','approval.task.view']
    await pool.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES ?', [financePermissions.map(p => [financeRole.insertId,p])])
    async function user(suffix, self, roleId = role.insertId) {
      const [r] = await pool.query('INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active,allow_self_approve) VALUES (?,?,?,?,?,1,?)', [ref+suffix,bcrypt.hashSync('SyntheticCredit123!',4),'合成'+suffix,roleId,'合成授信回归',self])
      const signed = await login(http,ref+suffix,'SyntheticCredit123!')
      return { id:r.insertId,token:signed.token || signed.data?.token }
    }
    const applicant = await user('Applicant',1), reviewer = await user('Reviewer',0,financeRole.insertId)
    const [customer] = await pool.query('INSERT INTO sale_customers (code,name,credit_limit) VALUES (?,?,1)',[ref,'合成授信客户'])
    const totalAmount=50000+customer.insertId*10,unitPrice=totalAmount/2,overAmount=totalAmount-1
    const [product] = await pool.query("INSERT INTO product_items (code,name,unit,sale_price_a,cost_price,avg_cost) VALUES (?,?,'个',?,5,5)",[ref,'合成授信商品',unitPrice])
    const seededContainers=[]
    const engine = require('../backend/src/engine/containerEngine')
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      for (const initialQty of [1,1,28]) {
        const container=await engine.createContainer(conn,{productId:product.insertId,warehouseId:ctx.warehouse.id,initialQty,locationId:ctx.location.id,sourceType:engine.SOURCE_TYPE.MANUAL,sourceRefId:product.insertId,remark:'合成回归独立铺底',containerStatus:engine.CONTAINER_STATUS.PENDING_PUTAWAY})
        await engine.promotePendingContainerToActive(conn,container.containerId,product.insertId,ctx.warehouse.id)
        seededContainers.push(container)
      }
      await conn.commit()
    } catch(e) { await conn.rollback();throw e } finally {conn.release()}
    const [flow] = await pool.query("INSERT INTO approval_flows (biz_type,name,min_amount,max_amount,is_active) VALUES ('sale_credit_override',?,?,?,1)",[ref,overAmount,overAmount])
    await pool.query('INSERT INTO approval_flow_steps (flow_id,step_order,approver_type,user_id) VALUES ?',[[[flow.insertId,1,3,applicant.id],[flow.insertId,2,3,applicant.id],[flow.insertId,3,3,applicant.id],[flow.insertId,4,3,reviewer.id]]])
    const payload = {customerId:customer.insertId,customerName:'合成授信客户',warehouseId:ctx.warehouse.id,warehouseName:ctx.warehouse.name,items:[{productId:product.insertId,productCode:ref,productName:'合成授信商品',unit:'个',quantity:2,unitPrice}]}
    const created = await http.post('/api/sale',{token:applicant.token,json:payload});expectStatus(created,201)
    const orderId = created.data.data.id
    const reserve = (json={},token=applicant.token) => http.post(`/api/sale/${orderId}/reserve`,{token,json,headers:{'X-Request-Key':crypto.randomUUID()}})
    await check('管理员和旧直放标记不能跳过审批',async()=>{
      expectStatus(await reserve({confirmCreditOverride:true},adminToken),400)
      const r=await reserve({},adminToken);expectStatus(r,409);assert.equal(r.data.code,'CREDIT_LIMIT_EXCEEDED')
      const legacy=await reserve({});expectStatus(legacy,409)
    })
    const request = await http.post('/api/credit-overrides',{token:applicant.token,json:{saleOrderId:orderId,reason:'合成超额申请'}});expectStatus(request,201)
    const id=request.data.data.id
    const detail = async(token=applicant.token)=>(await http.get(`/api/credit-overrides/${id}`,{token})).data.data
    const pending = async(token=applicant.token)=>(await http.get('/api/approvals/pending?pageSize=100',{token})).data.data
    const intent = (task,reason='合成自行审批原因')=>({expectedTaskId:task,reason})
    const approve = (task,token=applicant.token,key=`${ref}-${task}`,reason='合成自行审批原因')=>http.post(`/api/credit-overrides/${id}/approve`,{token,json:intent(task,reason),headers:{'X-Request-Key':key}})
    await check('财务有独立审批权但没有申请权，不能创建、提交或取消申请',async()=>{
      for(const url of ['/api/credit-overrides',`/api/credit-overrides/${id}/submit`,`/api/credit-overrides/${id}/cancel`]) {
        expectStatus(await http.post(url,{token:reviewer.token,json:{saleOrderId:orderId,reason:'合成越权申请'}}),403)
      }
      const [rows]=await pool.query('SELECT permission FROM sys_role_permissions WHERE role_id=?',[financeRole.insertId])
      assert.ok(!rows.some(r=>r.permission==='sale.credit.override.apply'))
    })
    await check('申请权和自批开关不能代替独立审批权成为节点候选',async()=>{
      await pool.query("DELETE FROM sys_role_permissions WHERE role_id=? AND permission='sale.credit.override.approve'",[role.insertId])
      try { expectStatus(await http.post(`/api/credit-overrides/${id}/submit`,{token:applicant.token}),400);assert.equal((await detail()).status,1) }
      finally { await pool.query("INSERT INTO sys_role_permissions (role_id,permission) VALUES (?,'sale.credit.override.approve')",[role.insertId]) }
    })
    await check('唯一候选未开自批时不能提交或自动审批',async()=>{
      await pool.query('UPDATE sys_users SET allow_self_approve=0 WHERE id=?',[applicant.id])
      expectStatus(await http.post(`/api/credit-overrides/${id}/submit`,{token:applicant.token}),400)
      assert.equal((await detail()).status,1)
      await pool.query('UPDATE sys_users SET allow_self_approve=1 WHERE id=?',[applicant.id])
    })
    await check('只有本人且开关开启仍可以成为唯一节点候选',async()=>{
      expectStatus(await http.post(`/api/credit-overrides/${id}/submit`,{token:applicant.token}),200)
      const d=await detail();assert.equal(d.canApprove,true);assert.ok(d.currentTaskId)
      assert.ok((await pending()).list.some(r=>r.bizId===id && r.bizType==='sale_credit_override'))
    })
    let task=(await detail()).currentTaskId
    await check('已有节点快照也不能让仅申请的销售自批；待办和按钮共同拒绝',async()=>{
      await pool.query("DELETE FROM sys_role_permissions WHERE role_id=? AND permission='sale.credit.override.approve'",[role.insertId])
      try {
        assert.equal((await detail()).canApprove,false)
        assert.ok(!(await pending()).list.some(r=>r.bizId===id && r.bizType==='sale_credit_override'))
        expectStatus(await approve(task),403)
      } finally { await pool.query("INSERT INTO sys_role_permissions (role_id,permission) VALUES (?,'sale.credit.override.approve')",[role.insertId]) }
    })
    await check('管理员未命中节点也不能代批或跳级',async()=>{expectStatus(await approve(task,adminToken),403)})
    await check('本人开关关闭后待办、按钮和执行共同拒绝',async()=>{
      await pool.query('UPDATE sys_users SET allow_self_approve=0 WHERE id=?',[applicant.id])
      assert.equal((await detail()).canApprove,false)
      assert.ok(!(await pending()).list.some(r=>r.bizId===id && r.bizType==='sale_credit_override'))
      const r=await approve(task);expectStatus(r,403);assert.equal(r.data.code,'SELF_APPROVAL_DENIED')
      await pool.query('UPDATE sys_users SET allow_self_approve=1 WHERE id=?',[applicant.id])
    })
    await check('自批必须说明原因',async()=>{const r=await approve(task,applicant.token,`${ref}-empty`,'');expectStatus(r,400);assert.equal(r.data.code,'SELF_APPROVAL_REASON_REQUIRED')})
    await check('并发相同请求只处理一个节点并回放原结果',async()=>{
      const results=await Promise.all([approve(task),approve(task)])
      results.forEach(r=>expectStatus(r,200))
      assert.deepEqual(results[0].data.data,results[1].data.data)
      const d=await detail();assert.equal(d.approval.currentStep,2);assert.notEqual(d.currentTaskId,task)
      const [[{n}]]=await pool.query('SELECT COUNT(*) n FROM sale_credit_approval_actions WHERE override_id=?',[id]);assert.equal(Number(n),1)
      expectStatus(await approve(task,applicant.token,`${ref}-fresh-stale-node`),409)
    })
    await check('已完成节点不因关闭开关被追溯撤销；原请求仍可查询回放',async()=>{
      await pool.query('UPDATE sys_users SET allow_self_approve=0 WHERE id=?',[applicant.id])
      expectStatus(await approve(task),200)
      const d=await detail();assert.equal(d.approval.tasks[0].status,2)
      expectStatus(await approve(d.currentTaskId,applicant.token,`${ref}-closed-next`),403)
      await pool.query('UPDATE sys_users SET allow_self_approve=1 WHERE id=?',[applicant.id])
    })
    task=(await detail()).currentTaskId
    await check('不同请求键并发处理同一节点，只推进一次',async()=>{
      const appPool=require('../backend/src/config/db').pool, original=appPool.getConnection.bind(appPool)
      const actions=require('../backend/src/modules/credit-overrides/credit-overrides.actions')
      let locked,waiting,release,first,second,seen=0
      const firstLocked=new Promise(r=>{locked=r}),secondWaiting=new Promise(r=>{waiting=r}),hold=new Promise(r=>{release=r})
      const wait=async signal=>{let timer;try{await Promise.race([signal,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('授信节点并发交错超时')),5000)})])}finally{clearTimeout(timer)}}
      appPool.getConnection=async()=>{
        const conn=await original()
        return new Proxy(conn,{get(target,key){
          if(key==='query')return async(sql,...args)=>{
            const gate=sql==='SELECT * FROM sale_orders WHERE id=? AND deleted_at IS NULL FOR UPDATE' && Number(args[0][0])===Number(orderId)
            const number=gate?++seen:0
            if(number===2)waiting()
            const result=await target.query(sql,...args)
            if(number===1){locked();await hold}
            return result
          }
          const value=target[key];return typeof value==='function'?value.bind(target):value
        }})
      }
      const run=key=>actions.act(id,'approve',{expectedTaskId:task,reason:'合成自行审批原因',requestKey:key},{userId:applicant.id}).then(data=>({status:200,data}),error=>({status:error.statusCode,error}))
      try{
        first=run(`${ref}-race-a`);await wait(firstLocked)
        second=run(`${ref}-race-b`);await wait(secondWaiting);release()
        const results=await Promise.all([first,second])
        assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(results.find(r=>r.status===409).error.code,'APPROVAL_CONFLICT')
      }finally{release();await Promise.allSettled([first,second].filter(Boolean));appPool.getConnection=original}
      assert.equal((await detail()).approval.currentStep,3)
    })
    await check('合法自批逐级推进，不自动批准余下节点',async()=>{expectStatus(await approve((await detail()).currentTaskId),200);assert.equal((await detail()).status,2)})
    let reviewerTask=(await detail(reviewer.token)).currentTaskId
    await check('有效开关不代替当前业务权限',async()=>{
      await pool.query("DELETE FROM sys_role_permissions WHERE role_id=? AND permission='sale.credit.override.approve'",[financeRole.insertId])
      assert.equal((await detail(reviewer.token)).canApprove,false)
      expectStatus(await approve(reviewerTask,reviewer.token),403)
      await pool.query("INSERT INTO sys_role_permissions (role_id,permission) VALUES (?,'sale.credit.override.approve')",[financeRole.insertId])
    })
    await check('无申请权的合法财务同时出现在待办、按钮及准确审批节点',async()=>{
      const d=await detail(reviewer.token);assert.equal(d.canApprove,true);assert.equal(d.canManage,false);assert.equal(d.currentTaskId,reviewerTask)
      assert.ok((await pending(reviewer.token)).list.some(r=>r.bizId===id && r.bizType==='sale_credit_override'))
    })
    await check('节点资格和仓库范围共同生效',async()=>{
      await pool.query('INSERT INTO user_warehouse_scope (user_id,warehouse_id) VALUES (?,?)',[reviewer.id,Number(ctx.warehouse.id)+999999])
      expectStatus(await approve(reviewerTask,reviewer.token),403)
      assert.ok(!(await pending(reviewer.token)).list.some(r=>r.bizId===id && r.bizType==='sale_credit_override'))
      await pool.query('DELETE FROM user_warehouse_scope WHERE user_id=?',[reviewer.id])
      expectStatus(await approve(reviewerTask,reviewer.token),200)
    })
    await check('审批审计精确记录申请/审批人、单据、节点、原因、自批依据和时间',async()=>{
      const [rows]=await pool.query('SELECT * FROM sale_credit_approval_actions WHERE override_id=? ORDER BY id',[id])
      assert.equal(rows.length,4)
      assert.deepEqual(rows.map(r=>Number(r.is_self_approval)),[1,1,1,0])
      assert.deepEqual(rows.map(r=>Number(r.approver_id)),[applicant.id,applicant.id,applicant.id,reviewer.id])
      assert.ok(rows.every(r=>r.action==='approve' && r.action_at && r.reason && Number(r.sale_order_id)===orderId && Number(r.applicant_id)===applicant.id && r.authorization_basis))
      for(const row of rows){
        const basis=typeof row.authorization_basis==='string'?JSON.parse(row.authorization_basis):row.authorization_basis
        assert.ok(basis.requiredPermissions.includes('sale.credit.override.approve'))
        assert.ok(!basis.requiredPermissions.includes('sale.credit.override.apply'))
      }
    })
    const {assertCreditWithinLimit}=require('../backend/src/modules/warehouse-tasks/warehouse-tasks.ship')
    await check('已批准订单允许普通仓管出库信用闸，无直放权',async()=>{
      const c=await pool.getConnection();try{await c.beginTransaction();await assertCreditWithinLimit(c,customer.insertId,totalAmount,{userId:reviewer.id,roleId:2},orderId);await c.rollback()}finally{c.release()}
    })
    let itemId
    await check('已批准订单分次占库、部分释放、再占均守恒',async()=>{
      const [[item]]=await pool.query('SELECT id FROM sale_order_items WHERE order_id=?',[orderId]);itemId=item.id
      const part={items:[{id:itemId,qty:1,warehouseId:ctx.warehouse.id,warehouseName:ctx.warehouse.name}]}
      expectStatus(await reserve(part),200)
      let [[s]]=await pool.query('SELECT reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',[product.insertId,ctx.warehouse.id]);assert.equal(Number(s.reserved),1)
      const released=await http.post(`/api/sale/${orderId}/release`,{token:applicant.token,json:{items:[{id:itemId,qty:1}]},headers:{'X-Request-Key':`${ref}-release`}});expectStatus(released,200)
      ;[[s]]=await pool.query('SELECT reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',[product.insertId,ctx.warehouse.id]);assert.equal(Number(s.reserved),0)
      expectStatus(await reserve(),200)
      ;[[s]]=await pool.query('SELECT reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',[product.insertId,ctx.warehouse.id]);assert.equal(Number(s.reserved),2)
    })
    await check('过期、撤销及等额换商品版本均不再消费旧批准',async()=>{
      const c=await pool.getConnection();const svc=require('../backend/src/modules/credit-overrides/credit-overrides.service')
      try {
        const current=async()=>{const [[order]]=await pool.query('SELECT * FROM sale_orders WHERE id=?',[orderId]);return {conn:c,order,customerId:customer.insertId,creditLimit:1,thisAmount:totalAmount,overAmount:overAmount}}
        await pool.query('UPDATE sale_credit_approval_proofs SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE override_id=?',[id]);assert.equal(await svc.hasApprovedOverride(orderId,await current()),null)
        await pool.query('UPDATE sale_credit_approval_proofs SET expires_at=NULL WHERE override_id=?',[id])
        await pool.query('UPDATE sale_credit_overrides SET status=5 WHERE id=?',[id]);assert.equal(await svc.hasApprovedOverride(orderId,await current()),null)
        await pool.query('UPDATE sale_credit_overrides SET status=3 WHERE id=?',[id])
        await pool.query('UPDATE sale_order_items SET unit_price=unit_price+1 WHERE id=?',[itemId]);assert.equal(await svc.hasApprovedOverride(orderId,await current()),null)
        await pool.query('UPDATE sale_order_items SET unit_price=unit_price-1 WHERE id=?',[itemId]);assert.equal(await svc.hasApprovedOverride(orderId,await current()),id)
      } finally {c.release()}
    })
    await check('普通仓管通过真实作业接口部分出库，余量和应收守恒',async()=>{
      const [[warehouseRole]]=await pool.query("SELECT id FROM sys_roles WHERE code='warehouse_manager'")
      const worker=await user('Warehouse',0,warehouseRole.id)
      const deviceSecret=crypto.randomBytes(24).toString('hex')
      await pool.query("INSERT INTO pda_devices (device_code,device_name,warehouse_id,status,secret_hash) VALUES (?, '合成授信PDA', ?, 'active', ?)",[ref,ctx.warehouse.id,bcrypt.hashSync(deviceSecret,4)])
      const device=await require('../backend/src/modules/pda/pda.sessions.service').createSession({deviceCode:ref,deviceSecret,userId:worker.id})
      const headers={'X-Client':'pda','X-PDA-Session':device.sessionToken,'X-Request-Key':ref+'warehouse'}
      await pool.query('INSERT INTO sorting_bins (warehouse_id,code) VALUES (?,?)',[ctx.warehouse.id,ref.slice(0,19)])
      await pool.query("INSERT INTO printer_bindings (warehouse_id,print_type,printer_id,printer_code) VALUES (?,'package_label',?,?) ON DUPLICATE KEY UPDATE printer_id=VALUES(printer_id),printer_code=VALUES(printer_code)",[ctx.warehouse.id,ctx.printer.id,ctx.printer.code])
      const dispatch=await http.post(`/api/sale/${orderId}/ship`,{token:applicant.token,json:{items:[{id:itemId,qty:1}]},headers:{'X-Request-Key':ref+'dispatch'}});expectStatus(dispatch,200)
      const [[dispatched]]=await pool.query('SELECT task_id FROM sale_orders WHERE id=?',[orderId])
      const taskId=Number(dispatched.task_id);assert.ok(taskId>0)
      const [[line]]=await pool.query('SELECT id FROM warehouse_task_items WHERE task_id=?',[taskId])
      const container=seededContainers[0]
      expectStatus(await http.post('/api/scan-logs',{token:worker.token,headers,json:{taskId,itemId:line.id,containerId:container.containerId,barcode:container.barcode,productId:product.insertId,qty:1,scanMode:'整件'}}),201)
      expectStatus(await http.put(`/api/warehouse-tasks/${taskId}/ready`,{token:worker.token,headers}),200)
      expectStatus(await http.put(`/api/warehouse-tasks/${taskId}/sort-done`,{token:worker.token,headers,json:{}}),200)
      expectStatus(await http.post('/api/scan-logs/check',{token:worker.token,headers,json:{taskId,barcode:container.barcode}}),201)
      const pkg=await http.post('/api/packages',{token:worker.token,headers,json:{warehouseTaskId:taskId}});expectStatus(pkg,200)
      const packageId=pkg.data.data.id
      expectStatus(await http.post(`/api/packages/${packageId}/add-item`,{token:worker.token,headers,json:{productCode:ref,qty:1}}),200)
      expectStatus(await http.put(`/api/packages/${packageId}/finish`,{token:worker.token,headers}),200)
      // Synthetic print acknowledgement, no physical printer evidence.
      await pool.query("UPDATE print_jobs SET status=2 WHERE ref_type='package' AND ref_id=?",[packageId])
      expectStatus(await http.put(`/api/warehouse-tasks/${taskId}/pack-done`,{token:worker.token,headers}),200)
      const ship=()=>http.put(`/api/warehouse-tasks/${taskId}/ship`,{token:worker.token,headers})
      expectStatus(await ship(),200);expectStatus(await ship(),200)
      const [[stock]]=await pool.query('SELECT quantity,reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',[product.insertId,ctx.warehouse.id])
      assert.equal(Number(stock.quantity),29);assert.equal(Number(stock.reserved),1)
      const [[ar]]=await pool.query('SELECT total_amount FROM payment_records WHERE type=2 AND order_id=?',[orderId]);assert.equal(Number(ar.total_amount),unitPrice)
      const c=await pool.getConnection();try{await c.beginTransaction();await assertCreditWithinLimit(c,customer.insertId,totalAmount,{userId:worker.id,roleId:warehouseRole.id},orderId);await c.rollback()}finally{c.release()}
    })
    await check('取消原单释放预占且现货不被清空或重建',async()=>{
      expectStatus(await http.post(`/api/sale/${orderId}/cancel`,{token:applicant.token,json:{changeReason:'合成取消'}}),200)
      const [[s]]=await pool.query('SELECT quantity,reserved FROM inventory_stock WHERE product_id=? AND warehouse_id=?',[product.insertId,ctx.warehouse.id]);assert.equal(Number(s.reserved),0);assert.equal(Number(s.quantity),29)
    })
    await check('自批驳回同样受实时开关约束并留下唯一审计记录',async()=>{
      const [another]=await pool.query('INSERT INTO sale_customers (code,name,credit_limit) VALUES (?,?,1)',[ref+'reject','合成驳回客户'])
      const so=await http.post('/api/sale',{token:applicant.token,json:{...payload,customerId:another.insertId}});expectStatus(so,201)
      const applied=await http.post('/api/credit-overrides',{token:applicant.token,json:{saleOrderId:so.data.data.id,reason:'合成驳回'}});expectStatus(applied,201)
      const rid=applied.data.data.id;expectStatus(await http.post(`/api/credit-overrides/${rid}/submit`,{token:applicant.token}),200)
      const d=(await http.get(`/api/credit-overrides/${rid}`,{token:applicant.token})).data.data
      const reject=()=>http.post(`/api/credit-overrides/${rid}/reject`,{token:applicant.token,headers:{'X-Request-Key':ref+'reject'},json:{expectedTaskId:d.currentTaskId,reason:'合成自行驳回原因'}})
      await pool.query('UPDATE sys_users SET allow_self_approve=0 WHERE id=?',[applicant.id]);expectStatus(await reject(),403)
      await pool.query('UPDATE sys_users SET allow_self_approve=1 WHERE id=?',[applicant.id]);expectStatus(await reject(),200);expectStatus(await reject(),200)
      const [[audit]]=await pool.query('SELECT COUNT(*) n,MIN(action) action,MIN(is_self_approval) self FROM sale_credit_approval_actions WHERE override_id=?',[rid])
      assert.equal(Number(audit.n),1);assert.equal(audit.action,'reject');assert.equal(Number(audit.self),1)
    })
    console.log(`CREDIT_CONSISTENCY ${passed} passed`)
  } finally {await ctx.close()}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})
