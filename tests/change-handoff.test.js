const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '..')
const runtimeLifecycleFile = path.join(root, 'backend/src/utils/runtimeLifecycle.js')
const { createRuntimeLifecycle } = require(runtimeLifecycleFile)
function load(relative, pool, transform = source => source) {
  const lifecycle = createRuntimeLifecycle()
  const stubs = {
    '../../config/db': { pool }, '../fulfillment/fulfillment.refresh': {},
    '../../utils/statusTransition': {}, '../../engine/reservationEngine': {}, '../../engine/containerEngine': {},
    '../../engine/inventoryEngine': { MOVE_TYPE: { TASK_OUT:9 } },
    '../../utils/inboundThresholds': { getInboundClosureThresholds:async()=>({}) },
    '../inbound-tasks/inbound-tasks.status': { getInboundPrintDispatchReasonLabel:value=>value },
    '../print-jobs/print-jobs.status': { deriveInboundBarcodeStatus:()=>({printStateLabel:'未记录'}) },
    '../sorting-bins/sorting-bins.service': {}, './warehouse-task-events.service': {},
    './warehouse-tasks.helpers': { assertTaskScope(row, { scopeWarehouseIds }) {
      if (scopeWarehouseIds && !scopeWarehouseIds.includes(Number(row.warehouse_id))) throw Object.assign(new Error('denied'), { statusCode:403 })
    } },
  }
  const cache = new Map()
  function read(filename) {
    if (filename === runtimeLifecycleFile) return { lifecycle }
    if (cache.has(filename)) return cache.get(filename).exports
    const actual = createRequire(filename), module = { exports:{} }; cache.set(filename, module)
    vm.runInNewContext(`(function(require,module,exports){${transform(fs.readFileSync(filename,'utf8'),filename)}\n})`, { process, console, Buffer }, { filename })(name => {
      if (stubs[name]) return stubs[name]
      const target = actual.resolve(name)
      if (target === path.join(root,'backend/src/config/db.js')) return { pool }
      return target.startsWith(path.join(root,'backend/src/')) ? read(target) : actual(name)
    }, module, module.exports)
    return module.exports
  }
  return read(path.join(root,relative))
}

test('递归VM夹具保留真实生命周期能力且各次加载独立', async () => {
  const operationFile = path.join(root, 'backend/src/utils/operationRequest.js')
  const expose = (source, file) => file === operationFile ? `${source}\nmodule.exports.fixtureLifecycle = lifecycle` : source
  const first = load('backend/src/utils/operationRequest.js', {}, expose).fixtureLifecycle
  const second = load('backend/src/utils/operationRequest.js', {}, expose).fixtureLifecycle
  for (const method of ['isDraining', 'beginDrain', 'startTask', 'stopTasks', 'waitForTasks']) assert.equal(typeof first[method], 'function')
  assert.notEqual(first, second)
  assert.equal(first.isDraining(), false)
  first.beginDrain()
  assert.equal(first.isDraining(), true)
  assert.equal(second.isDraining(), false)
  await first.waitForTasks()
  await second.waitForTasks()
})

const adj = { id:9, adjustment_no:'SYN-ADJ', sale_order_id:5, task_sale_order_id:5, warehouse_task_id:7, warehouse_id:2, status:1,
  requested_by:11, requested_by_name:'合成申请人', requested_at:'2026-10-10 10:00:00', completed_at:null }
