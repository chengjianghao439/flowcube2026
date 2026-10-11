 'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createRequire } = require('node:module')
const filename = path.resolve(__dirname, '../backend/src/modules/inbound-tasks/inbound-tasks.command.js')
function fixture() {
 const real = createRequire(filename), module_ = { exports:{} }, requests = new Map(), writes=[]
 const fingerprint = real('./inbound-tasks.edit-rules').requestFingerprint
 let taskCount=0
 const conn={ query:async(sql,args=[])=>{
  if(/^SET TRANSACTION/.test(sql))return [[]]
  if(/INSERT INTO inbound_tasks /.test(sql)){taskCount++;writes.push(sql);return [{insertId:taskCount}]}
  if(/INSERT INTO inbound_task_items/.test(sql)){writes.push(sql);return [{affectedRows:1}]}
  if(/SELECT \* FROM purchase_orders/.test(sql))return [[{id:3,order_no:'PO',supplier_id:5,warehouse_id:2,warehouse_name:'仓',supplier_name:'供',status:2}]]
  if(/SELECT \* FROM purchase_order_items/.test(sql))return [[{id:31,order_id:3}]]
  if(/SELECT it.id/.test(sql))return [[]]
  throw Error(sql)
 },beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{}}
 const candidates=[{purchaseItemId:31,purchaseOrderId:3,purchaseOrderNo:'PO',supplierId:5,supplierName:'供',warehouseId:2,warehouseName:'仓',productId:7,productName:'品',remainingQty:20,unit:'个'}]
 const stubs={
  '../../utils/warehouseScope':{assertInScope:(scope,id)=>{if(Array.isArray(scope)&&!scope.includes(id))throw Object.assign(Error('范围拒绝'),{statusCode:403})}},'../../config/db':{pool:{getConnection:async()=>conn}},'../fulfillment/fulfillment.refresh':{commitFulfillment:async c=>c.commit()},
  '../../engine/containerEngine':{},'../print-jobs/print-jobs.service':{},'../../config/env':{env:{}},'./inbound-tasks.status':{},'./inbound-tasks.putaway':{},
  './inbound-tasks.helpers':{genTaskNo:async()=>`IT-${taskCount+1}`,appendInboundEvent:async()=>{}},'./inbound-tasks.query':{loadPurchasableCandidates:async()=>candidates},
  '../../utils/qtyPrecision':{...real('../../utils/qtyPrecision'),assertQtyPrecision:async()=>{}},
  '../../utils/operationRequest':{completeOperationRequest:async(_c,state,{data})=>requests.set(state.requestKey,data)},
  './inbound-tasks.create-receipt':{
   beginInboundCreate:async(_c,body,{requestKey,userId}={})=>requestKey?{enabled:true,requestKey,userId,action:'inbound.create',fingerprint:fingerprint(body),replay:requests.has(requestKey),responseData:requests.get(requestKey)}:{enabled:false},
   replayInboundCreate:async(_c,state)=>{if(state.responseData.requestFingerprint!==state.fingerprint)throw Object.assign(Error('正文冲突'),{statusCode:409,code:'INBOUND_CREATE_REQUEST_CONFLICT'});return state.responseData},
  }
 }
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module:module_,require:id=>Object.hasOwn(stubs,id)?stubs[id]:real(id),Date},{filename})
 return {svc:module_.exports,writes,requests,count:()=>taskCount}
}
const body=()=>({supplierId:5,supplierName:'供',freightType:2,freightAmount:0,remark:'原正文',items:[{purchaseItemId:31,qty:1.25}]})
test('manual同键同正文回原单且只INSERT一张，不仅按钮防重',async()=>{
 const f=fixture(),options={requestKey:'original-key',userId:50};const first=await f.svc.createManualTask(body(),[2],options),second=await f.svc.createManualTask(body(),[2],options)
 assert.deepEqual(second,first);assert.equal(f.count(),1);assert.equal(f.requests.size,1)
})
test('manual同键变正文拒绝，不第二次消耗来源量',async()=>{
 const f=fixture(),options={requestKey:'original-key',userId:50};await f.svc.createManualTask(body(),[2],options)
 await assert.rejects(f.svc.createManualTask({...body(),remark:'变更正文'},[2],options),{code:'INBOUND_CREATE_REQUEST_CONFLICT'});assert.equal(f.count(),1)
})
test('整PO同键回原单，不落第二张也不被未完结/剩余量规则挡住',async()=>{
 const f=fixture(),options={requestKey:'po-key',userId:50};const first=await f.svc.createFromPoId(3,[2],{},options),second=await f.svc.createFromPoId(3,[2],{},options)
 assert.deepEqual(second,first);assert.equal(f.count(),1)
})
test('无键内部和旧客户端仍兼容既有创建，不声明受幂等保护',async()=>{
 const f=fixture();await f.svc.createManualTask(body(),[2]);await f.svc.createManualTask(body(),[2]);assert.equal(f.count(),2);assert.equal(f.requests.size,0)
})


