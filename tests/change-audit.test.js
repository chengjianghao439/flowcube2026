const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '..')
function loadService(relative, stubs, transform = source => source) {
  const cached = new Map()
  function load(filename) {
    if (cached.has(filename)) return cached.get(filename).exports
    const actual = createRequire(filename), module = { exports: {} }; cached.set(filename, module)
    vm.runInNewContext(`(function(require,module,exports){${transform(fs.readFileSync(filename, 'utf8'), filename)}\n})`, { Buffer, process, console }, { filename })(name => {
      if (stubs[name]) return stubs[name]
      const target = actual.resolve(name)
      if (target === path.join(root, 'backend/src/config/db.js')) return stubs['../../config/db']
      return target.startsWith(path.join(root, 'backend/src/')) ? load(target) : actual(name)
    }, module, module.exports)
    return module.exports
  }
  return load(path.join(root, relative))
}

function fixture({ failAudit = false } = {}) {
  const queries = [], before = [{ product_id: 7, product_code: 'SYN-7', product_name: '合成商品', unit: '件', sale_price: '1.2345' }]
  let staged = [], saved = [], rolledBack = false, finalRows = before
  const conn = {
    async beginTransaction() {},
    async query(sql, params) {
      queries.push({ sql, params })
      if (sql.includes('FROM price_lists')) return [[{ id: 3, name: '合成价格表' }]]
      if (sql.includes('FROM price_list_items')) return [finalRows]
      if (sql.includes('INSERT INTO price_list_items')) { finalRows = params[0].map(r => ({ product_id:r[1],product_code:r[2],product_name:r[3],unit:r[4],sale_price:Number(r[5]).toFixed(4) })); return [{ affectedRows:1 }] }
      if (sql.includes('DELETE FROM price_list_items')) { finalRows=[]; return [{ affectedRows:1 }] }
      if (sql.includes('FROM operation_requests')) return [[]]
      if (sql.includes('FROM document_operation_events')) return [[]]
      if (sql.includes('INSERT INTO document_operation_events')) { if (failAudit) throw new Error('audit write failed'); staged.push(params); return [{ insertId: 12 }] }
      if (sql.includes('INSERT INTO operation_requests')) return [{ insertId: 99 }]
      return [{ affectedRows: 1 }]
    },
    async commit() { saved = [...staged] }, async rollback() { staged = []; rolledBack = true }, release() {},
  }
  const pool = { query: conn.query.bind(conn), getConnection: async () => conn }
  return { conn, pool, queries, get saved() { return saved }, get rolledBack() { return rolledBack } }
}
test('价格表覆盖基于锁内旧集合并同事务保留四位单价差异与一次原因', async () => {
  const f = fixture(), svc = loadService('backend/src/modules/price-lists/price-lists.service.js', { '../../config/db': { pool: f.pool } })
  await svc.updateItems(3, [{ productId: 7, productCode: 'SYN-7', productName: '合成商品', unit: '件', salePrice: 1.2356 }], { operator: { userId: 6, realName: '合成操作人' }, changeReason: '调整报价' })
  assert.equal(f.saved.length, 1, 'effective business write must retain its change event in the same transaction')
  assert.ok(f.queries.find(q => q.sql.includes('FROM price_lists')).sql.includes('FOR UPDATE'), 'parent must serialize actual before-set')
  const audit = f.queries.find(q => q.sql.includes('INSERT INTO document_operation_events'))
  const payload = JSON.parse(audit.params.find(p => typeof p === 'string' && p.startsWith('{')))
  assert.equal(payload.reason, '调整报价')
  assert.equal(payload.rows[0].before.unitPrice, '1.2345')
  assert.equal(payload.rows[0].after.unitPrice, '1.2356')
})
test('差异留痕失败使价格表业务事务回滚', async () => {
  const f = fixture({ failAudit: true }), svc = loadService('backend/src/modules/price-lists/price-lists.service.js', { '../../config/db': { pool: f.pool } })
  await assert.rejects(svc.updateItems(3, [{ productId: 7, salePrice: 2 }]), /audit write failed/)
  assert.equal(f.rolledBack, true); assert.equal(f.saved.length, 0)
})
test('普通与套件请求的选填原因保留且旧客户端可省略', () => {
  const contracts = require('../backend/src/modules/sale/sale.contracts')
  const ordinary = { customerId: 1, customerName: '合成', warehouseId: 1, warehouseName: '合成仓', items: [{ productId: 7, productCode: 'SYN-7', productName: '合成商品', unit: '件', quantity: 1, unitPrice: 1.2345 }], changeReason: '变更数量' }
  assert.equal(contracts.createSaleSchema.parse(ordinary).changeReason, '变更数量')
  const { changeReason, items, ...legacy } = ordinary
  assert.equal(contracts.createSaleSchema.safeParse({ ...legacy, items }).success, true)
  assert.equal(contracts.commercialCreateSaleSchema.parse({ ...legacy, commercialModel: 'kit-v1', commercialGroups: [{ kind: 'ordinary', lineKey: 'one', productId: 7, quantity: 1, unitPrice: 1.2345, priceSource: 'manual' }], changeReason }).changeReason, changeReason)
})

