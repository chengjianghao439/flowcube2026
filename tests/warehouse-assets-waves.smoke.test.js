#!/usr/bin/env node
'use strict'
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
require('./helpers/testEnvironment').configureTestEnvironment()
process.env.SENTRY_DSN = ''
process.env.LOKI_URL = ''
// 取消成员会惰性加载打印兼容门面；禁用其全局清理定时器，测试只操作自有记录。
process.env.DISABLE_PRINT_JOB_SWEEPER = '1'
const { pool } = require('../backend/src/config/db')
const express = require('../backend/node_modules/express')
const jwt = require('../backend/node_modules/jsonwebtoken')
const { PERMISSIONS } = require('../backend/src/constants/permissions')
const { WT_STATUS } = require('../backend/src/constants/warehouseTaskStatus')
async function main() {
  const mark = `AW${randomBytes(4).toString('hex')}`, owned = new Map(), counts = {}, failures = []
  let server, actor, reader, denied, scoped
  const ids = table => owned.get(table) || []
  const remember = (table, id) => { if (!owned.has(table)) owned.set(table, []); if (!ids(table).includes(Number(id))) ids(table).push(Number(id)); return Number(id) }
  const insert = async (table, row) => { const [r] = await pool.query(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, Object.values(row)); return remember(table, r.insertId) }
  const check = (mod, label, actual, expected = true) => {
    counts[mod] = (counts[mod] || 0) + 1
    try { assert.deepEqual(actual, expected); console.log(`PASS [${mod}] ${label}`) }
    catch { failures.push(`${mod}: ${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); console.log(`FAIL [${mod}] ${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`) }
  }
  try {
    const [[target]] = await pool.query('SELECT DATABASE() AS db, @@session.time_zone AS timezone')
    assert.equal(target.db, process.env.DB_NAME)
    console.log('[warehouse-assets-waves] target', { host: process.env.DB_HOST, port: process.env.DB_PORT, ...target })
    const printSnapshot=async()=>(await pool.query('SELECT id,status,error_message,updated_at FROM print_jobs ORDER BY id'))[0]
    const beforePrint=await printSnapshot()
    const [used] = await pool.query('SELECT id FROM sys_roles UNION SELECT role_id AS id FROM sys_users UNION SELECT role_id AS id FROM sys_role_permissions')
    const roles = Array.from({ length: 254 }, (_, i) => 255-i).filter(id => !used.some(r => Number(r.id) === id)).slice(0, 4)
    assert.equal(roles.length, 4)
    const users = []
    for (const [index, id] of roles.entries()) {
      await insert('sys_roles', { id, code: `${mark}R${index}`, name: mark, is_system: 0 })
      users.push(await insert('sys_users', { username: `${mark}U${index}`, password: 'fixture-no-password-login', real_name: mark, role_id: id, role_name: mark }))
      if (index === 2) continue
      for (const permission of [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.PICKING_WAVE_VIEW, ...(index === 1 ? [] : [PERMISSIONS.INVENTORY_CONTAINER_SPLIT, PERMISSIONS.PICKING_WAVE_MANAGE])]) await pool.query('INSERT INTO sys_role_permissions(role_id,permission) VALUES (?,?)',[id,permission])
    }
    ;[actor, reader, denied, scoped] = users
    const app = express(); app.use(express.json())
    for (const mod of ['plastic-boxes','picking-waves']) app.use(`/api/${mod}`, require(`../backend/src/modules/${mod}/${mod}.routes`))
    app.use(require('../backend/src/middleware/errorHandler'))
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const req = async (mod, path='', method='GET', body, user=actor) => {
      const headers = { 'Content-Type': 'application/json' }
      if (user) headers.Authorization = `Bearer ${jwt.sign({ userId:user, tokenVersion:0 },process.env.JWT_SECRET,{expiresIn:'10m'})}`
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/${mod}${path}`,{method,headers,body:body === undefined ? undefined : JSON.stringify(body),signal:AbortSignal.timeout(10000)})
      const payload = await r.json()
      if (method==='POST'&&path==='') {
        if(mod==='plastic-boxes'&&payload.data?.id) remember('inventory_containers',payload.data.id)
        if(mod==='picking-waves'&&payload.data?.waveId) remember('picking_waves',payload.data.waveId)
      }
      return { status:r.status,...payload }
    }
    const expect = async (mod,label,path,method,body,status,user=actor) => {const r=await req(mod,path,method,body,user);check(mod,`${label} HTTP`,r.status,status);check(mod,`${label} 信封`,r.success,status<400);return r}
    const B='plastic-boxes', W='picking-waves'
    for(const mod of [B,W]) {
      await expect(mod,'未登录','','GET',undefined,401,null)
      await expect(mod,'无权限','','GET',undefined,403,denied)
      await expect(mod,'只读可读','','GET',undefined,200,reader)
      await expect(mod,'只读拒建','','POST',{},403,reader)
      await expect(mod,'只读拒变更','/2147483647'+(mod===W?'/start':''),mod===W?'POST':'DELETE',{},403,reader)
      await expect(mod,'不存在详情','/2147483647','GET',undefined,404)
    }
    const whA=await insert('inventory_warehouses',{code:`${mark}A`,name:`${mark}A`}),whB=await insert('inventory_warehouses',{code:`${mark}B`,name:`${mark}B`})
    await pool.query('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES (?,?)',[scoped,whA])
    const product=await insert('product_items',{code:mark,name:mark,unit:'件'})
    const locA=await insert('warehouse_locations',{warehouse_id:whA,code:`${mark}A`,name:mark}),locB=await insert('warehouse_locations',{warehouse_id:whB,code:`${mark}B`,name:mark})
    const body={productId:product,warehouseId:whA,locationId:locA,remark:mark}
    const box=(await expect(B,'创建空盒','','POST',body,201)).data
    const boxB=(await expect(B,'创建另仓空盒','','POST',{...body,warehouseId:whB,locationId:locB},201)).data
    assert.ok(box?.id&&boxB?.id)
    const detail=(await expect(B,'详情',`/${box.id}`,'GET',undefined,200)).data
    check(B,'空盒条码及快照',[box.barcode.startsWith('B'),detail.productId,detail.warehouseId,detail.locationId,detail.remainingQty,detail.status,detail.unit],[true,product,whA,locA,0,1,'件'])
    check(B,'空盒无流水',(await expect(B,'流水',`/${box.id}/movements`,'GET',undefined,200)).data,[])
    const log=await insert('inventory_logs',{container_id:box.id,product_id:product,warehouse_id:whA,quantity:2.5,type:1,remark:mark})
    const movements=(await req(B,`/${box.id}/movements`)).data
    check(B,'真实流水使用quantity字段',[movements.length,movements[0].qty,movements[0].remark],[1,2.5,mark])
    await pool.query('DELETE FROM inventory_logs WHERE id=?',[log])
    const inventorySnapshot=async()=>{const result={};for(const table of ['inventory_stock','inventory_logs','stock_reservations']){const [rows]=await pool.query(`SELECT * FROM ${table} WHERE product_id=? ORDER BY id`,[product]);result[table]=rows}return result}
    const emptySnapshot=await inventorySnapshot()
    check(B,'新建无库存预占流水副作用',emptySnapshot,{inventory_stock:[],inventory_logs:[],stock_reservations:[]})
    for(const bad of [{productId:0},{warehouseId:0},{productId:'bad'},{locationId:'bad'},{remark:{bad:1}},{locationId:locB}]) await expect(B,'非法字段或库位归属','','POST',{...body,...bad},400)
    await pool.query('UPDATE product_items SET is_active=0 WHERE id=?',[product])
    await expect(B,'停用商品拒建','','POST',body,400)
    await pool.query('UPDATE product_items SET is_active=1 WHERE id=?',[product])
    await pool.query('UPDATE inventory_warehouses SET is_active=0 WHERE id=?',[whA])
    await expect(B,'停用仓库拒建','','POST',body,400)
    await pool.query('UPDATE inventory_warehouses SET is_active=1 WHERE id=?',[whA])
    await pool.query('UPDATE warehouse_locations SET status=2 WHERE id=?',[locA])
    await expect(B,'停用库位拒建','','POST',body,400)
    await pool.query('UPDATE warehouse_locations SET status=1 WHERE id=?',[locA])
    check(B,'关键词商品仓库筛选',(await req(B,`?keyword=${mark}&productId=${product}&warehouseId=${whA}`)).data.list.map(r=>r.id),[box.id])
    check(B,'限仓列表',(await req(B,`?keyword=${mark}`,'GET',undefined,scoped)).data.list.map(r=>r.id),[box.id])
    for(const [path,method,data] of [[`/${boxB.id}`,'GET'],[`/${boxB.id}/movements`,'GET'],[`/${boxB.id}`,'DELETE'],['','POST',{...body,warehouseId:whB,locationId:locB}]])await expect(B,'越仓禁止',path,method,data,403,scoped)
    const taskFixture=async(warehouseId=whA,qty=2,snapshot=mark)=>{
      const task=await insert('warehouse_tasks',{task_no:`${mark}T${ids('warehouse_tasks').length}`,warehouse_id:warehouseId,warehouse_name:mark,customer_name:mark,status:WT_STATUS.PICKING})
      const item=await insert('warehouse_task_items',{task_id:task,product_id:product,product_code:mark,product_name:snapshot,unit:'件',required_qty:qty})
      return {task,item,qty}
    }
    const a=await taskFixture(),b=await taskFixture(whA,3,`${mark}旧名称`),c=await taskFixture(whB),d=await taskFixture(whB)
    await pool.query('UPDATE inventory_containers SET locked_by_task_id=? WHERE id=?',[a.task,box.id])
    await expect(B,'锁定空盒拒删',`/${box.id}`,'DELETE',undefined,400)
    await pool.query('UPDATE inventory_containers SET locked_by_task_id=NULL,remaining_qty=1 WHERE id=?',[box.id])
    await expect(B,'有量盒拒删',`/${box.id}`,'DELETE',undefined,400)
    await pool.query('UPDATE inventory_containers SET remaining_qty=0 WHERE id=?',[box.id])
    await expect(B,'空盒删除',`/${box.id}`,'DELETE',undefined,200)
    await expect(B,'删除后详情',`/${box.id}`,'GET',undefined,404)
    await expect(B,'重复删除',`/${box.id}`,'DELETE',undefined,404)
    check(B,'失败与删除不改库存账',await inventorySnapshot(),emptySnapshot)
    const makeWave=async(tasks,label='创建波次',user=actor)=>{const r=await expect(W,label,'','POST',{taskIds:tasks.map(t=>t.task),remark:mark},200,user);assert.ok(r.data?.waveId);return r.data.waveId}
    for(const taskIds of [[a.task],[a.task,a.task],[a.task,2147483647],[a.task,c.task]])await expect(W,'非法任务选择','','POST',{taskIds},400)
    await pool.query('UPDATE warehouse_tasks SET status=? WHERE id=?',[WT_STATUS.SORTING,b.task])
    await expect(W,'非备货任务拒绑','','POST',{taskIds:[a.task,b.task]},400)
    await pool.query('UPDATE warehouse_tasks SET status=? WHERE id=?',[WT_STATUS.PICKING,b.task])
    await expect(W,'越仓任务拒建','','POST',{taskIds:[c.task,d.task]},403,scoped)
    const wave=await makeWave([a,b]),waveB=await makeWave([c,d])
    await expect(W,'重复绑定拒绝','','POST',{taskIds:[a.task,b.task]},409)
    const hidden=await expect(W,'已绑定越仓任务仍返回限仓错误','','POST',{taskIds:[c.task,d.task]},403,scoped)
    check(W,'越仓错误不泄漏波次编号',!hidden.message?.includes((await req(W,`/${waveB}`)).data.waveNo))
    for(const [path,method] of [[`/${waveB}`,'GET'],...['start','finish-picking','finish','cancel'].map(x=>[`/${waveB}/${x}`,'POST'])])await expect(W,'越仓禁止',path,method,method==='GET'?undefined:{},403,scoped)
    const waveDetail=(await req(W,`/${wave}`)).data
    check(W,'绑定保留两任务',waveDetail.tasks.map(t=>t.taskId).sort((x,y)=>x-y),[a.task,b.task])
    check(W,'同商品不同快照只汇总一行',[waveDetail.items.length,waveDetail.items.reduce((s,i)=>s+i.totalQty,0)],[1,5])
    await expect(W,'未开始拒绝完成拣货',`/${wave}/finish-picking`,'POST',{},409)
    await expect(W,'未分拣拒绝完成',`/${wave}/finish`,'POST',{},409)
    await expect(W,'开始',`/${wave}/start`,'POST',{},200)
    check(W,'开始记录真实操作者',(await req(W,`/${wave}`)).data.operatorId,actor)
    await expect(W,'重复开始',`/${wave}/start`,'POST',{},409)
    await expect(W,'未拣满拒绝完成拣货',`/${wave}/finish-picking`,'POST',{},400)
    const preparePicked=async(t)=>{
      const container=await insert('inventory_containers',{barcode:`I${mark}${t.task}`,product_id:product,warehouse_id:whA,location_id:locA,remaining_qty:t.qty,initial_qty:t.qty,status:1,locked_by_task_id:t.task})
      await pool.query('UPDATE warehouse_task_items SET picked_qty=required_qty WHERE id=?',[t.item])
      await insert('scan_logs',{task_id:t.task,item_id:t.item,container_id:container,barcode:`I${mark}${t.task}`,product_id:product,qty:t.qty,scan_mode:'container',scan_purpose:1})
      return container
    }
    const ca=await preparePicked(a),cb=await preparePicked(b)
    const containerSnapshot=async()=>{const [r]=await pool.query('SELECT id,remaining_qty,locked_by_task_id FROM inventory_containers WHERE id IN (?) ORDER BY id',[[ca,cb]]);return r}
    const beforeContainers=await containerSnapshot()
    await pool.query('UPDATE scan_logs SET qty=0 WHERE task_id=?',[b.task])
    await expect(W,'扫码数量不闭合拒绝',`/${wave}/finish-picking`,'POST',{},400)
    await pool.query('UPDATE scan_logs SET qty=? WHERE task_id=?',[b.qty,b.task])
    await pool.query('UPDATE inventory_containers SET locked_by_task_id=NULL WHERE id=?',[cb])
    await expect(W,'容器锁不闭合拒绝',`/${wave}/finish-picking`,'POST',{},400)
    await pool.query('UPDATE inventory_containers SET locked_by_task_id=? WHERE id=?',[b.task,cb])
    const progress=(await req(W,`/${wave}`)).data
    check(W,'不同快照进度不重复计数',progress.items.reduce((sum,row)=>sum+row.pickedQty,0),5)
    await expect(W,'闭合后完成拣货',`/${wave}/finish-picking`,'POST',{},200)
    await expect(W,'重复完成拣货',`/${wave}/finish-picking`,'POST',{},409)
    // 模拟合法单任务入口已将一个成员推进待分拣，波次必须继续接纳它，不能倒退或永久卡住。
    await require('../backend/src/modules/warehouse-tasks/warehouse-tasks.service').readyToShip(a.task)
    await expect(W,'兼容成员已完成拣货后完成波次',`/${wave}/finish`,'POST',{},200)
    const [taskStates]=await pool.query('SELECT status FROM warehouse_tasks WHERE id IN (?) ORDER BY id',[[a.task,b.task]])
    check(W,'成员最终都在待分拣',taskStates.map(t=>t.status),[WT_STATUS.SORTING,WT_STATUS.SORTING])
    check(W,'波次状态完成',(await req(W,`/${wave}`)).data.status,4)
    check(W,'完成波次不扣库存不释放锁',await containerSnapshot(),beforeContainers)
    check(W,'完成波次不写库存账预占',await inventorySnapshot(),emptySnapshot)
    await expect(W,'已完成拒绝取消',`/${wave}/cancel`,'POST',{},409)
    await expect(W,'重复完成拒绝',`/${wave}/finish`,'POST',{},409)
    await expect(W,'取消无实物锁波次',`/${waveB}/cancel`,'POST',{},200)
    check(W,'取消联动任务状态',(await pool.query('SELECT status FROM warehouse_tasks WHERE id IN (?) ORDER BY id',[[c.task,d.task]]))[0].map(t=>t.status),[WT_STATUS.CANCELLED,WT_STATUS.CANCELLED])
    await expect(W,'重复取消',`/${waveB}/cancel`,'POST',{},409)
    for(const [flag,label,message] of [
      ['cancel_requested_at','待归还成员','该任务正在拣货退回中，不可继续拣货'],
      ['adjustment_requested_at','待改单成员','该任务有改单正在等待仓库确认，请先处理完成'],
    ]) {
      const pendingTasks=[await taskFixture(),await taskFixture()]
      const pendingWave=await makeWave(pendingTasks,`${label}波次创建`)
      for(const task of pendingTasks) await preparePicked(task)
      await expect(W,`${label}开始波次`, `/${pendingWave}/start`,'POST',{},200)
      await expect(W,`${label}完成拣货`, `/${pendingWave}/finish-picking`,'POST',{},200)
      // 后一个成员先从合法单任务入口进入待分拣，再构造待实物归还/待改单的数据库快照。
      // 前一个成员仍处于拣货，finish 必须在遇到后一个阻塞成员时回滚它的推进与事件。
      await require('../backend/src/modules/warehouse-tasks/warehouse-tasks.service').readyToShip(pendingTasks[1].task)
      await pool.query(`UPDATE warehouse_tasks SET ${flag}=NOW() WHERE id=?`,[pendingTasks[1].task])
      const [eventsBefore]=await pool.query('SELECT id FROM warehouse_task_events WHERE task_id=? ORDER BY id',[pendingTasks[0].task])
      const blocked=await expect(W,`${label}拒绝完成波次`, `/${pendingWave}/finish`,'POST',{},409)
      check(W,`${label}沿用业务错误`,[blocked.code,blocked.message],['CONFLICT',message])
      check(W,`${label}波次保持待分拣`,(await req(W,`/${pendingWave}`)).data.status,3)
      const [members]=await pool.query('SELECT status FROM warehouse_tasks WHERE id IN (?) ORDER BY id',[pendingTasks.map(t=>t.task)])
      check(W,`${label}先推进成员事务回滚`,members.map(t=>t.status),[WT_STATUS.PICKING,WT_STATUS.SORTING])
      const [eventsAfter]=await pool.query('SELECT id FROM warehouse_task_events WHERE task_id=? ORDER BY id',[pendingTasks[0].task])
      check(W,`${label}先推进成员事件回滚`,eventsAfter,eventsBefore)
    }
    const concurrentTasks=[await taskFixture(),await taskFixture()]
    const raced=await Promise.all([req(W,'','POST',{taskIds:concurrentTasks.map(t=>t.task)}),req(W,'','POST',{taskIds:concurrentTasks.map(t=>t.task)})])
    check(W,'并发建相同任务仅一次成功',raced.map(r=>r.status).sort(),[200,409])
    check(W,'并发绑定恰好每任务一条',(await pool.query('SELECT COUNT(*) AS n FROM picking_wave_tasks WHERE task_id IN (?)',[concurrentTasks.map(t=>t.task)]))[0][0].n,2)
    const concurrentWave=raced.find(r=>r.status===200)?.data.waveId
    assert.ok(concurrentWave)
    await pool.query('UPDATE warehouse_tasks SET status=? WHERE id IN (?)',[WT_STATUS.CANCELLED,concurrentTasks.map(t=>t.task)])
    await expect(W,'终结成员波次开始',`/${concurrentWave}/start`,'POST',{},200)
    await expect(W,'终结成员不阻塞完成拣货',`/${concurrentWave}/finish-picking`,'POST',{},200)
    await expect(W,'终结成员不阻塞完成波次',`/${concurrentWave}/finish`,'POST',{},200)
    const reverseTasks=[await taskFixture(),await taskFixture()]
    const reverseWave=await makeWave(reverseTasks)
    const reverseContainer=await preparePicked(reverseTasks[0])
    await expect(W,'实物锁取消进入逆向归还',`/${reverseWave}/cancel`,'POST',{},200)
    const [[reverseRow]]=await pool.query('SELECT status,cancel_requested_at FROM warehouse_tasks WHERE id=?',[reverseTasks[0].task])
    check(W,'逆向任务保留执行状态并标记待归还',[reverseRow.status,Boolean(reverseRow.cancel_requested_at)],[WT_STATUS.PICKING,true])
    const [[reverseBox]]=await pool.query('SELECT remaining_qty,locked_by_task_id FROM inventory_containers WHERE id=?',[reverseContainer])
    check(W,'逆向取消不扣数量不释放实物锁',[Number(reverseBox.remaining_qty),reverseBox.locked_by_task_id],[reverseTasks[0].qty,reverseTasks[0].task])
    const e=await taskFixture(),f=await taskFixture(),salesWave=await makeWave([e,f])
    const customer=await insert('sale_customers',{code:mark,name:mark})
    const sale=await insert('sale_orders',{order_no:mark,customer_id:customer,customer_name:mark,warehouse_id:whA,warehouse_name:mark,operator_id:actor,operator_name:mark})
    await pool.query('UPDATE warehouse_tasks SET sale_order_id=? WHERE id=?',[sale,f.task])
    const cancelSale=await expect(W,'销售任务必须从销售单取消',`/${salesWave}/cancel`,'POST',{},409)
    check(W,'销售取消业务码',cancelSale.code,'SALE_ORDER_CANCEL_REQUIRED')
    check(W,'失败取消整批回滚',(await pool.query('SELECT status FROM warehouse_tasks WHERE id IN (?) ORDER BY id',[[e.task,f.task]]))[0].map(t=>t.status),[WT_STATUS.PICKING,WT_STATUS.PICKING])
    check(W,'失败取消波次保留待拣货',(await req(W,`/${salesWave}`)).data.status,1)
    await pool.query("UPDATE picking_waves SET priority=2,created_at='2026-09-13 00:00:00' WHERE id=?",[wave])
    await pool.query("UPDATE picking_waves SET priority=2,created_at='2026-09-13 23:59:59' WHERE id=?",[waveB])
    await pool.query("UPDATE picking_waves SET priority=2,created_at='2026-09-14 00:00:00' WHERE id=?",[salesWave])
    const selected=async(query,user=actor)=>(await req(W,`?${query}`,'GET',undefined,user)).data.list.filter(r=>[wave,waveB,salesWave].includes(r.id)).map(r=>r.id)
    check(W,'北京时间整日起止边界',await selected('startDate=2026-09-13&endDate=2026-09-13'),[waveB,wave])
    check(W,'单边开始日期',await selected('startDate=2026-09-14'),[salesWave])
    check(W,'单边结束日期',await selected('endDate=2026-09-13'),[waveB,wave])
    check(W,'仓库筛选',await selected(`warehouseId=${whB}`),[waveB])
    check(W,'状态筛选',await selected(`warehouseId=${whA}&status=4`),[wave])
    check(W,'限仓列表',await selected(`warehouseId=${whB}`,scoped),[])
    check(W,'关键词精确匹配',await selected(`keyword=${waveDetail.waveNo}`),[wave])
    check(W,'专项不改既有打印任务',await printSnapshot(),beforePrint)
    for(const mod of [B,W]) {
      check(mod,'分页上限',(await req(mod,'?pageSize=999999')).data.pagination.pageSize,500)
      check(mod,'SQL关键词参数化',(await req(mod,`?keyword=${encodeURIComponent("' OR 1=1 --")}`)).data.pagination.total,0)
    }
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve))
    try {
      for(const [table,col,values] of [['warehouse_task_events','task_id',ids('warehouse_tasks')],['picking_wave_items','wave_id',ids('picking_waves')],['picking_wave_tasks','wave_id',ids('picking_waves')],['auth_audit_logs','user_id',ids('sys_users')],['user_warehouse_scope','user_id',ids('sys_users')],['sys_role_permissions','role_id',ids('sys_roles')]])if(values.length){await pool.query(`DELETE FROM ${table} WHERE ${col} IN (?)`,[values]);const [[r]]=await pool.query(`SELECT COUNT(*) n FROM ${table} WHERE ${col} IN (?)`,[values]);assert.equal(Number(r.n),0,`cleanup ${table}`)}
      for(const table of ['inventory_logs','scan_logs','picking_waves','warehouse_task_items','inventory_containers','warehouse_tasks','sale_orders','sale_customers','warehouse_locations','product_items','inventory_warehouses','sys_users','sys_roles'])if(ids(table).length){await pool.query(`DELETE FROM ${table} WHERE id IN (?)`,[ids(table)]);const [[r]]=await pool.query(`SELECT COUNT(*) n FROM ${table} WHERE id IN (?)`,[ids(table)]);assert.equal(Number(r.n),0,`cleanup ${table}`)}
      console.log('[warehouse-assets-waves] cleanup verified: all owned IDs removed; no whole-table delete; sequences preserved')
    } finally {await pool.end()}
  }
  console.log('[warehouse-assets-waves] assertion counts',counts)
  assert.equal(failures.length,0,failures.join('\n'))
}
main().catch(error=>{console.error(error);process.exitCode=1})