function receiptFixture() {
 const file = path.resolve(__dirname, '../backend/src/modules/inbound-tasks/inbound-tasks.create-receipt.js'), real = createRequire(file), module_ = { exports: {} }, calls = []
 const stubs = {
  '../../utils/warehouseScope': { assertInScope: (scope,id) => { if (Array.isArray(scope) && !scope.includes(Number(id))) throw Object.assign(Error('scope'), { code: 'WAREHOUSE_SCOPE_DENIED' }) } },
  '../../utils/operationRequest': { beginOperationRequest: async (_conn,args) => { calls.push(args); return { enabled:true, ...args } } },
  '../../middleware/auth': { requirePermission: code => (_req,_res,next) => { calls.push(code); next(Object.assign(Error('denied'), { code: 'PERMISSION_DENIED' })) } },
 }
 vm.runInNewContext(fs.readFileSync(file,'utf8'), { module:module_, require:id => Object.hasOwn(stubs,id) ? stubs[id] : real(id) }, { filename:file })
 return { helper:module_.exports,calls }
}
const receiptData = { taskId:81, taskNo:'IT81', warehouseId:2, requestFingerprint:'a'.repeat(64) }
const receiptContext = { requestedAction:'inbound.create', matchedAction:'inbound.create', requestedWarehouseId:2, requestedFingerprint:'a'.repeat(64) }
const receiptSuccess = { status:'success', resourceType:'inbound_task', resourceId:81, data:receiptData }
test('真实begin帮助函数固定本人/key/action并算全正文指纹，旧无键不调用通用入口', async()=>{
 const f=receiptFixture();assert.equal((await f.helper.beginInboundCreate({},body())).enabled,false);assert.equal(f.calls.length,0)
 const value=await f.helper.beginInboundCreate({},body(),{requestKey:' original ',userId:50});assert.match(value.fingerprint,/^[a-f0-9]{64}$/);assert.equal(f.calls[0].action,'inbound.create');assert.equal(f.calls[0].requestKey,'original');assert.equal(f.calls[0].userId,50)
 await assert.rejects(f.helper.beginInboundCreate({},body(),{requestKey:'x',userId:null}));await assert.rejects(f.helper.beginInboundCreate({},body(),{requestKey:'x'.repeat(101),userId:50}));assert.equal(f.calls.length,1)
})
test('not_found也校当前原仓；success核资源/真实头/原正文/实际action；不读采购余量',async()=>{
 const f=receiptFixture(),queries=[],conn={query:async sql=>{queries.push(sql);return [[{id:81,task_no:'IT81',warehouse_id:2}]]}}
 await assert.rejects(f.helper.assertInboundCreateReceipt(conn,{status:'not_found'},[],receiptContext),{code:'WAREHOUSE_SCOPE_DENIED'});assert.equal(queries.length,0)
 for(const [receipt,context] of [[{...receiptSuccess,resourceId:99},receiptContext],[receiptSuccess,{...receiptContext,requestedFingerprint:'b'.repeat(64)}],[receiptSuccess,{...receiptContext,matchedAction:null}],[receiptSuccess,{...receiptContext,requestedAction:'inbound'}]])await assert.rejects(f.helper.assertInboundCreateReceipt(conn,receipt,[2],context),{code:'INBOUND_CREATE_RECEIPT_INVALID'})
 await f.helper.assertInboundCreateReceipt(conn,receiptSuccess,[2],{...receiptContext,currentRead:true});assert.equal(queries.length,1);assert.match(queries[0],/FROM inbound_tasks.*FOR SHARE/)
 await assert.rejects(f.helper.assertInboundCreateReceipt({query:async()=>[[{id:81,task_no:'wrong',warehouse_id:2}]]},receiptSuccess,[2],receiptContext),{code:'INBOUND_CREATE_RECEIPT_INVALID'})
})
test('本人最小创建回执必须当前VIEW，宽prefix实际命中也拒绝',async()=>{
 const f=receiptFixture();await f.helper.ensureInboundCreateReceiptView({}, {}, {requestedAction:'sale.create'});assert.equal(f.calls.length,0)
 for(const context of [{requestedAction:'inbound.create'},{requestedAction:'inbound',matchedAction:'inbound.create'}])await assert.rejects(f.helper.ensureInboundCreateReceiptView({}, {}, context),{code:'PERMISSION_DENIED'})
 assert.deepEqual(f.calls,['inbound.order.view','inbound.order.view'])
})
test('真实回执query schema保留原仓/64位正文指纹，旧action查询仍兼容',()=>{
 const file=path.resolve(__dirname,'../backend/src/modules/system/system.routes.js'),real=createRequire(file),module_={exports:{}},noop=()=>{}
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:module_,require:id=>id==='./system.controller'?{requestStatus:noop,reportError:noop}:id==='../../middleware/auth'?{authMiddleware:noop}:id==='./system.split-device'?{splitReceiptDevice:noop}:real(id)},{filename:file})
 const validate=module_.exports.stack.find(l=>l.route?.path==='/request-status/:key').route.stack[0].handle
 const req={query:{action:'inbound.create',warehouseId:'2',requestFingerprint:'a'.repeat(64)}};let passed=false;validate(req,{},()=>{passed=true});assert.equal(passed,true);assert.equal(req.query.warehouseId,2);assert.equal(req.query.requestFingerprint,'a'.repeat(64))
 const old={query:{action:'inbound.update.81'}};validate(old,{},noop);assert.equal(old.query.action,'inbound.update.81')
 let status;validate({query:{action:'inbound.create',warehouseId:'bad'}},{status:n=>{status=n;return {json:()=>{}}}},noop);assert.equal(status,400)
})