test('套件物理行重建ID不制造变更，但保留真实组件关系', () => {
  const f = fixture(), audit = loadService('backend/src/modules/document-activity/document-change-audit.js', { '../../config/db': { pool: f.pool } })
  const group = { lineKey:'kit-1',kind:'kit',kitVersionId:8,snapshotRevision:2,targetQty:1,unitPrice:9.1234,components:[{ productId:7,baseQty:2,requiredQty:2,referencePrice:1.2345,allocatedAmount:9.1234,saleItemId:12 }] }
  const after = { ...group,components:[{...group.components[0],saleItemId:19}] }
  assert.equal(audit.lineDiff([group],[after]).length,0)
  assert.equal(audit.canonicalLine(after).components[0].saleItemId,19)
})
test('无变化不写有效差异，零变更回执的同键异体仍拒绝', async () => {
  const f = fixture(), audit = loadService('backend/src/modules/document-activity/document-change-audit.js', { '../../config/db': { pool: f.pool } })
  await audit.appendChangeAudit(f.conn,{documentType:'sale',documentId:3,title:'编辑订单',before:[],after:[],context:{phase:'draft_edit'}})
  assert.equal(f.queries.filter(q => q.sql.includes('INSERT INTO document_operation_events')).length,0)
  const conn = { async query(sql) { return sql.includes('FROM operation_requests') ? [[{id:5,request_fingerprint:'previous-body'}]] : [[]] } }
  await assert.rejects(audit.assertChangeRequest(conn,{requestKey:'same-key',action:'sale.adjust.3',userId:6,payload:{quantity:2}}),e => e.code === 'CHANGE_REQUEST_CONFLICT')
})

test('批准改价的操作人是真实认证批准人，申请人单独留存', async () => {
  const f=fixture(), query=f.conn.query.bind(f.conn)
  f.conn.query=async (sql,params) => {
    if(sql.includes('FROM price_change_requests')) return [[{id:4,status:2,product_id:7,product_code:'SYN-7',product_name:'合成',price_type:'a',new_price:'2.3456',approval_id:31,applicant_id:5,applicant_name:'合成申请人',reason:'调整报价'}]]
    if(sql.includes('AS current_price')) return [[{current_price:'1.2345'}]]
    if(sql.includes('INSERT INTO product_price_history')) { f.queries.push({sql,params});return [{insertId:61}] }
    return query(sql,params)
  }
  const svc=loadService('backend/src/modules/price-change/price-change.service.js',{
    '../../config/db':{pool:f.pool},
    '../../utils/statusTransition':{lockStatusRow:async()=>({id:4,status:1,applicant_id:5}),compareAndSetStatus:async()=>{}},
    '../../engine/approvalEngine':{getActiveInstanceByBiz:async()=>({instance:{id:31,applicant_id:5}}),approveStep:async()=>({status:2})},
    '../../utils/selfApprove':{assertNotSelfApproval:async()=>{}},
  })
  await svc.approve(4,{userId:6,realName:'合成批准人'})
  const history=f.queries.find(q=>q.sql.includes('INSERT INTO product_price_history'))
  assert.equal(history.params[7],6)
  assert.equal(history.params[8],'合成批准人')
  const event=f.queries.find(q=>q.sql.includes('INSERT INTO document_operation_events'))
  assert.ok(event,'approval must retain actor roles and history references atomically')
  const payload=JSON.parse(event.params.find(p=>typeof p==='string'&&p.startsWith('{')))
  assert.equal(payload.actors.applicant.id,5);assert.equal(payload.actors.approver.id,6)
  assert.equal(payload.kind,'price_history_refs');assert.equal(payload.rows.length,0)
})

