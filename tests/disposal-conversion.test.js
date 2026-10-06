'use strict'
// H5: real domain/services; only SQL, stock and generic-receipt boundaries are fixtures.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto')
const AppError = require('../backend/src/utils/AppError')
const identifiers = require('../backend/src/utils/sqlIdentifier')
const base = path.resolve(__dirname, '../backend/src')
function load(file, deps) {
  const module = { exports: {} }, filename = path.join(base, file)
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require(name) {
    if (!Object.hasOwn(deps, name)) throw Error(`Unstubbed require ${file}: ${name}`)
    return deps[name]
  } }, { filename })
  return module.exports
}
const qty = load('utils/qtyPrecision.js', { './AppError': AppError })
const scope = load('utils/warehouseScope.js', { '../config/db': {}, './AppError': AppError })
const rules = load('modules/disposal/disposal.handling.rules.js', { 'node:crypto': crypto, '../../utils/AppError': AppError, '../../utils/qtyPrecision': qty })
const proof = load('modules/disposal/disposal.handling.proof.js', { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, '../../utils/sqlIdentifier': identifiers, './disposal.handling.rules': rules })
const operations = load('modules/disposal/disposal.handling.operations.js', { '../../utils/AppError': AppError, './disposal.handling.rules': rules })
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const clean = value => JSON.parse(JSON.stringify(value))
const method = (value, name) => { assert.equal(typeof value[name], 'function', `H5 ${name} must exist`); return value[name] }
function fixture() {
  const head = { id: 11, disposal_no: 'DP11', warehouse_id: 8, warehouse_name: '原仓八', status: 3, total_value: '98.7654', remark: '原整单', operator_id: 7, operator_name: '原制单', approved_by: 6, approved_by_name: '原批准', approved_at: '2026-10-01T01:02:03.000Z', reject_reason: null, disposed_at: null, created_at: '2026-09-30T00:00:00.000Z', updated_at: '2026-10-01T01:02:03.000Z', deleted_at: null, disposal_handling_link_id: null }
  const items = [51, 43, 47].map((id, index) => ({ id, disposal_id: 11, product_id: index === 2 ? 5 : 3, product_code: index === 2 ? 'OLD5' : 'OLD3', product_name: '原商品', unit: '原个', quantity: index === 2 ? '1.25' : '2.00', unit_value: '1.2345', dispose_type: index + 1, remark: '原行', created_at: '2026-09-30T00:00:00.000Z' }))
  const state = { heads: [head], items, products: [{ id: 3, code: 'NEW3', unit: '新单位', is_active: 0, deleted_at: 'gone' }, { id: 5, is_active: 0, deleted_at: 'gone' }], warehouses: [{ id: 8, code: 'W8', name: '当前仓', is_active: 0, deleted_at: 'gone' }], users: [{ id: 9, real_name: '签认人', role_id: 1, allow_self_approve: 0, deleted_at: null }], operations: [], conversions: [], sources: [], logs: [], scrapped: [] }
  const calls = [], sqls = [], fail = {}, held = new Set(); let tx = null
  const current = () => tx || state
  const project = (rows, sql) => {
    const cols = sql.match(/^SELECT (.+?) FROM /)[1]
    if (cols === '*') return clean(rows)
    const names = cols.split(',').map(s => s.trim())
    assert.ok(names.every(s => /^[a-z_]+$/.test(s)), `unsupported projection ${cols}`)
    return rows.map(row => Object.fromEntries(names.map(n => { assert.ok(Object.hasOwn(row,n), `fixture column ${n}`); return [n,row[n]] })))
  }
  const conn = {
    async beginTransaction() { assert.equal(tx,null); tx=clean(state); calls.push('begin') },
    async commit() { if (tx) { Object.assign(state,tx); tx=null }; calls.push('commit') },
    async rollback() { tx=null; calls.push('rollback') }, release() { calls.push('release') },
    async query(raw, args=[]) {
      const sql=raw.replace(/\s+/g,' ').trim(); sqls.push({sql,args:clean(args)}); const s=current()
      if (sql === 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ') return [[]]
      if (sql === 'START TRANSACTION READ ONLY') { assert.equal(tx,null);tx=clean(state);calls.push('read');return [[]] }
      if (sql === 'SELECT * FROM inventory_disposal_orders WHERE id=?' || sql === 'SELECT * FROM inventory_disposal_orders WHERE id=? FOR UPDATE' || sql === 'SELECT * FROM inventory_disposal_orders WHERE id=? FOR SHARE') {
        if (sql.endsWith('FOR UPDATE')) held.add('head:'+args[0]); return [project(s.heads.filter(r=>r.id===args[0]),sql)]
      }
      if (sql === 'SELECT * FROM inventory_disposal_items WHERE disposal_id=? ORDER BY id' || sql === 'SELECT * FROM inventory_disposal_items WHERE disposal_id=? ORDER BY id FOR UPDATE') return [clean(s.items.filter(r=>r.disposal_id===args[0]).sort((a,b)=>a.id-b.id))]
      if (sql === 'SELECT * FROM inventory_disposal_conversions WHERE original_disposal_id=?' || sql === 'SELECT * FROM inventory_disposal_conversions WHERE original_disposal_id=? FOR SHARE') return [clean(s.conversions.filter(r=>r.original_disposal_id===args[0]))]
      if (sql === 'SELECT * FROM disposal_handling_sources WHERE legacy_disposal_id=? ORDER BY legacy_disposal_item_id') return [clean(s.sources.filter(r=>r.legacy_disposal_id===args[0]).sort((a,b)=>a.legacy_disposal_item_id-b.legacy_disposal_item_id))]
      if (sql === 'SELECT * FROM disposal_handling_sources WHERE legacy_disposal_id=? AND created_operation_uuid=? ORDER BY legacy_disposal_item_id') return [clean(s.sources.filter(r=>r.legacy_disposal_id===args[0]&&r.created_operation_uuid===args[1]).sort((a,b)=>a.legacy_disposal_item_id-b.legacy_disposal_item_id))]
      if (sql === 'SELECT id,allow_self_approve FROM sys_users WHERE id=? FOR SHARE') { const rows=s.users.filter(r=>r.id===args[0]);if(rows.length)held.add('actor:'+args[0]);return [project(rows,sql)] }
      if (sql === 'SELECT id,code FROM inventory_warehouses WHERE id=? FOR SHARE') { const rows=s.warehouses.filter(r=>r.id===args[0]);if(rows.length)held.add('warehouse:'+args[0]);return [project(rows,sql)] }
      if (sql === 'SELECT id FROM product_items WHERE id IN (?) ORDER BY id FOR SHARE') { assert.deepEqual(Array.from(args[0]),[...new Set(args[0])].sort((a,b)=>a-b)); const rows=s.products.filter(r=>args[0].includes(r.id));rows.forEach(r=>held.add('product:'+r.id));return [project(rows,sql)] }
      if (sql === 'SELECT * FROM disposal_handling_operations WHERE operation_uuid=? FOR SHARE' || sql === 'SELECT * FROM disposal_handling_operations WHERE operation_uuid=? AND actor_id=?') return [clean(s.operations.filter(r=>r.operation_uuid===args[0]&&(args.length===1||r.actor_id===args[1])))]
      if (sql === 'SELECT * FROM inventory_logs WHERE (ref_type=? AND ref_id=?) OR (log_source_type=? AND log_source_ref_id=?) OR ref_no=?') { assert.deepEqual(clean(args),['disposal',11,'disposal',11,'DP11']);return [clean(s.logs.filter(r=>r.ref_type===args[0]&&r.ref_id===args[1]||r.log_source_type===args[2]&&r.log_source_ref_id===args[3]||r.ref_no===args[4]))] }
      if (sql === 'SELECT * FROM disposal_scrapped WHERE disposal_id=? OR disposal_no=?') { assert.deepEqual(clean(args),[11,'DP11']);return [clean(s.scrapped.filter(r=>r.disposal_id===args[0]||r.disposal_no===args[1]))] }
      if (sql.startsWith('INSERT INTO disposal_handling_operations ')) {
        assert.equal(sql,'INSERT INTO disposal_handling_operations (operation_uuid,action,actor_id,request_key,intent_uuid,payload_hash,payload_json,status) VALUES (?,?,?,?,?,?,?,?)')
        assert.ok(held.has('actor:'+args[2]),'actor FK S before operation INSERT')
        if(s.operations.some(r=>r.operation_uuid===args[0]))throw Object.assign(Error('duplicate'),{code:'ER_DUP_ENTRY'})
        assert.equal(args.length,8);s.operations.push({operation_uuid:args[0],action:args[1],actor_id:args[2],request_key:args[3],intent_uuid:args[4],payload_hash:args[5],payload_json:args[6],status:args[7],source_id:null,target_type:null,target_id:null,target_line_id:null,legacy_disposal_id:null,resource_type:null,resource_id:null,response_json:null});return [{insertId:201}]
      }
      if (sql.startsWith('INSERT INTO inventory_disposal_conversions ')) {
        assert.ok(held.has('head:'+args[0])&&held.has('actor:'+args[4])); assert.ok(s.operations.some(r=>r.operation_uuid===args[8]))
        if(fail.conversion)throw Error('fixture conversion insert failure')
        if(s.conversions.some(r=>r.original_disposal_id===args[0]))throw Object.assign(Error('duplicate'),{code:'ER_DUP_ENTRY'})
        const cols=sql.match(/\(([^)]+)\) VALUES/)[1].split(',');assert.equal(cols.join(','),'original_disposal_id,original_head_json,original_items_json,approval_snapshot_json,signed_by,signed_by_name,reason,payload_hash,operation_uuid,payload_json,response_json');assert.equal(cols.length,args.length);s.conversions.push({id:81,...Object.fromEntries(cols.map((c,i)=>[c,args[i]]))});return [{insertId:81}]
      }
      if (sql.startsWith('INSERT INTO disposal_handling_sources ')) {
        assert.match(sql,/VALUES \?$/); assert.equal(args.length,1);assert.ok(args[0].length)
        const cols=sql.match(/\(([^)]+)\) VALUES/)[1].split(',');assert.equal(cols.join(','),'intent_uuid,created_operation_uuid,product_id,product_code,product_name,warehouse_id,warehouse_code,warehouse_name,unit,handling_type,quantity,created_by,created_by_name,request_key,payload_hash,payload_json,revision,legacy_disposal_id,legacy_disposal_item_id')
        for(let i=0;i<args[0].length;i++) { const values=args[0][i];assert.equal(cols.length,values.length);const row=Object.fromEntries(cols.map((c,j)=>[c,values[j]]));assert.ok(held.has('actor:'+row.created_by)&&held.has('head:'+row.legacy_disposal_id)&&held.has('warehouse:'+row.warehouse_id)&&held.has('product:'+row.product_id));assert.ok(s.operations.some(r=>r.operation_uuid===row.created_operation_uuid));s.sources.push({id:[301,308,402][i],...row}) }
        if(fail.sources)throw Error('fixture sources insert failure');return [{affectedRows:args[0].length,insertId:999}]
      }
      if (sql === 'UPDATE disposal_handling_sources SET response_json=? WHERE legacy_disposal_id=? AND created_operation_uuid=?') { const rows=s.sources.filter(r=>r.legacy_disposal_id===args[1]&&r.created_operation_uuid===args[2]);rows.forEach(r=>r.response_json=args[0]);return [{affectedRows:fail.sourceReceipt?0:rows.length}] }
      if (sql === 'UPDATE inventory_disposal_conversions SET response_json=? WHERE id=? AND operation_uuid=?') { const row=s.conversions.find(r=>r.id===args[1]&&r.operation_uuid===args[2]);if(row)row.response_json=args[0];return [{affectedRows:fail.conversionReceipt?0:row?1:0}] }
      if (sql.startsWith('UPDATE disposal_handling_operations SET legacy_disposal_id=')) { assert.equal(sql,'UPDATE disposal_handling_operations SET legacy_disposal_id=?,resource_type=?,resource_id=?,response_json=?,status=1,completed_at=NOW() WHERE operation_uuid=? AND status=0');const row=s.operations.find(r=>r.operation_uuid===args[4]&&r.status===0);if(row)Object.assign(row,{legacy_disposal_id:args[0],resource_type:args[1],resource_id:args[2],response_json:args[3],status:1});return [{affectedRows:fail.operation?0:row?1:0}] }
      throw Error('Unstubbed SQL: '+sql)
    },
  }
  const pool={getConnection:async()=>{calls.push('connection');return conn}}
  const common={'../../config/db':{pool},'../../utils/AppError':AppError,'../../utils/warehouseScope':scope,'./disposal.handling.rules':rules,'./disposal.handling.operations':operations,'./disposal.handling.proof':proof}
  const snapshot=fs.existsSync(path.join(base,'modules/disposal/disposal.conversion.snapshot.js'))?load('modules/disposal/disposal.conversion.snapshot.js',{'../../utils/AppError':AppError,'./disposal.handling.rules':rules}):{}
  const conversion=fs.existsSync(path.join(base,'modules/disposal/disposal.conversion.js'))?load('modules/disposal/disposal.conversion.js',{...common,'node:crypto':crypto,'./disposal.conversion.snapshot':snapshot}):{}
  const service=load('modules/disposal/disposal.handling.js',{...common,'../../utils/qtyPrecision':qty,'../../utils/sqlIdentifier':identifiers,'./disposal.handling.facts':{},'./disposal.handling.release':{actionLink:()=>null},'./disposal.conversion':conversion})
  const snap=()=>{const h=clean(state.heads[0]), rows=clean(state.items).sort((a,b)=>a.id-b.id);return {version:1,head:h,items:rows,approval:{approved_by:h.approved_by,approved_by_name:h.approved_by_name,approved_at:h.approved_at}}}
  const body=()=>({operationUuid:uuid(80),snapshotFingerprint:rules.fingerprint(rules.stableJson(snap())),reason:'整单原批准用途签认'})
  const options={requestKey:'conversion-key',operator:{userId:9,realName:'签认人'},authorization:{view:true,approve:true},scopeWarehouseIds:[8]}
  return {state,calls,sqls,fail,conn,service,conversion,snapshot,body,options,snap}
}
const preview=f=>method(f.service,'getConversionSnapshot')(11,[8])
const sign=(f,body=f.body(),opts=f.options)=>method(f.service,'signConversion')(11,body,opts)
const own=(f,opts={})=>f.service.getOwnOperation({operationUuid:uuid(80),action:'disposal.handling.legacy.convert.11',requestKey:'conversion-key',userId:9,scopeWarehouseIds:[8],...opts})
test('preview returns exact complete physical rows in one RR snapshot, no master join even when parent missing',async()=>{
 const f=fixture();f.state.products=[];const r=await preview(f)
 assert.equal(rules.stableJson(r.snapshot),rules.stableJson(f.snap()));assert.equal(r.snapshotFingerprint,f.body().snapshotFingerprint);assert.equal(r.conversion,null)
 assert.ok(f.sqls.some(q=>q.sql==='START TRANSACTION READ ONLY'));assert.ok(!f.sqls.some(q=>/JOIN|FROM product_items/.test(q.sql)));assert.equal(f.calls.filter(x=>x==='commit').length,1)
})
test('mixed types and duplicate SKU create all sources once, read non-contiguous IDs and preserve full old snapshots',async()=>{
 const f=fixture(),old=rules.stableJson({heads:f.state.heads,items:f.state.items}),r=await sign(f)
 assert.deepEqual(Array.from(r.sources,x=>x.sourceId),[301,308,402]);assert.deepEqual(Array.from(r.sources,x=>x.legacyItemId),[43,47,51]);assert.deepEqual(Array.from(r.sources,x=>x.handlingType),[2,3,1])
 assert.equal(f.calls.filter(x=>x==='commit').length,1);assert.equal(f.state.operations.length,1);assert.equal(f.state.conversions.length,1);assert.equal(f.state.sources.length,3);assert.equal(rules.stableJson({heads:f.state.heads,items:f.state.items}),old)
 const batch=f.sqls.filter(q=>q.sql.startsWith('INSERT INTO disposal_handling_sources'));assert.equal(batch.length,1);assert.match(batch[0].sql,/VALUES \?$/)
 assert.ok(f.state.sources.every(s=>s.product_code.startsWith('OLD')&&s.unit==='原个'&&s.warehouse_name==='原仓八'&&s.warehouse_code==='W8'&&s.created_operation_uuid===uuid(80)))
 const c=f.state.conversions[0],o=f.state.operations[0];assert.equal(c.response_json,rules.stableJson(r));assert.equal(o.legacy_disposal_id,11);assert.equal(o.resource_type,'inventory_disposal_conversion');assert.equal(o.resource_id,81);assert.ok(['intent_uuid','source_id','target_type','target_id','target_line_id'].every(k=>o[k]===null))
 proof.conversionIdentity(f.state.sources[0],c,o,f.state.sources)
})
for(const [name,change] of [
 ['status4',s=>s.heads[0].status=4],['pure scrap',s=>s.items.forEach(r=>r.dispose_type=3)],['empty',s=>s.items=[]],['unknown type',s=>s.items[0].dispose_type=9],['zero qty',s=>s.items[0].quantity='0.00'],['3dp qty',s=>s.items[0].quantity='2.001'],['missing creator',s=>s.heads[0].operator_id=null],['missing approval',s=>s.heads[0].approved_at=null],['disposed timestamp',s=>s.heads[0].disposed_at='2026-10-01'],['linked marker',s=>s.heads[0].disposal_handling_link_id=1],['wrong row parent',s=>s.items[0].disposal_id=12],['invalid product',s=>s.items[0].product_id=0],
 ['dirty log by no',s=>s.logs.push({ref_no:'DP11',product_id:999,warehouse_id:99,move_type:99})],['ledger by no',s=>s.scrapped.push({disposal_id:999,disposal_no:'DP11'})],['missing product FK',s=>s.products=[]],['missing warehouse FK',s=>s.warehouses=[]],['missing actor FK',s=>s.users=[]],
])test(`new conversion denies whole transaction: ${name}`,async()=>{const f=fixture();change(f.state);const before=rules.stableJson(f.state);await assert.rejects(sign(f),e=>e.statusCode===409||e.statusCode===403);assert.equal(rules.stableJson(f.state),before);assert.ok(!f.calls.includes('commit'))})
test('preview fingerprint drift refuses signing without replacing original request',async()=>{const f=fixture(),body=f.body();f.state.items[0].unit_value='9.4321';await assert.rejects(sign(f,body),e=>e.code==='DISPOSAL_CONVERSION_SNAPSHOT_CHANGED');assert.equal(f.state.sources.length,0)})
test('creator self-approval is only explicit flag1, not role1, and scope/auth run before permanent replay',async()=>{
 const f=fixture();f.state.heads[0].operator_id=9;await assert.rejects(sign(f),e=>e.code==='SELF_APPROVAL_DENIED');f.state.users[0].allow_self_approve=1;const body=f.body();await sign(f,body)
 const count=f.sqls.length;await assert.rejects(sign(f,body,{...f.options,scopeWarehouseIds:[]}),e=>e.statusCode===403);assert.ok(!f.sqls.slice(count).some(q=>q.sql.startsWith('INSERT INTO disposal_handling_operations')))
 await assert.rejects(sign(f,body,{...f.options,authorization:{view:true,approve:false}}),e=>e.statusCode===403)
})
for(const edge of ['conversion','sources','sourceReceipt','conversionReceipt','operation'])test(`conversion ${edge} failure rolls back entire source/conversion/permanent operation`,async()=>{const f=fixture(),before=rules.stableJson(f.state);f.fail[edge]=true;await assert.rejects(sign(f));assert.equal(rules.stableJson(f.state),before);assert.ok(!f.calls.includes('commit'))})
test('permanent ACK precedes stale snapshot/new master validation and survives later revision; own lookup needs no intent/view/write',async()=>{
 const f=fixture(),body=f.body(),r=await sign(f,body);f.state.sources.forEach(s=>s.revision=9);f.state.products=[];f.state.items=[];const before=f.sqls.length
 assert.equal(rules.stableJson(await sign(f,body)),rules.stableJson(r));assert.ok(!f.sqls.slice(before).some(q=>q.sql.includes('FROM product_items')));assert.equal(f.calls.filter(x=>x==='commit').length,1)
 const result=await own(f);assert.equal(rules.stableJson(result.data),rules.stableJson(r));assert.equal(result.resourceType,'inventory_disposal_conversion');assert.ok(!rules.stableJson(result).includes('unit_value'))
 assert.equal((await own(f,{userId:10})).status,'not_found');await assert.rejects(own(f,{scopeWarehouseIds:[]}),e=>e.statusCode===403)
})
for(const [name,change] of [['key',(f,b)=>[b,{...f.options,requestKey:'other'}]],['body',(f,b)=>[{...b,reason:'changed'},f.options]],['actor',(f,b)=>[b,{...f.options,operator:{userId:7,realName:'other'}}]]])test(`same global UUID changed ${name} conflicts`,async()=>{const f=fixture(),b=f.body();await sign(f,b);if(name==='actor')f.state.users.push({id:7,allow_self_approve:1});const [body,opts]=change(f,b);await assert.rejects(sign(f,body,opts),e=>e.code==='DISPOSAL_HANDLING_OPERATION_CONFLICT');assert.equal(f.state.conversions.length,1)})
test('new UUID on already converted old head is denied; global conflicting action cannot be adopted',async()=>{const f=fixture(),b=f.body();await sign(f,b);await assert.rejects(sign(f,{...b,operationUuid:uuid(81)}),e=>e.statusCode===409);assert.equal(f.state.operations.length,1);f.state.operations[0].action='disposal.handling.source.create';await assert.rejects(sign(f,b),e=>e.statusCode===409)})
for(const change of [f=>f.state.sources.pop(),f=>f.state.conversions[0].response_json='null',f=>f.state.operations[0].resource_id=999,f=>f.state.operations[0].source_id=301])test('corrupt immutable conversion identity never synthesizes own success',async()=>{const f=fixture();await sign(f);change(f);await assert.rejects(own(f),e=>e.statusCode===409)})
test('auth-only own pending/not_found does not read old valuation or synthesize success',async()=>{const f=fixture();const r=await own(f);assert.equal(r.status,'not_found');f.state.operations.push({operation_uuid:uuid(80),actor_id:9,action:'disposal.handling.legacy.convert.11',request_key:'conversion-key',intent_uuid:null,status:0});assert.equal((await own(f)).status,'pending');assert.ok(!f.sqls.some(q=>q.sql.includes('inventory_disposal_items')))})
test('strict source signing API routes and loaded server authorization',async()=>{
 const f=fixture(),records=[],router={use(){},get:(p,...h)=>records.push({p,h,method:'get'}),post:(p,...h)=>records.push({p,h,method:'post'}),put(){}},permissions=require('../backend/src/constants/permissions').PERMISSIONS,z=require('../backend/node_modules/zod').z
 const contracts=load('modules/disposal/disposal.handling.contracts.js',{'zod':{z},'../../utils/AppError':AppError,'./disposal.handling.rules':rules})
 load('modules/disposal/disposal.routes.js',{'express':{Router:()=>router},'zod':{z},'./disposal.controller':{},'../../middleware/auth':{authMiddleware(){},requirePermission:p=>({permission:p}),requireAnyPermission:p=>({permissions:p})},'../../constants/permissions':{PERMISSIONS:permissions},'../../utils/route':{validateBody:s=>({schema:s})},'./disposal.handling.contracts':contracts})
 const preview=records.find(r=>r.p==='/:id/conversion-snapshot'),post=records.find(r=>r.p==='/:id/sign-conversion');assert.ok(preview&&post);assert.equal(preview.h[0].permission,permissions.INVENTORY_DISPOSAL_VIEW);assert.deepEqual(post.h.slice(0,2).map(h=>h.permission),[permissions.INVENTORY_DISPOSAL_VIEW,permissions.INVENTORY_DISPOSAL_APPROVE]);const schema=post.h.find(h=>h.schema).schema;schema.parse(f.body());assert.throws(()=>schema.parse({...f.body(),origin:'legacy'}));assert.throws(()=>schema.parse({...f.body(),reason:' '}))
})
test('serializer is full-field exact DECIMAL text and JSON Date, rejects missing fields without rounding old values',()=>{
 const f=fixture(),serialize=method(f.snapshot,'serialize'),h={...f.state.heads[0],approved_at:new Date('2026-10-01T01:02:03.000Z')},rows=clean(f.state.items);rows[0].quantity='2.0000'
 const r=serialize(h,rows);assert.equal(r.head.total_value,'98.7654');assert.equal(r.items.find(x=>x.id===51).quantity,'2.00');assert.equal(r.approval.approved_at,'2026-10-01T01:02:03.000Z');assert.equal(r.items.length,3)
 const missing={...h};delete missing.updated_at;assert.throws(()=>serialize(missing,rows),e=>e.statusCode===409);rows[0].quantity='2.0010';assert.throws(()=>serialize(h,rows),e=>e.statusCode===409)
})
test('preview canonicalizes legal old 4dp quantity text and signs that same snapshot without altering valuations',async()=>{
 const f=fixture();f.state.items[0].quantity='2.0000';f.state.items[1].unit_value='1.234500';f.state.heads[0].total_value='98.765400'
 const old=rules.stableJson(f.state.items),p=await preview(f),r=await sign(f,{...f.body(),snapshotFingerprint:p.snapshotFingerprint})
 assert.equal(r.sources.length,3);assert.equal(rules.stableJson(f.state.items),old);assert.equal(JSON.parse(f.state.conversions[0].original_head_json).total_value,'98.7654')
 const p2=await preview(f);assert.deepEqual(clean(p2.conversion),{id:81,originalDisposalId:11,operationUuid:uuid(80)})
})
test('controller passes only actual loaded permission/scope/operator/raw IDs and original key, no body grants',async()=>{
 const calls=[],auth={hasPermission:(_req,p)=>p==='VIEW'},controller=load('modules/disposal/disposal.controller.js',{'./disposal.service':{},'./disposal.handling':{getConversionSnapshot:async(...a)=>{calls.push(a);return{}},signConversion:async(...a)=>{calls.push(a);return{}}},'../../utils/response':{successResponse:(_res,data)=>data},'../../utils/operator':{getOperatorFromRequest:()=>({userId:9,realName:'签认人'})},'../../utils/requestKey':{extractRequestKey:req=>req.headers['x-request-key']},'../../middleware/auth':auth,'../../constants/permissions':{PERMISSIONS:{INVENTORY_DISPOSAL_VIEW:'VIEW',INVENTORY_DISPOSAL_APPROVE:'APPROVE',INVENTORY_DISPOSAL_CREATE:'CREATE'}}})
 const f=fixture(),req={params:{id:'11'},body:{...f.body(),authorization:{approve:true}},headers:{'x-request-key':'conversion-key'},user:{warehouseIds:[8]}}
 await method(controller,'conversionSnapshot')(req,{},e=>{throw e});await method(controller,'signConversion')(req,{},e=>{throw e})
 assert.deepEqual(clean(calls[0]),['11',[8]]);assert.equal(calls[1][0],'11');assert.equal(calls[1][2].authorization.approve,false);assert.equal(calls[1][2].authorization.view,true);assert.deepEqual(clean(calls[1][2].scopeWarehouseIds),[8]);assert.equal(calls[1][2].requestKey,'conversion-key')
})
for(const [name,change] of [['blank reason',b=>({...b,reason:' '})],['extra origin',b=>({...b,origin:'ordinary'})],['unsafe fingerprint',b=>({...b,snapshotFingerprint:'x'})],['null body',()=>null]])test(`strict domain body rejects ${name} without any connection`,async()=>{const f=fixture();await assert.rejects(sign(f,change(f.body())),e=>e.statusCode===400);assert.equal(f.calls.length,0)})
test('path/resource/action and per-source frozen identities remain exact in replay and own query',async()=>{
 const f=fixture(),b=f.body();await sign(f,b);await assert.rejects(method(f.service,'signConversion')(12,b,f.options),e=>e.statusCode===409);await assert.rejects(own(f,{action:'disposal.handling.legacy.convert.12'}),e=>e.statusCode===409)
 const s=f.state.sources[0];s.legacy_disposal_item_id=999;await assert.rejects(sign(f,b),e=>e.statusCode===409);await assert.rejects(own(f),e=>e.statusCode===409)
})
test('head X and all old items X precede permanent operation, parent S locks precede their exact batch writes',async()=>{
 const f=fixture();await sign(f);const qs=f.sqls.map(q=>q.sql),pos=x=>qs.findIndex(q=>q.startsWith(x))
 assert.ok(pos('SELECT * FROM inventory_disposal_orders WHERE id=? FOR UPDATE')<pos('SELECT * FROM inventory_disposal_items WHERE disposal_id=? ORDER BY id FOR UPDATE'))
 assert.ok(pos('SELECT * FROM inventory_disposal_items WHERE disposal_id=? ORDER BY id FOR UPDATE')<pos('INSERT INTO disposal_handling_operations'))
 assert.ok(pos('SELECT id FROM product_items WHERE id IN (?) ORDER BY id FOR SHARE')<pos('INSERT INTO disposal_handling_sources'))
 assert.ok(!qs.some(q=>/UPDATE inventory_disposal_(orders|items)|inventory_stock|inventory_containers|payment_|warehouse_tasks/.test(q)))
})
