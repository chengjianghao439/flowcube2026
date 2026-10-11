'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

// Synthetic HTTP probes only; caller's fixture proves live owned-instance identity before seed writes.
async function runActivityScopeCases(c, test) {
  const product = await c.product('ACTIVITYSCOPE')
  const body = { customerId:c.customer.id,customerName:c.customer.name,warehouseId:c.a.id,warehouseName:c.a.name,
    items:[{productId:product.id,productCode:product.code,productName:product.name,unit:product.unit,quantity:1,unitPrice:20.0001,priceSource:'manual'}] }
  const sale = await c.ok('POST','/sale',body), other = await c.ok('POST','/sale',body)
  const task = (wh,tag,saleId=sale.id) => c.insert('INSERT INTO warehouse_tasks(task_no,sale_order_id,sale_order_no,customer_id,customer_name,warehouse_id,warehouse_name,status) VALUES (?,?,?,?,?,?,?,8)',[c.mark+tag,saleId,c.mark,c.customer.id,c.customer.name,wh.id,wh.name])
  const a = await task(c.a,'-A'), b = await task(c.b,'-B'), deleted = await task(c.a,'-DELETED'), wrong = await task(c.a,'-WRONG',other.id)
  await c.pool.query('UPDATE warehouse_tasks SET deleted_at=NOW() WHERE id=?',[deleted])
  const adjustment = (saleId,taskId,tag) => c.insert('INSERT INTO sale_order_adjustments(sale_order_id,warehouse_task_id,adjustment_no,status,requested_by,requested_by_name) VALUES (?,?,?,2,?,?)',[saleId,taskId,c.mark+tag,c.userId,c.mark])
  const aa = await adjustment(sale.id,a,'-AA'), ab = await adjustment(sale.id,b,'-AB'), aw = await adjustment(other.id,wrong,'-AW')
  const wrongParent = await adjustment(other.id,a,'-WRONG-PARENT')
  const marks = {}
  async function audit(tag, context, version=1, raw=null) {
    const marker = `${c.mark}-PRIVATE-${tag}`; marks[tag] = marker
    const payload = {version:1,kind:'line_changes',quantityScale:2,priceScale:4,reason:marker,actors:{operator:{id:c.userId,name:marker}},rows:[],context}
    await c.insert("INSERT INTO document_operation_events(document_type,document_id,title,description,created_by,created_by_name,payload_version,payload_json) VALUES ('sale',?,'历史交接',?,?,?, ?,?)",[sale.id,marker,c.userId,marker,version,raw || JSON.stringify(payload)])
  }
  await audit('A',{phase:'cancellation_requested',warehouseTaskIds:[a]})
  const linked = await c.insert("INSERT INTO sale_order_events(sale_order_id,event_type,title,description,created_by,created_by_name) VALUES (?,'cancelled','原取消摘要',?,?,?)",[sale.id,c.mark+'-LINKED-B',c.userId,c.mark+'-LINKED-B'])
  await audit('B',{phase:'cancellation_requested',warehouseTaskIds:[b],saleEventId:linked})
  await audit('MIX',{phase:'cancellation_requested',warehouseTaskIds:[a,b]})
  await audit('MISSING',{warehouseTaskIds:[999999999]})
  await audit('DELETED',{warehouseTaskIds:[deleted]})
  await audit('WRONG',{warehouseTaskIds:[wrong]})
  await audit('BADIDS',{warehouseTaskIds:String(b)})
  await audit('ADJ-A',{phase:'execution_adjustment',adjustmentId:aa})
  await audit('ADJ-B',{phase:'execution_adjustment',adjustmentId:ab})
  await audit('ADJ-WRONG',{adjustmentId:aw})
  await audit('CONTRADICT',{warehouseTaskId:a,adjustmentId:ab})
  await audit('UNKNOWN',{warehouseTaskIds:[b]},2)
  await audit('BADBODY',{},1,JSON.stringify({version:1,context:{warehouseTaskIds:[b]},reason:c.mark+'-PRIVATE-BADBODY'}))
  // JSON column accepts JSON strings; this deliberately has no interpretable task association.
  await audit('JSONSTRING',{},1,JSON.stringify('not an object'))
  const stringLinked = await c.insert("INSERT INTO sale_order_events(sale_order_id,event_type,title,description,created_by,created_by_name) VALUES (?,'cancelled','字符串关联摘要',?,?,?)",[sale.id,c.mark+'-STRING-LINKED-B',c.userId,c.mark+'-STRING-LINKED-B'])
  await audit('STRING-LINK',{warehouseTaskIds:[b],saleEventId:String(stringLinked)})
  await audit('ROW-BEFORE-B',{phase:'cancellation_requested',warehouseTaskIds:[a]},1,JSON.stringify({version:1,kind:'line_changes',quantityScale:2,priceScale:4,reason:c.mark+'-PRIVATE-ROW-BEFORE-B',actors:{operator:{id:c.userId,name:c.mark}},context:{phase:'cancellation_requested',warehouseTaskIds:[a]},rows:[{key:'x',action:'changed',before:{kind:'physical',warehouseId:c.b.id,components:[],quantity:'1.00'},after:{kind:'physical',warehouseId:c.a.id,components:[],quantity:'1.00'}}]}))
  await audit('BAD-LEAF',{},1,JSON.stringify({version:1,kind:'line_changes',quantityScale:2,priceScale:4,reason:c.mark+'-PRIVATE-BAD-LEAF',actors:{operator:{id:c.userId,name:{requestFingerprint:c.mark+'-PRIVATE-BAD-LEAF'}}},context:{warehouseTaskIds:[a]},rows:[]}))
  await audit('VERSION-NULL',{phase:'draft_edit'},null,JSON.stringify({version:1,kind:'line_changes',quantityScale:2,priceScale:4,reason:c.mark+'-PRIVATE-VERSION-NULL',actors:{operator:{id:c.userId,name:c.mark+'-PRIVATE-VERSION-NULL'}},context:{phase:'draft_edit'},rows:[{key:'x',action:'changed',before:{kind:'physical',warehouseId:c.b.id,components:[]},after:{kind:'physical',warehouseId:c.a.id,components:[]}}]}))
  await audit('LEGACY-NULL',{},null,JSON.stringify({warehouseTaskIds:[a]}))
  await audit('BAD-WARE-ID',{},1,JSON.stringify({version:1,kind:'line_changes',quantityScale:2,priceScale:4,reason:c.mark+'-PRIVATE-BAD-WARE-ID',actors:{operator:{id:c.userId,name:c.mark}},context:{warehouseTaskIds:[a]},rows:[{key:'x',action:'added',before:null,after:{kind:'physical',warehouseId:String(c.a.id)+'e0',components:[]}}]}))
  const wave = await c.insert('INSERT INTO picking_waves(wave_no,warehouse_id,status,task_count) VALUES (?,?,4,2)',[c.mark+'-W',c.a.id])
  await c.pool.query('INSERT INTO picking_wave_tasks(wave_id,task_id,sale_order_id,sale_order_no,customer_name) VALUES ?',[ [[wave,a,sale.id,c.mark+'-WAVE-A',c.mark+'-CUSTOMER-A'],[wave,b,sale.id,c.mark+'-WAVE-B',c.mark+'-CUSTOMER-B']] ])
  for (const [taskId,tag] of [[a,'A'],[b,'B'],[deleted,'DELETED']]) {
    await c.pool.query("INSERT INTO warehouse_task_events(task_id,task_no,event_type,operator_id,operator_name) VALUES (?,?,'CANCEL_REQUESTED',?,?)",[taskId,c.mark+'-TASK-'+tag,c.userId,c.mark+'-TASKACTOR-'+tag])
    await c.pool.query("INSERT INTO document_operation_events(document_type,document_id,title,description,created_by,created_by_name) VALUES ('warehouse-task',?,'仓库旧摘要',?,?,?)",[taskId,c.mark+'-RELATED-'+tag,c.userId,c.mark+'-RELATED-'+tag])
  }
  await c.pool.query("INSERT INTO sale_order_events(sale_order_id,event_type,title,description,payload_json,created_by,created_by_name) VALUES (?,'ship_requested','历史发起出库',?,?,?,?)",[sale.id,c.mark+'-BUSINESS-B',JSON.stringify({tasks:[{taskId:b}]}),c.userId,c.mark+'-BUSINESS-B'])
  const P=c.req('backend/src/constants/permissions').PERMISSIONS, role=await c.insert('INSERT INTO sys_roles(code,name) VALUES (?,?)',[c.mark+'-scope',c.mark+'-scope'])
  await c.pool.query('INSERT INTO sys_role_permissions(role_id,permission) VALUES ?',[ [P.SALE_ORDER_VIEW,P.WAREHOUSE_TASK_VIEW,P.WAREHOUSE_TASK_CANCEL_RETURN_VIEW,P.WAREHOUSE_TASK_ADJUST_VIEW,P.PICKING_WAVE_VIEW].map(p=>[role,p]) ])
  const password=crypto.randomBytes(24).toString('hex'), username=c.mark+'-scope'
  const readerId=await c.insert('INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active) VALUES (?,?,?,?,?,1)',[username,await c.req('backend/node_modules/bcryptjs').hash(password,10),username,role,username])
  await c.pool.query('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES (?,?)',[readerId,c.a.id])
  const auth=await c.ok('POST','/auth/login',{username,password}), headers={Authorization:'Bearer '+auth.token}
  const activity=()=>c.ok('GET',`/document-activity/sale/${sale.id}`,undefined,{headers})
  await test('历史活动整条范围：A可见、B正文人员摘要和仓库事件均隐藏',async()=>{
    const result=await activity(), text=JSON.stringify(result)
    assert.ok(text.includes(marks.A));assert.ok(text.includes(marks['ADJ-A']))
    assert.ok(text.includes(c.mark+'-RELATED-A'));assert.ok(text.includes(c.mark+'-TASKACTOR-A'))
    for(const tag of ['B','MIX','MISSING','DELETED','WRONG','BADIDS','ADJ-B','ADJ-WRONG','CONTRADICT','UNKNOWN','BADBODY','JSONSTRING','STRING-LINK','ROW-BEFORE-B','BAD-LEAF','VERSION-NULL','BAD-WARE-ID']) assert.ok(!text.includes(marks[tag]),tag)
    assert.ok(text.includes(marks['LEGACY-NULL']))
    for(const suffix of ['-RELATED-B','-RELATED-DELETED','-TASKACTOR-B','-TASKACTOR-DELETED','-BUSINESS-B','-LINKED-B','-STRING-LINKED-B','-WRONG-PARENT']) assert.ok(!text.includes(c.mark+suffix),suffix)
    assert.ok(!text.includes('_scope'));assert.ok(!text.includes('activityAuditIds'))
    return {saleId:sale.id,taskA:a,taskB:b,wholeEventChecks:18,allowedHistoryPreserved:true}
  })
  await test('历史交接混合范围：整段共享原因不从交接表回流，同仓确认仍保留',async()=>{
    const result=await activity(), rows=result.sections.filter(s=>s.title==='仓库交接').flatMap(s=>s.rows), text=JSON.stringify(rows)
    assert.ok(text.includes(marks.A));assert.ok(text.includes(marks['ADJ-A']));assert.ok(!text.includes(marks.MIX));assert.ok(!text.includes(marks.B))
    return {sameWarehouseRows:rows.length,mixedWholeReasonSuppressed:true}
  })
  await test('历史活动管理员：有效A/B与混合历史保留，缺失错单坏正文仍拒绝',async()=>{
    const result=await c.ok('GET',`/document-activity/sale/${sale.id}`), text=JSON.stringify(result)
    for(const tag of ['A','B','MIX','ADJ-A','ADJ-B']) assert.ok(text.includes(marks[tag]),tag)
    for(const tag of ['MISSING','DELETED','WRONG','BADIDS','ADJ-WRONG','CONTRADICT','UNKNOWN','BADBODY','JSONSTRING','STRING-LINK','BAD-LEAF','VERSION-NULL','BAD-WARE-ID']) assert.ok(!text.includes(marks[tag]),tag)
    return {validMixedHistoryVisible:true,invalidAssociationsSuppressed:true}
  })
  await test('波次历史摘要与直接取消详情：混合原因和跨仓前值不能绕过整条授权',async()=>{
    const result=await c.ok('GET',`/document-activity/wave/${wave}`,undefined,{headers}), text=JSON.stringify(result)
    for(const tag of ['MIX','B','ROW-BEFORE-B','BAD-LEAF']) assert.ok(!text.includes(marks[tag]),tag)
    assert.ok(text.includes(c.mark+'-WAVE-A'));assert.ok(!text.includes(c.mark+'-WAVE-B'));assert.ok(!text.includes(c.mark+'-CUSTOMER-B'))
    assert.equal(result.sections.find(s=>s.title==='批次概况').rows[0].taskCount,1)
    const direct=await c.ok('GET',`/warehouse-tasks/${a}/cancel-return-detail`,undefined,{headers})
    assert.ok(!JSON.stringify(direct).includes(marks['ROW-BEFORE-B']));assert.ok(!JSON.stringify(direct).includes(marks.MIX))
    const admin=await c.ok('GET',`/document-activity/wave/${wave}`);assert.ok(JSON.stringify(admin).includes(marks['ROW-BEFORE-B']))
    return {visibleWaveTaskCount:1,mixedReasonSuppressed:true,beforeWarehouseScopeRechecked:true}
  })
  await test('直接改单详情：错销售父关联先拒绝，同仓合法关联仍可查',async()=>{
    const denied=await c.request('GET',`/warehouse-tasks/adjustments/${wrongParent}`,undefined,{headers});assert.equal(denied.status,409)
    assert.equal(denied.data.code,'WAREHOUSE_TASK_HISTORY_INVALID')
    assert.ok(!JSON.stringify(denied.data).includes(c.mark+'-WRONG-PARENT'))
    const same=await c.ok('GET',`/warehouse-tasks/adjustments/${aa}`,undefined,{headers});assert.equal(same.id,aa)
    return {wrongParentStatus:409,validSameWarehouseDetail:true}
  })
  await test('历史任务实际归属：跨仓往返按本次当前任务仓授权',async()=>{
    await c.pool.query('UPDATE warehouse_tasks SET warehouse_id=? WHERE id=?',[c.a.id,b])
    try {const current=JSON.stringify(await activity());assert.ok(current.includes(marks.B));assert.ok(current.includes(marks.MIX))}
    finally {await c.pool.query('UPDATE warehouse_tasks SET warehouse_id=? WHERE id=?',[c.b.id,b])}
    assert.ok(!JSON.stringify(await activity()).includes(marks.B));return {currentTaskScopeRechecked:true}
  })
  await test('历史活动权限：当前撤仓与撤查看权立即拒绝，空范围不读正文',async()=>{
    await c.pool.query('UPDATE user_warehouse_scope SET warehouse_id=? WHERE user_id=?',[c.b.id,readerId])
    try {const denied=await c.request('GET',`/document-activity/sale/${sale.id}`,undefined,{headers});assert.equal(denied.status,403);assert.ok(!JSON.stringify(denied.data).includes(marks.B))}
    finally {await c.pool.query('UPDATE user_warehouse_scope SET warehouse_id=? WHERE user_id=?',[c.a.id,readerId])}
    await c.pool.query('DELETE FROM sys_role_permissions WHERE role_id=? AND permission=?',[role,P.SALE_ORDER_VIEW])
    try {assert.equal((await c.request('GET',`/document-activity/sale/${sale.id}`,undefined,{headers})).status,403)}
    finally {await c.pool.query('INSERT INTO sys_role_permissions(role_id,permission) VALUES (?,?)',[role,P.SALE_ORDER_VIEW])}
    await assert.rejects(c.req('backend/src/modules/document-activity/document-activity.service').getActivity('sale',sale.id,{warehouseIds:[]}),error=>error.code==='WAREHOUSE_SCOPE_DENIED')
    return {scopeRevocation403:true,viewRevocation403:true,emptyScope403:true}
  })
  await test('历史活动边界：任务详情403、PDA不带价、当前销售详情与真实Excel保持',async()=>{
    const denied=await c.request('GET',`/warehouse-tasks/${b}/cancel-return-detail`,undefined,{headers});assert.equal(denied.status,403)
    const same=await c.ok('GET',`/warehouse-tasks/${a}/cancel-return-detail`,undefined,{headers:c.a.headers})
    assert.ok(!/"(?:unitPrice|amount|cost|margin|requestFingerprint)"/.test(JSON.stringify(same)))
    const detail=await c.ok('GET',`/sale/${sale.id}`,undefined,{headers});assert.ok(detail.items.length);assert.ok(!JSON.stringify(detail).includes(marks.B))
    const response=await fetch(`http://127.0.0.1:${c.server.address().port}/api/export/sale?keyword=${encodeURIComponent(detail.orderNo)}`,{headers})
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/spreadsheetml/)
    const book=new (c.req('backend/node_modules/exceljs').Workbook)();await book.xlsx.load(Buffer.from(await response.arrayBuffer()))
    const rows=[];book.eachSheet(sheet=>sheet.eachRow(row=>rows.push(row.values)));assert.ok(rows.length>1);assert.ok(!JSON.stringify(rows).includes(marks.B))
    return {directForbiddenDetail:403,pdaPriceFieldsAbsent:true,currentSaleReadable:true,actualExportRows:rows.length,scope:'新增审计不进入当前详情或现有销售导出；不概括全系统历史字段'}
  })
}
module.exports={runActivityScopeCases}