test('当前单据授权不泄露历史撤销仓的整条事件或未白名单字段', async () => {
  const payload={version:1,kind:'line_changes',quantityScale:2,priceScale:4,reason:'调整仓库',actors:{operator:{id:6,name:'合成操作人',role:'operator'}},rows:[{key:'product:7:1',action:'changed',before:{kind:'physical',warehouseId:1,productId:7,productName:'WITHDRAWN-SCOPE',quantity:'1.20',unitPrice:'1.2345',components:[]},after:{kind:'physical',warehouseId:2,productId:7,quantity:'1.20',unitPrice:'1.2345',components:[]}}],context:{phase:'draft_edit',unsafe:'DO-NOT-EXPOSE'}}
  const pool={query:async sql=>sql.includes('FROM document_operation_events') ? [[{id:8,title:'编辑订单',payload_version:1,payload_json:JSON.stringify(payload),createdAt:'2026-10-10'}]] : [[]]}
  const svc=loadService('backend/src/modules/document-activity/document-activity.service.js',{'../../config/db':{pool},'./document-registry':{loadDocument:async()=>({timeline:[],tasks:[]})},'./document-progress':{buildProgress:async()=>({sections:[],events:[]})},'../fulfillment/fulfillment.service':{events:async()=>[]}})
  const answer=await svc.getActivity('sale',3,{warehouseIds:[2]})
  assert.equal(JSON.stringify(answer).includes('WITHDRAWN-SCOPE'),false)
  assert.equal(JSON.stringify(answer).includes('DO-NOT-EXPOSE'),false)
  assert.equal(answer.events.length,0)
})

test('辅助单位四位微改保留八位基本保存价，不能被展示舍入吞掉', () => {
  const f=fixture(),audit=loadService('backend/src/modules/document-activity/document-change-audit.js',{'../../config/db':{pool:f.pool}})
  const old={id:10,product_id:7,warehouse_id:1,quantity:'5.00',unit:'件',entry_unit:'箱',entry_qty:'1.00',conversion_rate:'5',unit_price:'20.00002000',amount:'100.00'}
  const next={...old,id:11,unit_price:'20.00004000'}
  const diff=audit.lineDiff([old],[next])
  assert.equal(diff.length,1)
  assert.equal(diff[0].before.entryUnitPrice,'100.0001')
  assert.equal(diff[0].after.entryUnitPrice,'100.0002')
  assert.equal(diff[0].before.baseUnitPriceExact,'20.00002000')
  assert.equal(diff[0].after.baseUnitPriceExact,'20.00004000')
})


