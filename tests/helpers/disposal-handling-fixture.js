'use strict'
// Strict offline SQL/transaction boundary. Domain modules execute for real.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const assert = require('node:assert/strict')
const AppError = require('../../backend/src/utils/AppError')
const ids = require('../../backend/src/utils/sqlIdentifier')
const base = path.resolve(__dirname, '../../backend/src')
function load(file, deps) {
  const module = { exports: {} }, filename = path.join(base, file)
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => {
    if (!Object.hasOwn(deps, name)) throw Error(`Unstubbed require ${file}: ${name}`)
    return deps[name]
  } }, { filename })
  return module.exports
}
const qty = load('utils/qtyPrecision.js', { './AppError': AppError })
const scope = load('utils/warehouseScope.js', { '../config/db': {}, './AppError': AppError })
const rules = load('modules/disposal/disposal.handling.rules.js', { 'node:crypto': require('node:crypto'), '../../utils/AppError': AppError, '../../utils/qtyPrecision': qty })
const operations = load('modules/disposal/disposal.handling.operations.js', { '../../utils/AppError': AppError, './disposal.handling.rules': rules })
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const clone = value => structuredClone(value)
function fixture() {
  const source = { id: 7, intent_uuid: uuid(1), created_operation_uuid: uuid(2), product_id: 3, product_code: 'P3', product_name: '商品三', warehouse_id: 8, warehouse_code: 'W8', warehouse_name: '仓八', unit: '个', handling_type: 1, quantity: 10, revision: 2, created_by: 9, legacy_disposal_id: null, legacy_disposal_item_id: null }
  const payload = { warehouseId: 8, customerId: 4, items: [{ productId: 3, unit: '个', quantity: 6 }], disposalSource: { sourceId: 7, expectedRevision: 1, operationUuid: uuid(3) } }
  const response = { id: 81, orderNo: 'S81' }
  const link = { id: 31, source_id: 7, target_type: 'sale_order', target_id: 81, target_line_id: 501, product_id: 3, warehouse_id: 8, unit: '个', allocated_quantity: 6, released_quantity: 0, final_executed_quantity: null, state: 'ACTIVE', created_operation_uuid: uuid(3), response_json: rules.stableJson(response), release_operation_uuid: null, release_evidence_json: null, release_response_json: null }
  const create = { operation_uuid: uuid(3), action: 'disposal.handling.sale.create', actor_id: 9, request_key: 'create-key', intent_uuid: uuid(1), payload_json: rules.stableJson(payload), payload_hash: rules.fingerprint(rules.stableJson(payload)), response_json: rules.stableJson(response), source_id: 7, target_type: 'sale_order', target_id: 81, target_line_id: 501, resource_type: 'sale_order', resource_id: 81, status: 1 }
  const state = { disposal_handling_sources: [source], disposal_handling_links: [link], disposal_handling_operations: [create], sale_orders: [{ id: 81, order_no: 'S81', status: 4, warehouse_id: 8, customer_id: 4, customer_name: '客户四', commercial_model: null, disposal_handling_link_id: 31, task_id: 22 }], sale_order_items: [{ id: 501, order_id: 81, product_id: 3, warehouse_id: 8, unit: '个', quantity: 2, shipped_qty: 2, dispatched_qty: 2, reserved_qty: 2 }], purchase_returns: [], purchase_return_items: [], purchase_order_items: [], purchase_orders: [], inventory_disposal_orders: [], inventory_disposal_items: [], disposal_scrapped: [], inventory_containers: [], packages: [{ id: 41, warehouse_task_id: 21, status: 2 }, { id: 42, warehouse_task_id: 22, status: 3 }], warehouse_tasks: [
    { id: 21, sale_order_id: 81, task_no: 'WT21', task_type: 'sale_out', warehouse_id: 8, status: 7, shipped_at: '2026-10-05', deleted_at: '2026-10-05', cancel_requested_at: null, adjustment_requested_at: null },
    { id: 22, sale_order_id: 81, task_no: 'WT22', task_type: 'sale_out', warehouse_id: 8, status: 8, shipped_at: null, cancel_requested_at: null, adjustment_requested_at: null },
  ], warehouse_task_items: [{ id: 601, task_id: 21, product_id: 3, unit: '个', required_qty: 2, picked_qty: 2 }, { id: 602, task_id: 22, product_id: 3, unit: '个', required_qty: 4, picked_qty: 4 }], inventory_logs: [{ id: 71, move_type: 8, type: 2, product_id: 3, warehouse_id: 8, quantity: 2, ref_type: 'warehouse_task', ref_id: 21, ref_no: 'WT21', log_source_type: 'sale_task', log_source_ref_id: 21, container_id: 101 }], inventory_disposal_conversions: [], sys_users: [{ id: 9, allow_self_approve: 0, deleted_at:null }], events: [] }
  const sqls = [], calls = [], fail = {}; let tx = null, replay = null
  const current = () => tx || state
  function subset(table, sql, args) {
    let rows = current()[table]
    if (/WHERE (?:s\.)?id\s*=\s*\?/.test(sql)) rows = rows.filter(row => Number(row.id) === Number(args[0]))
    else if (/WHERE id IN \(\?\)/.test(sql)) rows = rows.filter(row => Array.from(args[0]).map(Number).includes(Number(row.id)))
    else if (/WHERE source_id IN \(\?\)/.test(sql)) rows = rows.filter(row => Array.from(args[0]).map(Number).includes(Number(row.source_id)))
    else if (/WHERE original_disposal_id=\?/.test(sql)) rows = rows.filter(row => Number(row.original_disposal_id) === Number(args[0]))
    else if (/WHERE source_id=\?/.test(sql)) rows = rows.filter(row => Number(row.source_id) === Number(args[0]))
    else if (table === 'disposal_handling_sources' && sql === 'SELECT * FROM disposal_handling_sources WHERE legacy_disposal_id=? ORDER BY legacy_disposal_item_id') rows = rows.filter(row => Number(row.legacy_disposal_id) === Number(args[0])).sort((a,b)=>Number(a.legacy_disposal_item_id)-Number(b.legacy_disposal_item_id))
    else if (/WHERE (order_id|return_id|disposal_id|task_id|locked_by_task_id|warehouse_task_id) IN \(\?\)/.test(sql)) {
      const field = sql.match(/WHERE (\w+) IN/)[1]; rows = rows.filter(row => Array.from(args[0]).map(Number).includes(Number(row[field])))
    } else if (/WHERE operation_uuid/.test(sql)) rows = rows.filter(row => (Array.isArray(args[0]) ? Array.from(args[0]).includes(row.operation_uuid) : row.operation_uuid === args[0]) && (!sql.includes('actor_id=?') || Number(row.actor_id) === Number(args[1])))
    else if (table === 'warehouse_tasks') {
      const sales = Array.from(args[0] || []), returns = Array.from(args[1] || [])
      assert.ok(sql.includes('sale_order_id IN (?)') && sql.includes("task_type='purchase_return'")); assert.ok(!sql.includes('deleted_at IS NULL'), 'full historical tasks')
      rows = rows.filter(row => sales.includes(Number(row.sale_order_id)) || row.task_type === 'purchase_return' && returns.includes(Number(row.return_id)))
    } else if (table === 'inventory_logs') {
      assert.ok(sql.includes("ref_type='warehouse_task'") && sql.includes("log_source_type='sale_task'") && sql.includes('ref_no IN (?)'))
      assert.ok(!/product_id=|warehouse_id=|move_type=/.test(sql), 'do not hide dirty candidates')
      const [wtids, wtids2, wtnos, scrapids, scrapids2, scrapnos] = args.map(v => Array.from(v))
      rows = rows.filter(r => r.ref_type === 'warehouse_task' && wtids.includes(Number(r.ref_id)) || r.log_source_type === 'sale_task' && wtids2.includes(Number(r.log_source_ref_id)) || wtnos.includes(r.ref_no) || r.ref_type === 'disposal' && scrapids.includes(Number(r.ref_id)) || r.log_source_type === 'disposal' && scrapids2.includes(Number(r.log_source_ref_id)) || scrapnos.includes(r.ref_no))
    } else throw Error(`Unbounded/unknown SELECT ${sql}`)
    const columns = sql.match(/^SELECT (.+?) FROM /)?.[1]
    assert.ok(columns, `SELECT projection missing: ${sql}`)
    if (columns === '*' || columns === 's.*') return rows.map(clone)
    if (columns === 'COUNT(*) AS total') return [{ total: rows.length }]
    return rows.map(row => Object.fromEntries(columns.split(',').map(raw => {
      const name = raw.trim().replace(/^[a-z]+\./, '')
      assert.match(name, /^[a-z_]+$/, `Unknown projection: ${raw}`)
      assert.ok(Object.hasOwn(row, name), `Undeclared fixture column ${table}.${name}`)
      return [name, clone(row[name])]
    })))
  }
  const conn = { beginTransaction: async () => { calls.push('begin'); tx = clone(state) }, commit: async () => { calls.push('commit'); if (tx) Object.assign(state, tx); tx = null }, rollback: async () => { calls.push('rollback'); tx = null }, release: () => calls.push('release'), query: async (raw, args = []) => {
    const sql = raw.replace(/\s+/g, ' ').trim(); sqls.push({ sql, args: clone(Array.from(args)) })
    if (/^(SET TRANSACTION|START TRANSACTION READ ONLY)/.test(sql)) { calls.push(sql); return [{}] }
    if (sql.startsWith('SELECT ')) {
      const table = sql.match(/ FROM (\w+)/)?.[1]
      if (!Object.hasOwn(current(), table)) throw Error(`Unexpected table ${sql}`)
      return [subset(table, sql, args)]
    }
    if (sql.startsWith('INSERT INTO disposal_handling_operations')) {
      const columns = sql.match(/\(([^)]+)\) VALUES/)[1].split(',').map(x => x.trim()); assert.equal(columns.length, args.length)
      const row = Object.fromEntries(columns.map((key, i) => [key, args[i]]))
      if (current().disposal_handling_operations.some(op => op.operation_uuid === row.operation_uuid)) throw Object.assign(Error('duplicate'), { code: 'ER_DUP_ENTRY' })
      current().disposal_handling_operations.push(row); return [{ insertId: 99 }]
    }
    if (sql.startsWith('UPDATE disposal_handling_links SET released_quantity=')) {
      const row = current().disposal_handling_links.find(r => Number(r.id) === Number(args.at(-2)) && Number(r.source_id) === Number(args.at(-1)))
      assert.ok(row, 'exact link/source CAS'); if (fail.link || row.state !== 'ACTIVE' || Number(row.released_quantity) !== 0 || row.release_operation_uuid != null) return [{ affectedRows: 0 }]
      const [r,e,op,user,name,reason,evidence,response] = args
      Object.assign(row,{released_quantity:r,final_executed_quantity:e,state:'TERMINATED',release_operation_uuid:op,released_by:user,released_by_name:name,release_reason:reason,release_evidence_json:evidence,release_response_json:response,released_at:'2026-10-05'}); return [{ affectedRows:1 }]
    }
    if (sql === 'UPDATE disposal_handling_sources SET revision=revision+1 WHERE id=? AND revision=?') {
      const row=current().disposal_handling_sources.find(r=>Number(r.id)===Number(args[0]) && Number(r.revision)===Number(args[1])); if (fail.revision || !row) return [{affectedRows:0}]; row.revision++; return [{affectedRows:1}]
    }
    if (sql.startsWith('UPDATE disposal_handling_operations SET source_id=')) {
      const row=current().disposal_handling_operations.find(r=>r.operation_uuid===args.at(-1) && Number(r.status)===0); assert.ok(row,'exact pending operation'); if(fail.operation)return [{affectedRows:0}]
      const [sourceId,type,targetId,lineId,resourceType,resourceId,response]=args
      Object.assign(row,{source_id:sourceId,target_type:type,target_id:targetId,target_line_id:lineId,resource_type:resourceType,resource_id:resourceId,response_json:response,status:1}); return [{affectedRows:1}]
    }
    if (/^UPDATE warehouse_tasks SET status = \?/.test(sql)) {
      const row=current().warehouse_tasks.find(r=>Number(r.id)===Number(args[1]) && Number(r.status)===Number(args[2])); if(!row)return [{affectedRows:0}];row.status=args[0];return [{affectedRows:1}]
    }
    throw Error(`Unexpected SQL ${sql}`)
  } }
  const common = { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, '../../utils/sqlIdentifier': ids, './disposal.handling.rules': rules, './disposal.handling.operations': operations }
  const optional = file => fs.existsSync(path.join(base, `modules/disposal/${file}.js`)) ? load(`modules/disposal/${file}.js`, common) : {}
  const proof = optional('disposal.handling.proof'); common['./disposal.handling.proof'] = proof
  const facts = optional('disposal.handling.facts'); common['./disposal.handling.facts'] = facts
  const release = fs.existsSync(path.join(base,'modules/disposal/disposal.handling.release.js')) ? load('modules/disposal/disposal.handling.release.js',{...common,'../../config/db':{pool:{getConnection:async()=>conn}}}) : {}
  const service=load('modules/disposal/disposal.handling.js',{...common,'../../config/db':{pool:{getConnection:async()=>conn}},'../../utils/qtyPrecision':qty,'./disposal.handling.release':release})
  const transition=load('utils/statusTransition.js',{'./AppError':AppError,'./sqlIdentifier':ids})
  const wtRules=load('constants/warehouseTaskStatus.js',{'../utils/AppError':AppError})
  const pick=load('modules/warehouse-tasks/warehouse-tasks.pick.js',{'../../config/db':{pool:{getConnection:async()=>conn}},'../../utils/AppError':AppError,'../../utils/statusTransition':transition,'../../constants/warehouseTaskStatus':wtRules,'./warehouse-task-events.service':{WT_EVENT:{},record:async()=>{}},'../../utils/operationRequest':{beginResourceOperationRequest:async()=>replay ? {replay:true,responseData:replay}: {enabled:false},completeOperationRequest:async()=>{}},'./warehouse-tasks.helpers':{logSideEffectFailure:()=>{},assertTaskPickScanClosure:async()=>calls.push('closure'),assertTaskScope:row=>scope.assertInScope([8],row.warehouse_id)},'./warehouse-tasks.query':{findById:async()=>null}})
  return { state, conn, sqls, calls, fail, service, facts, release, pick, rules, setReplay: value => { replay = value } }
}
function typeFixture(type){
 const f=fixture(),s=f.state,l=s.disposal_handling_links[0],op=s.disposal_handling_operations[0],source=s.disposal_handling_sources[0]
 s.sale_orders=[];s.sale_order_items=[];source.handling_type=type==='purchase_return'?2:3;l.target_type=type;op.target_type=type;op.resource_type=type
 op.action=type==='purchase_return'?'disposal.handling.purchase_return.create':'disposal.handling.scrap.create'
 const response=type==='purchase_return'?{id:81,returnNo:'PR81'}:{id:81,disposalNo:'D81'};l.response_json=rules.stableJson(response);op.response_json=l.response_json
 if(type==='purchase_return'){
  s.purchase_returns=[{id:81,return_no:'PR81',status:4,warehouse_id:8,purchase_order_id:91,purchase_order_no:'PO91',supplier_id:5,supplier_name:'供应商五',disposal_handling_link_id:31}]
  s.purchase_return_items=[{id:501,return_id:81,product_id:3,unit:'个',quantity:6,purchase_item_id:901}]
  s.purchase_order_items=[{id:901,order_id:91,product_id:3,unit:'个'}];s.purchase_orders=[{id:91,order_no:'PO91',warehouse_id:8,supplier_id:5}]
  s.warehouse_tasks=[{...s.warehouse_tasks[1],id:22,task_type:'purchase_return',sale_order_id:null,return_id:81}]
  s.warehouse_task_items=[{id:602,task_id:22,product_id:3,unit:'个',required_qty:6,picked_qty:6,purchase_return_item_id:501}]
  s.packages=[];s.inventory_logs=[]
 }else{
  s.inventory_disposal_orders=[{id:81,disposal_no:'D81',status:4,warehouse_id:8,disposed_at:'2026-10-05',disposal_handling_link_id:31}]
  s.inventory_disposal_items=[{id:501,disposal_id:81,product_id:3,unit:'个',quantity:6,dispose_type:3}]
  s.disposal_scrapped=[{id:1,disposal_id:81,disposal_no:'D81',product_id:3,warehouse_id:8,unit:'个',quantity:6}]
  s.inventory_logs=[{id:71,move_type:13,type:2,product_id:3,warehouse_id:8,quantity:6,ref_type:'disposal',ref_id:81,ref_no:'D81',log_source_type:'disposal',log_source_ref_id:81}]
  s.warehouse_tasks=[];s.warehouse_task_items=[];s.packages=[]
 }
 return f
}

module.exports={fixture,typeFixture,load,rules,uuid,scope,AppError}