const auditRow = (row, context = {phase:'cancellation_requested',warehouseTaskIds:[7],adjustmentId:9}) => ({
  payload_version:1, ...row, payload_json:{version:1,kind:'line_changes',quantityScale:2,priceScale:4,rows:[],context,reason:row.reason,actors:{operator:{id:11,name:row.requested_by_name || '合成申请人'}},token:'DO-NOT-RETURN'},
})
function fixture({ legacy = false, completed = false, scanCount = 1 } = {}) {
  const queries = []
  const pool = { async query(sql, params) {
    queries.push({ sql, params })
    assert.match(sql.trim(), /^SELECT\b/, 'read metadata must never mutate business facts')
    if (sql.includes('FROM sale_order_adjustments soa')) return [[{ ...adj, status:completed?2:1, completed_at:completed?'2026-10-10 11:00:00':null }]]
    if (sql.includes('FROM sale_order_adjustment_items')) return [[{ id:13, adjustment_id:9, product_id:3, old_required_qty:2, new_required_qty:1, status:completed?2:1 }]]
    if (sql.includes('FROM sale_order_adjustment_package_voids')) return [[{ id:14, adjustment_id:9, task_id:7, adjustment_item_id:13, package_id:17, barcode:'BOX-SYN', status:2, confirmed_by:12, confirmed_by_name:'合成拆箱人', confirmed_at:'2026-10-10 10:30:00' }]]
    if (sql.includes('FROM sale_order_adjustment_container_returns')) return [[{ id:15, adjustment_id:9, task_id:7, adjustment_item_id:13, source_container_id:18, container_barcode:'INV-SYN', qty:1, status:completed?2:1, confirmed_by:completed?13:null, confirmed_by_name:completed?'合成归还人':null, confirmed_at:completed?'2026-10-10 11:00:00':null }]]
    if (sql.includes('FROM document_operation_events')) return [legacy?[]:[auditRow({ id:21, reason:'合成仓库交接', requested_by:11, requested_by_name:'合成申请人', requested_at:'2026-10-10 10:00:00', document_id:5, adjustment_id:9, task_id:7, unit_price:'DO-NOT-RETURN' })]]
    if (sql.includes('FROM warehouse_tasks wt')) return [[{ id:7, sale_order_id:5, warehouse_id:2, status:completed?8:5, cancel_requested_at:completed?null:'2026-10-10 10:00:00' }]]
    if (sql.includes('FROM scan_logs')) return [Array.from({length:scanCount},(_,i)=>({ id:30+i, task_id:7, barcode:`INV-${i}`, qty:'1.25', operator_id:13, operator_name:'合成归还人', scanned_at:'2026-10-10 10:40:00' }))]
    if (sql.includes('FROM warehouse_task_events')) return [[{ id:40, task_id:7, event_type:'CANCEL_REQUESTED', operator_id:11, operator_name:'合成申请人', created_at:'2026-10-10 10:00:00' }, { id:41, task_id:7, event_type:'CANCEL_RETURN_BOX_SCAN', operator_id:12, operator_name:'合成拆箱人', created_at:'2026-10-10 10:30:00', barcode:'BOX-SYN', detail:{ token:'DO-NOT-RETURN' } }, ...(completed?[{id:42,task_id:7,event_type:'CANCEL_FINALIZED',created_at:'2026-10-10 11:00:00'}]:[])]]
    return [[]]
  } }
  return { pool, queries }
}
test('改单读同一原因与实际申请、确认事实，只投影仓库白名单', async () => {
  const f=fixture(), svc=load('backend/src/modules/warehouse-tasks/warehouse-tasks.adjust.js',f.pool)
  const result=await svc.getAdjustmentDetail(9,[2])
  assert.equal(result.handoff?.reason,'合成仓库交接')
  assert.equal(result.handoff.requestedBy.name,'合成申请人')
  assert.equal(result.handoff.phase,'pending')
  assert.equal(result.items[0].packageVoids[0].confirmedBy.name,'合成拆箱人')
  assert.equal(result.items[0].packageVoids[0].confirmedAt,'2026-10-10 10:30:00')
  assert.equal(result.items[0].containerReturns[0].confirmedBy,null)
  assert.equal(JSON.stringify(result).includes('DO-NOT-RETURN'),false)
  const audit=f.queries.find(q=>q.sql.includes('FROM document_operation_events'))
  assert.deepEqual(Array.from(audit.params),[5,9])
  assert.match(audit.sql,/adjustmentId/)
  assert.doesNotMatch(audit.sql,/SELECT\s+\*|SELECT\s+payload_json/i)
})
test('销售原记录交接批读实际申请、挂起和确认事实，任务数不会新增查询', async () => {
  for(const count of [1,60]) {
    const f=fixture(), helper=load('backend/src/modules/warehouse-tasks/warehouse-tasks.handoff.js',f.pool)
    const result=await helper.readTaskHandoffs(f.pool,Array.from({length:count},(_,i)=>7+i),[])
    const change=result.rows.find(r=>r.kind==='改单')
    assert.equal(change.reason,'合成仓库交接');assert.equal(change.phase,'pending');assert.equal(change.containersRemaining,1)
    assert.equal(result.confirmations.find(c=>c.kind==='package_void').confirmedBy.name,'合成拆箱人')
    const cancellation=result.confirmations.find(c=>c.handoffKind==='取消')
    assert.equal(cancellation.adjustmentId,null);assert.equal(cancellation.adjustmentNo,null)
    assert.equal(f.queries.length,8)
    assert.equal(JSON.stringify(result).includes('DO-NOT-RETURN'),false)
  }
})
test('同一任务两笔改单的原因和确认人按真实改单编号关联，两张销售记录表共同呈现', async () => {
  const f=fixture(), query=f.pool.query
  f.pool.query=async(sql,params)=>{
    const answer=await query(sql,params)
    if(sql.includes('FROM warehouse_tasks wt')) return [[{id:7,task_no:'WT-SYN',sale_order_id:5,status:5,cancel_requested_at:null}]]
    if(sql.includes('FROM sale_order_adjustments soa')) return [[
      {...adj,status:2,adjustment_no:'ADJ-FIRST'}, {...adj,id:10,status:2,adjustment_no:'ADJ-SECOND'},
    ]]
    if(sql.includes('FROM document_operation_events')) return [[
      auditRow({id:22,task_id:7,document_id:5,adjustment_id:10,reason:'第二笔原因'},{warehouseTaskId:7,adjustmentId:10}),
      auditRow({id:21,task_id:7,document_id:5,adjustment_id:9,reason:'第一笔原因'},{warehouseTaskId:7,adjustmentId:9}),
    ]]
    if(sql.includes('FROM sale_order_adjustment_package_voids')) return [[
      {id:14,adjustment_id:9,task_id:7,barcode:'BOX-FIRST',status:2,confirmed_by:12,confirmed_by_name:'第一笔拆箱人',confirmed_at:'2026-10-10 10:30:00'},
      {id:16,adjustment_id:10,task_id:7,barcode:'BOX-SECOND',status:2,confirmed_by:22,confirmed_by_name:'第二笔拆箱人',confirmed_at:'2026-10-10 11:30:00'},
    ]]
    if(sql.includes('FROM sale_order_adjustment_container_returns')) return [[
      {id:15,adjustment_id:9,task_id:7,barcode:'INV-FIRST',qty:1,status:2,confirmed_by:13,confirmed_by_name:'第一笔归还人',confirmed_at:'2026-10-10 10:40:00'},
      {id:17,adjustment_id:10,task_id:7,barcode:'INV-SECOND',qty:2,status:2,confirmed_by:23,confirmed_by_name:'第二笔归还人',confirmed_at:'2026-10-10 11:40:00'},
    ]]
    if(sql.includes('FROM warehouse_task_events') || sql.includes('FROM scan_logs')) return [[]]
    return answer
  }
  const helper=load('backend/src/modules/warehouse-tasks/warehouse-tasks.handoff.js',f.pool)
  const result=await helper.readTaskHandoffs(f.pool,[7],[])
  assert.equal(f.queries.length,8)
  assert.deepEqual(Array.from(result.rows,r=>[r.adjustmentNo,r.reason]),[['ADJ-FIRST','第一笔原因'],['ADJ-SECOND','第二笔原因']])
  assert.deepEqual(Array.from(result.confirmations,c=>[c.adjustmentId,c.adjustmentNo,c.confirmedBy.name]),[
    [9,'ADJ-FIRST','第一笔拆箱人'],[10,'ADJ-SECOND','第二笔拆箱人'],[9,'ADJ-FIRST','第一笔归还人'],[10,'ADJ-SECOND','第二笔归还人'],
  ])
  assert.ok(result.confirmations.every(c=>c.handoffKind==='改单'))
  const progress=load('backend/src/modules/document-activity/document-progress.js',f.pool)
  const data=await progress.buildProgress('sale',5,{tasks:[{taskId:7}]},{})
  for(const title of ['仓库交接','仓库确认记录']) {
    const section=data.sections.find(s=>s.title===title)
    assert.equal(section.group,'log')
    assert.ok(section.columns.some(c=>c.key==='adjustmentNo'&&c.label==='改单编号'))
    assert.ok(section.rows.some(r=>r.adjustmentNo==='ADJ-FIRST'))
    assert.ok(section.rows.some(r=>r.adjustmentNo==='ADJ-SECOND'))
  }
})
test('销售头和剩余已发物料在仓1，已删未发物料的历史取消任务仓2不能提供新增交接', async () => {
  const f=fixture(), query=f.pool.query
  const events=[
    {id:40,task_id:7,event_type:'CANCEL_REQUESTED',operator_id:11,operator_name:'本仓申请人',created_at:'2026-10-10 10:00:00'},
    {id:41,task_id:22,event_type:'CANCEL_REQUESTED',operator_id:21,operator_name:'他仓申请人',created_at:'2026-10-10 11:00:00'},
    {id:42,task_id:22,event_type:'CANCEL_RETURN_BOX_SCAN',operator_id:22,operator_name:'他仓拆箱人',created_at:'2026-10-10 11:30:00',detail:{barcode:'BOX-OTHER'}},
  ]
  f.pool.query=async(sql,params)=>{
    const answer=await query(sql,params), ids=Array.isArray(params?.[0]) ? params[0].map(Number) : []
    if(sql.includes('SELECT wt.id FROM warehouse_tasks wt')) return [[{id:7}]]
    // 故意不让夹具代做任务头范围过滤：helper必须核实际warehouse_id，不能信doc.tasks。
    if(sql.includes('FROM warehouse_tasks wt')) return [[
      {id:7,task_no:'WT-LOCAL',sale_order_id:5,warehouse_id:1,status:5,cancel_requested_at:'2026-10-10 10:00:00'},
      {id:22,task_no:'WT-OTHER',sale_order_id:5,warehouse_id:2,status:8,cancel_requested_at:null},
    ]]
    if(sql.includes('FROM document_operation_events')) return [[
      auditRow({id:21,task_id:7,document_id:5,adjustment_id:null,reason:'本仓原因',requested_by:11,requested_by_name:'本仓申请人'},{warehouseTaskIds:[7]}),
      auditRow({id:22,task_id:22,document_id:5,adjustment_id:null,reason:'他仓原因',requested_by:21,requested_by_name:'他仓申请人'},{warehouseTaskIds:[22]}),
    ].filter(row=>ids.includes(row.task_id))]
    if(sql.includes('FROM sale_order_adjustments soa') || sql.includes('FROM sale_order_adjustment_package_voids') || sql.includes('FROM sale_order_adjustment_container_returns')) return [[]]
    if(sql.includes('FROM scan_logs')) return [[
      {id:30,task_id:7,barcode:'INV-LOCAL',qty:1,operator_id:12,operator_name:'本仓确认人',scanned_at:'2026-10-10 10:30:00'},
      {id:31,task_id:22,barcode:'INV-OTHER',qty:2,operator_id:23,operator_name:'他仓确认人',scanned_at:'2026-10-10 11:40:00'},
    ].filter(row=>ids.includes(row.task_id))]
    if(sql.includes('FROM warehouse_task_events')) return [events.filter(event=>ids.includes(event.task_id))]
    return answer
  }
  // 头与现存物料全部仓1；doc历史任务仓字段故意错误，实际库中task22仓2才是授权来源。
  const doc={warehouseId:1,items:[{warehouseId:1,quantity:1,shippedQty:1}],tasks:[{taskId:7,warehouseId:1},{taskId:22,warehouseId:1}]}
  const progress=load('backend/src/modules/document-activity/document-progress.js',f.pool)
  const limited=await progress.buildProgress('sale',5,doc,{warehouseIds:[1]})
  const newSections=limited.sections.filter(s=>s.title==='仓库交接'||s.title==='仓库确认记录')
  assert.ok(newSections.length)
  assert.ok(newSections[0].rows.some(row=>row.reason==='本仓原因'))
  assert.doesNotMatch(JSON.stringify(newSections),/他仓|WT-OTHER|INV-OTHER|BOX-OTHER|PRIVATE-PRICE/)
  const head=f.queries.find(q=>q.sql.includes('FROM warehouse_tasks wt'))
  assert.match(head.sql,/wt\.warehouse_id/)
  assert.match(head.sql,/AND wt\.warehouse_id IN \(\?\)/)
  assert.deepEqual(Array.from(head.params[1]),[1])
  const details=f.queries.filter(q=>/FROM document_operation_events|FROM sale_order_adjustments soa|FROM sale_order_adjustment_package_voids|FROM sale_order_adjustment_container_returns/.test(q.sql))
  assert.ok(details.every(q=>!q.params[0].map(Number).includes(22)), '禁止在读取交接正文后仅丢弃他仓结果')
  assert.equal(limited.events.length,1,'进度事件复用实际获权任务集合')
  assert.doesNotMatch(JSON.stringify(limited.events),/他仓|BOX-OTHER/)
  f.queries.length=0
  const helper=load('backend/src/modules/warehouse-tasks/warehouse-tasks.handoff.js',f.pool)
  const empty=await helper.readTaskHandoffs(f.pool,[7,22],events,[])
  assert.equal(empty.rows.length,0);assert.equal(empty.confirmations.length,0);assert.equal(f.queries.length,0)
  const all=await helper.readTaskHandoffs(f.pool,[7,22],events,null)
  assert.equal(all.rows.length,2);assert.equal(all.confirmations.length,3);assert.equal(f.queries.length,7)
  assert.match(JSON.stringify(all),/他仓原因|他仓确认人|他仓拆箱人/)
  assert.doesNotMatch(JSON.stringify(all),/PRIVATE-PRICE|payload_json|unitPrice/)
})
test('交接批读范围过滤不吞数据库错误，原errno继续抛出', async () => {
  const f=fixture(), query=f.pool.query
  const failure=Object.assign(new Error('synthetic query failure'),{code:'ER_BAD_FIELD_ERROR',errno:1054})
  f.pool.query=async(sql,params)=>{
    if(sql.includes('FROM document_operation_events'))throw failure
    return query(sql,params)
  }
  const helper=load('backend/src/modules/warehouse-tasks/warehouse-tasks.handoff.js',f.pool)
  await assert.rejects(()=>helper.readTaskHandoffs(f.pool,[7],[],null),error=>error===failure&&error.errno===1054)
})
test('混合取消原因、跨仓前值和错单改单不能从批读或直接详情回流', async () => {
  const f=fixture(), query=f.pool.query
  f.pool.query=async(sql,params)=>{
    const answer=await query(sql,params)
    if(sql.includes('FROM warehouse_tasks wt')) return [[{id:7,sale_order_id:5,warehouse_id:2,status:5,cancel_requested_at:'2026-10-10 10:00:00'},{id:22,sale_order_id:5,warehouse_id:3,status:8}]]
    if(sql.includes('FROM document_operation_events')) return [[auditRow({id:21,task_id:7,document_id:5,reason:'MIX-PRIVATE'},{phase:'cancellation_requested',warehouseTaskIds:[7,22]})]]
    return answer
  }
  const helper=load('backend/src/modules/warehouse-tasks/warehouse-tasks.handoff.js',f.pool)
  assert.doesNotMatch(JSON.stringify(await helper.readTaskHandoffs(f.pool,[7],[],[2])),/MIX-PRIVATE/)
  assert.doesNotMatch(JSON.stringify(await helper.readCancelHandoff(f.pool,{id:7,sale_order_id:5,status:5},[2])),/MIX-PRIVATE/)
  assert.match(JSON.stringify(await helper.readCancelHandoff(f.pool,{id:7,sale_order_id:5,status:5},null)),/MIX-PRIVATE/)
  f.pool.query=async(sql,params)=>{
    const answer=await query(sql,params)
    if(sql.includes('FROM sale_order_adjustments soa')) return [[{...adj,sale_order_id:99,requested_by_name:'WRONG-PARENT'}]]
    return answer
  }
  const bulk=await helper.readTaskHandoffs(f.pool,[7],[],[2])
  assert.equal(bulk.rows.filter(r=>r.kind==='改单').length,0)
  assert.equal(bulk.confirmations.filter(r=>r.handoffKind==='改单').length,0)
  assert.doesNotMatch(JSON.stringify(bulk),/WRONG-PARENT/)
  const svc=load('backend/src/modules/warehouse-tasks/warehouse-tasks.adjust.js',f.pool)
  await assert.rejects(()=>svc.getAdjustmentDetail(9,[2]),error=>error.code==='WAREHOUSE_TASK_HISTORY_INVALID'&&error.statusCode===409)
})
test('反向证明：移除交接投影或前置范围校验，会击中相同业务断言', async () => {
  const verify = async transform => {
    const f=fixture(), svc=load('backend/src/modules/warehouse-tasks/warehouse-tasks.adjust.js',f.pool,transform)
    const result=await svc.getAdjustmentDetail(9,[2])
    assert.equal(result.handoff?.reason,'合成仓库交接')
  }
  await assert.rejects(()=>verify(source=>source.replace('handoff,','')),assert.AssertionError)
  const f=fixture(), svc=load('backend/src/modules/warehouse-tasks/warehouse-tasks.adjust.js',f.pool,
    source=>source.replace('assertTaskScope(adj, { scopeWarehouseIds })',''))
  await assert.rejects(async()=>{
    await assert.rejects(()=>svc.getAdjustmentDetail(9,[99]),/denied/)
  },assert.AssertionError)
})
test('改单完成与旧缺原因分别保留实际阶段、时间，不猜空确认人', async () => {
  const f=fixture({legacy:true,completed:true}), svc=load('backend/src/modules/warehouse-tasks/warehouse-tasks.adjust.js',f.pool)
  const result=await svc.getAdjustmentDetail(9,[2])
  assert.equal(result.handoff?.reason,null)
  assert.equal(result.handoff.requestedBy.name,'合成申请人')
  assert.equal(result.handoff.phase,'completed')
  assert.equal(result.handoff.completedAt,'2026-10-10 11:00:00')
  assert.equal(result.items[0].containerReturns[0].confirmedBy.name,'合成归还人')
})
test('选填原因正文为字面字符串 null 时仍原样保留，不与 JSON 空值混淆', async () => {
  const f=fixture(), query=f.pool.query
  f.pool.query=async(sql,params)=>{
    const answer=await query(sql,params)
    if(sql.includes('FROM document_operation_events'))answer[0][0].reason='null'
    return answer
  }
  const svc=load('backend/src/modules/warehouse-tasks/warehouse-tasks.adjust.js',f.pool)
  assert.equal((await svc.getAdjustmentDetail(9,[2])).handoff.reason,'null')
})
test('范围拒绝在原因/扫码/确认记录查询之前，保留原仓库权限边界', async () => {
  for (const [file,method,id] of [['warehouse-tasks.adjust.js','getAdjustmentDetail',9],['warehouse-tasks.cancel-return.js','getCancelReturnDetail',7]]) {
    const f=fixture(), svc=load(`backend/src/modules/warehouse-tasks/${file}`,f.pool)
    await assert.rejects(()=>svc[method](id,[99]),/denied/)
    assert.equal(f.queries.length,1)
  }
})
test('取消交接核原销售与当前任务，实际归还及拆箱批读且完成后仍可查', async () => {
  for(const scanCount of [1,60]) {
    const f=fixture({completed:true,scanCount}), svc=load('backend/src/modules/warehouse-tasks/warehouse-tasks.cancel-return.js',f.pool)
    const result=await svc.getCancelReturnDetail(7,[2])
    assert.equal(result.handoff?.reason,'合成仓库交接')
    assert.equal(result.handoff.phase,'completed')
    assert.equal(result.handoff.completedAt,'2026-10-10 11:00:00')
    assert.equal(result.confirmations.length,scanCount+1)
    assert.equal(result.confirmations.find(c=>c.kind==='container_return').qty,1.25)
    assert.equal(result.confirmations.find(c=>c.kind==='package_void').confirmedBy.name,'合成拆箱人')
    assert.equal(JSON.stringify(result).includes('DO-NOT-RETURN'),false)
    assert.equal(f.queries.filter(q=>q.sql.includes('FROM scan_logs')).length,1)
    const audit=f.queries.find(q=>q.sql.includes('FROM document_operation_events'))
    assert.deepEqual(Array.from(audit.params),[5,7,7])
    assert.match(audit.sql,/cancellation_requested/)
    assert.match(audit.sql,/warehouseTaskIds/)
    assert.match(audit.sql,/warehouseTaskIds'\) IS NULL/, 'a known multi-task cancel must not attach its reason to a shipped header task')
  }
})