test('业务审计已处理或回放时只保留技术日志；守卫反向破坏必失败', async () => {
  async function run(transform) {
    const queries=[]
    const conn={beginTransaction:async()=>{},query:async (sql,params)=>{queries.push(sql);if(sql.includes('UPDATE operation_logs')){assert.match(sql,/document_change_handled=\?/);assert.equal(params[3],1)}return [{affectedRows:1}]},commit:async()=>{},rollback:async()=>{},release:()=>{}}
    const pool={query:async sql=>{queries.push(sql);return [{insertId:31}]},getConnection:async()=>conn}
    const middleware=loadService('backend/src/middleware/opLogger.js',{'../../config/db':{pool},'../utils/logger':{error:()=>{}}},transform)
    const req={method:'PUT',originalUrl:'/api/sale/3',path:'/api/sale/3',user:{userId:6,realName:'合成操作人'},body:{changeReason:'调整数量'}}
    let delivered
    const res={statusCode:200,json:body=>{delivered=body}}
    await new Promise((resolve,reject)=>middleware(req,res,error=>error ? reject(error) : resolve()))
    assert.equal(req.operationLogId,31)
    req.documentChangeHandled=true
    const response={success:true,data:{id:3},message:'更新成功'}
    res.json(response)
    await new Promise(resolve=>setImmediate(resolve))
    assert.equal(delivered,response,'original response object must remain unchanged')
    assert.equal(queries.filter(sql=>sql.includes('INSERT INTO operation_logs')).length,1)
    assert.equal(queries.filter(sql=>sql.includes('UPDATE operation_logs')).length,1)
    return queries.filter(sql=>sql.includes('INSERT INTO document_operation_events')).length
  }
  assert.equal(await run(),0)
  const broken=await run((source,filename)=>filename.endsWith('/opLogger.js') ? source.replace('operation && req.documentChangeHandled !== true','operation') : source)
  assert.throws(()=>assert.equal(broken,0),assert.AssertionError,'removing handled guard must violate this regression')
})

test('销售损坏或未来版本差异不退回可能越界的旧摘要', async () => {
  const bad={version:1,kind:'line_changes',quantityScale:2,priceScale:4,rows:[{key:'broken',action:'changed',before:{kind:'physical',warehouseId:1,components:[null]},after:null}]}
  const pool={query:async sql=>sql.includes('FROM document_operation_events') ? [[{id:8,title:'编辑订单',description:'原摘要',payload_version:1,payload_json:JSON.stringify(bad),createdAt:'2026-10-10'}]] : [[]]}
  const svc=loadService('backend/src/modules/document-activity/document-activity.service.js',{'../../config/db':{pool},'./document-registry':{loadDocument:async()=>({timeline:[],tasks:[]})},'./document-progress':{buildProgress:async()=>({sections:[],events:[]})},'../fulfillment/fulfillment.service':{events:async()=>[]}})
  const answer=await svc.getActivity('sale',3,{warehouseIds:[1]})
  assert.equal(answer.events.length,0)
})

test('历史任务按实际来源批量授权，正文、摘要、关联业务事件一并受保护', async () => {
  const payload = context => ({version:1,kind:'line_changes',quantityScale:2,priceScale:4,rows:[],reason:'PRIVATE',actors:{operator:{id:6,name:'PRIVATE'}},context})
  const saved = (id, context) => ({id,document_type:'sale',document_id:3,title:'历史取消',description:`SUMMARY-${id}`,createdByName:`ACTOR-${id}`,payload_version:1,payload_json:JSON.stringify(payload(context))})
  const queries=[]
  const pool={query:async (sql,params)=>{
    queries.push([sql,params])
    if(sql.includes('FROM sale_order_adjustments')) return [[{id:31,sale_order_id:3,warehouse_task_id:12},{id:32,sale_order_id:99,warehouse_task_id:11}]]
    if(sql.includes('FROM warehouse_tasks')) return [[{id:11,sale_order_id:3,warehouse_id:1},{id:12,sale_order_id:3,warehouse_id:2},{id:13,sale_order_id:99,warehouse_id:1}]]
    if(sql.includes('FROM document_operation_events') && params[0]==='sale') return [[saved(1,{warehouseTaskIds:[11]}),saved(2,{warehouseTaskIds:[12],saleEventId:91}),saved(3,{warehouseTaskIds:[11,12]}),saved(4,{warehouseTaskIds:[999]}),saved(5,{warehouseTaskIds:'12'}),saved(6,{adjustmentId:31}),saved(7,{adjustmentId:32}),saved(8,{warehouseTaskIds:[13]}),saved(9,{warehouseTaskIds:[11],adjustmentId:31}),saved(10,{warehouseTaskIds:[12],saleEventId:'93'})]]
    return [[]]
  }}
  let projectedTasks
  const svc=loadService('backend/src/modules/document-activity/document-activity.service.js',{'../../config/db':{pool},'./document-registry':{loadDocument:async()=>({timeline:[{id:91,title:'旧摘要',description:'B-SUMMARY'},{id:93,title:'旧摘要',description:'B-STRING-SUMMARY'},{id:92,title:'创建订单'}],tasks:[{taskId:11},{taskId:12},{taskId:999}]})},'./document-progress':{buildProgress:async(_type,_id,doc)=>{projectedTasks=doc.tasks;return {sections:[],events:[]}}},'../fulfillment/fulfillment.service':{events:async()=>[]}})
  const result=await svc.getActivity('sale',3,{warehouseIds:[1]})
  assert.deepEqual(Array.from(result.events.filter(e=>String(e.id).startsWith('operation')),e=>e.id),['operation-1'])
  assert.equal(JSON.stringify(result).includes('B-SUMMARY'),false,'隐藏审计不得从旧业务摘要漏回')
  assert.equal(JSON.stringify(result).includes('B-STRING-SUMMARY'),false,'字符串关联ID的旧摘要仍被审计替代，坏正文安全拒绝')
  assert.deepEqual(Array.from(projectedTasks,t=>t.taskId),[11])
  assert.equal(queries.filter(([sql])=>sql.includes('FROM warehouse_tasks')).length,1)
  assert.equal(queries.filter(([sql])=>sql.includes('FROM sale_order_adjustments')).length,1)
  assert.equal(JSON.stringify(result).includes('_scope'),false)
  const all=await svc.getActivity('sale',3,{warehouseIds:null})
  assert.deepEqual(Array.from(all.events.filter(e=>String(e.id).startsWith('operation')),e=>e.id).sort(),['operation-1','operation-2','operation-3','operation-6'].sort(),'管理员可读真实同单任务；缺失、错单和矛盾关联仍安全拒绝')
})

test('主档价格历史只记录数据库最终四位值，舍入无变化不造历史', async () => {
  const f=fixture(),query=f.conn.query.bind(f.conn)
  const old={id:7,code:'SYN-7',name:'合成商品',cost_price:'10.0000',sale_price:'1.2345',sale_price_a:'1.2345',sale_price_b:'2.0000',sale_price_c:'3.0000',sale_price_d:'4.0000',allow_decimal_qty:1,revision:1}
  let history=[]
  f.conn.query=async (sql,params)=>{
    if(sql.includes('FROM product_categories')) return [[{id:1}]]
    if(sql.includes('FROM product_items') && sql.includes('FOR UPDATE')) return [[old]]
    if(sql.startsWith('SELECT cost_price,sale_price_a')) return [[old]]
    if(sql.includes('INSERT INTO product_price_history')) { history=params[0];f.queries.push({sql,params});return [{insertId:61}] }
    if(sql.includes('SELECT id,price_type FROM product_price_history')) return [history.map((row,i)=>({id:61+i*2,price_type:row[3]}))]
    return query(sql,params)
  }
  f.pool.query=f.conn.query.bind(f.conn)
  const svc=loadService('backend/src/modules/products/products.service.js',{'../../config/db':{pool:f.pool},'../../utils/priceLevels':{loadPriceRates:async()=>({}),computeTierPrices:()=>({})}})
  await svc.update(7,{name:'合成商品',categoryId:1,unit:'件',costPrice:10,salePriceA:1.23451,salePriceB:2,salePriceC:3,salePriceD:4,revision:1},{userId:6,realName:'合成操作人'})
  assert.equal(history.length,0,'input rounding that leaves persisted price unchanged must not create effective history')
  assert.equal(f.saved.length,0)
})
test('审计公开叶子坏形状整条拒绝，正常小数字符串、空值与数组保留',async()=>{
  const shape=require('../backend/src/modules/document-activity/document-history-scope')
  const base={version:1,kind:'line_changes',quantityScale:2,priceScale:4,reason:null,actors:{operator:{id:6,name:'合成人员'}},context:{warehouseTaskIds:[11],priceHistoryIds:[]},rows:[{key:'x',action:'added',before:null,after:{kind:'physical',warehouseId:1,quantity:'1.25',unitPrice:'2.0001',components:[]}}]}
  assert.equal(shape.isKnownChangePayload(base),true)
  const mutations=[p=>p.actors.operator.name={requestFingerprint:'PRIVATE'},p=>p.context.phase={token:'PRIVATE'},p=>p.context.adjustmentNo=['PRIVATE'],p=>p.rows[0].after.productName={token:'PRIVATE'},p=>p.rows[0].after.components=[{productName:{token:'PRIVATE'}}],p=>p.context.priceHistoryIds=[{token:'PRIVATE'}]]
  for(const mutate of mutations){const bad=structuredClone(base);mutate(bad);assert.equal(shape.isKnownChangePayload(bad),false)}
  assert.equal(shape.rowsInScope(base,[1]),true)
  for(const warehouseId of [true,'1e0','01','1.0',null,undefined]) {
    const bad=structuredClone(base);bad.rows[0].after.warehouseId=warehouseId
    assert.equal(shape.rowsInScope(bad,[1]),false);assert.equal(shape.rowsInScope(bad,null),false)
  }
})
test('销售正文自称版本但数据库标记缺失不能回退摘要，真正旧NULL记录保留',async()=>{
  const marked={version:1,kind:'line_changes',quantityScale:2,priceScale:4,rows:[{key:'x',action:'changed',before:{kind:'physical',warehouseId:2,components:[]},after:{kind:'physical',warehouseId:1,components:[]}}],context:{phase:'draft_edit'}}
  const saved=[{id:1,payload_version:null,payload_json:JSON.stringify(marked),description:'PRIVATE-B-SUMMARY',createdByName:'PRIVATE-B-ACTOR'}, {id:2,payload_version:null,payload_json:JSON.stringify({warehouseTaskIds:[11]}),description:'LEGACY-ALLOWED'}, {id:3,payload_version:null,payload_json:JSON.stringify({...marked,version:2}),description:'PRIVATE-FUTURE-SUMMARY'}]
  const pool={query:async sql=>sql.includes('FROM document_operation_events') ? [saved] : sql.includes('FROM warehouse_tasks') ? [[{id:11,sale_order_id:3,warehouse_id:1}]] : [[]]}
  const svc=loadService('backend/src/modules/document-activity/document-activity.service.js',{'../../config/db':{pool},'./document-registry':{loadDocument:async()=>({timeline:[],tasks:[]})},'./document-progress':{buildProgress:async()=>({sections:[],events:[]})},'../fulfillment/fulfillment.service':{events:async()=>[]}})
  const answer=JSON.stringify(await svc.getActivity('sale',3,{warehouseIds:[1]}))
  assert.doesNotMatch(answer,/PRIVATE/);assert.match(answer,/LEGACY-ALLOWED/)
})


test('保留商业行减少辅助单位数量，当前换算量和原录入依据分开',()=>{
  const f=fixture(),audit=loadService('backend/src/modules/document-activity/document-change-audit.js',{'../../config/db':{pool:f.pool}})
  const old={lineKey:'ordinary-1',kind:'ordinary',targetQty:10,unitPrice:10,metadata:{entry:{entryUnit:'箱',entryQty:1,conversionRate:10,entryUnitPrice:100}},components:[{productId:7,unit:'件',baseQty:1,referencePrice:10,allocatedAmount:100}]}
  const next={...old,targetQty:5}
  const diff=audit.lineDiff([old],[next])
  assert.equal(diff[0].after.entryQty,'0.50')
  assert.equal(diff[0].after.originalEntryQty,'1.00')
  assert.equal(diff[0].after.entryQtyBasis,'current_conversion')
  const fractional=audit.canonicalLine({...next,targetQty:1,metadata:{entry:{entryUnit:'箱',entryQty:1,conversionRate:3}}})
  assert.equal(fractional.entryQty,null,'inexact two-digit quotient must not become a fictional entry quantity')
})

test('已处理请求日志持久排除旧兼容投影，旧NULL技术日志仍保留',async()=>{
  const payload={version:1,kind:'line_changes',quantityScale:2,priceScale:4,reason:null,rows:[],context:{},actors:{}}
  const pool={query:async sql=>{
    if(sql.includes('FROM document_operation_events')) return [[{id:8,title:'编辑订单',payload_version:1,payload_json:JSON.stringify(payload),createdAt:'2026-10-10'}]]
    if(sql.includes('FROM operation_logs')) return [sql.includes('COALESCE(l.document_change_handled,0)=0') ? [{id:11,method:'PUT',path:'/api/sale/3',status_code:200,user_name:'合成操作人',created_at:'2026-10-09'}] : [{id:9,method:'PUT',path:'/api/sale/3',status_code:200,user_name:'合成操作人',created_at:'2026-10-10'},{id:11,method:'PUT',path:'/api/sale/3',status_code:200,user_name:'合成操作人',created_at:'2026-10-09'}]]
    return [[]]
  }}
  const svc=loadService('backend/src/modules/document-activity/document-activity.service.js',{'../../config/db':{pool},'./document-registry':{loadDocument:async()=>({timeline:[],tasks:[]})},'./document-progress':{buildProgress:async()=>({sections:[],events:[]})},'../fulfillment/fulfillment.service':{events:async()=>[]}})
  const answer=await svc.getActivity('sale',3,{warehouseIds:[1]})
  assert.equal(answer.events.filter(e=>e.title==='修改单据').length,1,'only old unknown record stays visible')
})

test('坏价格引用v1在enrich与去重前降级，不把不明JSON发给客户端',async()=>{
  for(const bad of [{version:1,kind:'price_history_refs',quantityScale:2,priceScale:4,context:{priceHistoryIds:'bad'},rows:[]},{version:1,kind:'price_history_refs',quantityScale:2,priceScale:4,context:{priceHistoryIds:[]},rows:{bad:true}}]) {
    const pool={query:async sql=>sql.includes('FROM document_operation_events') ? [[{id:8,title:'修改价格',description:'原摘要',payload_version:1,payload_json:JSON.stringify(bad),createdAt:'2026-10-10'}]] : [[]]}
    const svc=loadService('backend/src/modules/document-activity/document-activity.service.js',{'../../config/db':{pool},'./document-registry':{loadDocument:async()=>({timeline:[],tasks:[]})},'./document-progress':{buildProgress:async()=>({sections:[],events:[]})},'../fulfillment/fulfillment.service':{events:async()=>[]}})
    const answer=await svc.getActivity('product',7,{})
    assert.equal(answer.events[0].description,'原摘要');assert.equal(answer.events[0].payload,null)
  }
})


test('新请求键预查空集不加范围锁，避免独立单据在同索引间隙互阻',async()=>{
  const queries=[]
  const conn={query:async sql=>{queries.push(sql);return [[]]}}
  const audit=loadService('backend/src/modules/document-activity/document-change-audit.js',{'../../config/db':{pool:{}}})
  await audit.assertChangeRequest(conn,{requestKey:'brand-new-key',action:'sale.adjust.3',userId:6,payload:{quantity:2}})
  assert.equal(queries.length,1)
  assert.doesNotMatch(queries[0],/FOR\s+(?:SHARE|UPDATE)/i,'initial empty-range lookup must be nonlocking')
})

test('预查快照未见回执而begin迟到重复时，回放前按实际ID当前读拒异体',async()=>{
  const f=fixture(),query=f.conn.query.bind(f.conn)
  f.conn.query=async (sql,params)=>{
    if(sql.includes('FROM operation_requests') && sql.includes('WHERE id=')) return [[{id:99,request_fingerprint:'different-body'}]]
    return query(sql,params)
  }
  const svc=loadService('backend/src/modules/price-lists/price-lists.service.js',{'../../config/db':{pool:f.pool},'../../utils/operationRequest':{beginOperationRequest:async()=>({enabled:true,id:99,replay:true,responseData:null}),completeOperationRequest:async()=>{},creationFingerprint:()=> 'incoming-body'}})
  await assert.rejects(svc.updateItems(3,[{productId:7,salePrice:2}],{operator:{userId:6},requestKey:'late-key'}),error=>error.code==='CHANGE_REQUEST_CONFLICT')
})


test('实际回执主键校验保留新绑定、同体重放及旧NULL兼容，不在回放升级写锁',async()=>{
  const audit=loadService('backend/src/modules/document-activity/document-change-audit.js',{'../../config/db':{pool:{}}})
  for(const c of [{replay:false,stored:null,updates:1},{replay:true,stored:'same-body',updates:0},{replay:true,stored:null,updates:0}]) {
    const queries=[]
    const conn={query:async (sql,params)=>{queries.push({sql,params});if(sql.includes('FROM operation_requests'))return [[{id:21,request_fingerprint:c.stored}]];if(sql.includes('FROM document_operation_events'))return [[]];return [{affectedRows:1}]}}
    await audit.bindChangeRequest(conn,{enabled:true,id:21,replay:c.replay},'same-body')
    assert.match(queries[0].sql,/WHERE id=\? FOR SHARE$/)
    assert.deepEqual(Array.from(queries[0].params),[21])
    assert.equal(queries.filter(q=>q.sql.startsWith('UPDATE operation_requests')).length,c.updates)
  }
})


test('价格历史超过旧100分块边界仍只批读一次，保留全部记录与商品归属',async()=>{
  const history=Array.from({length:255},(_,index)=>({id:index+1,product_id:index===254 ? 8 : 7,product_code:'SYN-7',product_name:'合成商品',price_type:'a',old_price:'1.2345',new_price:'1.2346',created_at:'2026-10-10'}))
  const saved=Array.from({length:51},(_,index)=>({id:index+1,title:'修改商品价格',description:'变更5项价格',createdAt:'2026-10-10',payload_version:1,payload_json:JSON.stringify({version:1,kind:'price_history_refs',quantityScale:2,priceScale:4,reason:'合成理由',actors:{operator:{id:6,name:'合成操作人',role:'operator'}},rows:[],context:{productId:7,priceHistoryIds:Array.from({length:5},(_,n)=>index*5+n+1),unsafe:'DO-NOT-EXPOSE'}})}))
  const batches=[]
  const pool={query:async (sql,params)=>{
    if(sql.includes('FROM document_operation_events')) return [saved]
    if(sql.includes('FROM product_price_history') && sql.includes('id IN (?)')) {batches.push(params[0]);return [history.filter(row=>params[0].includes(row.id))]}
    if(sql.includes('FROM product_price_history'))return [history.filter(row=>row.product_id===7)]
    return [[]]
  }}
  const svc=loadService('backend/src/modules/document-activity/document-activity.service.js',{'../../config/db':{pool},'./document-registry':{loadDocument:async()=>({timeline:[],tasks:[]})},'./document-progress':{buildProgress:async()=>({sections:[],events:[]})}})
  const answer=await svc.getActivity('product',7,{})
  assert.equal(batches.length,1,'all history references must use one batched read, not query count proportional to history size')
  assert.equal(new Set(batches[0]).size,255)
  const events=answer.events.filter(event=>event.payload?.kind==='price_history_refs')
  assert.equal(events.length,51)
  assert.equal(events.reduce((sum,event)=>sum+event.payload.rows.length,0),254)
  assert.equal(events.flatMap(event=>event.payload.rows).some(row=>row.before.priceHistoryId===255),false,'another product history must not be attached')
  assert.equal(answer.events.some(event=>event.id.startsWith('price-history-')),false,'linked authority history must not be shown twice')
  assert.equal(JSON.stringify(answer).includes('DO-NOT-EXPOSE'),false)
})

test('无价格引用集合不发空IN查询，旧摘要仍可读',async()=>{
  let batchCount=0
  const pool={query:async sql=>{if(sql.includes('id IN (?)'))batchCount++;return [sql.includes('FROM document_operation_events') ? [{id:1,title:'旧摘要',description:'历史记录',createdAt:'2026-10-10'}] : []]}}
  const svc=loadService('backend/src/modules/document-activity/document-activity.service.js',{'../../config/db':{pool},'./document-registry':{loadDocument:async()=>({timeline:[],tasks:[]})},'./document-progress':{buildProgress:async()=>({sections:[],events:[]})}})
  const answer=await svc.getActivity('product',7,{})
  assert.equal(batchCount,0);assert.equal(answer.events[0].description,'历史记录')
})
