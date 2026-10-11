// 只读交接投影。调用方核原单权限；批读还须按真实任务仓库核当前范围，不返回销售量价正文。
const { scopeFilter } = require('../../utils/warehouseScope')
const { isKnownChangePayload, taskReferences, validId, rowsInScope } = require('../document-activity/document-history-scope')
const { parsePayload } = require('../document-activity/document-change-audit')
const actor = (id, name) => {
  const actorId = Number(id)
  const actorName = typeof name === 'string' && name ? name : null
  return Number.isSafeInteger(actorId) && actorId > 0 || actorName
    ? { id: Number.isSafeInteger(actorId) && actorId > 0 ? actorId : null, name: actorName } : null
}
const savedText = value => typeof value === 'string' ? value : null
const auditColumns = `e.id, e.document_id, e.payload_version, e.payload_json,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(e.payload_json,'$.reason'))='STRING'
    THEN JSON_UNQUOTE(JSON_EXTRACT(e.payload_json,'$.reason')) ELSE NULL END AS reason,
  JSON_EXTRACT(e.payload_json,'$.actors.operator.id') AS requested_by,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(e.payload_json,'$.actors.operator.name'))='STRING'
    THEN JSON_UNQUOTE(JSON_EXTRACT(e.payload_json,'$.actors.operator.name')) ELSE NULL END AS requested_by_name,
  e.created_at AS requested_at`
async function authorizedAudits(db, audits, warehouseIds) {
  const parsed = audits.map(audit=>({audit,payload:parsePayload(audit.payload_json)})).filter(entry=>Number(entry.audit.payload_version)===1 && isKnownChangePayload(entry.payload) && rowsInScope(entry.payload,warehouseIds))
  const references = parsed.map(entry=>({...entry,ref:taskReferences({payload:entry.payload})})).filter(entry=>entry.ref.valid)
  const adjustmentIds = [...new Set(references.flatMap(entry=>entry.ref.adjustments))]
  const [adjustments] = adjustmentIds.length ? await db.query('SELECT soa.id,soa.sale_order_id,soa.warehouse_task_id FROM sale_order_adjustments soa WHERE soa.id IN (?)',[adjustmentIds]) : [[]]
  const byAdjustment = new Map(adjustments.map(row=>[Number(row.id),row]))
  const taskIds = [...new Set([...references.flatMap(entry=>entry.ref.ids),...adjustments.map(row=>Number(row.warehouse_task_id))].filter(validId))]
  const [tasks] = taskIds.length ? await db.query('SELECT wt.id,wt.sale_order_id,wt.warehouse_id FROM warehouse_tasks wt WHERE wt.id IN (?) AND wt.deleted_at IS NULL',[taskIds]) : [[]]
  const byTask = new Map(tasks.map(row=>[Number(row.id),row]))
  const allowed = Array.isArray(warehouseIds) ? new Set(warehouseIds.map(Number)) : null
  return references.filter(({audit,ref})=>{
    const ids = [...ref.ids]
    for (const adjustmentId of ref.adjustments) {
      const adjustment=byAdjustment.get(adjustmentId),taskId=Number(adjustment?.warehouse_task_id)
      if (!adjustment || Number(adjustment.sale_order_id)!==Number(audit.document_id) || !validId(taskId) || (ref.ids.length && !ref.ids.includes(taskId))) return false
      ids.push(taskId)
    }
    return ids.length>0 && ids.every(id=>{
      const task=byTask.get(id)
      return task && Number(task.sale_order_id)===Number(audit.document_id) && (!allowed || allowed.has(Number(task.warehouse_id)))
    })
  }).map(entry=>entry.audit)
}
function adjustmentHandoff(adj, audit) {
  return {
    reason: savedText(audit?.reason),
    requestedBy: actor(audit?.requested_by, audit?.requested_by_name) || actor(adj.requested_by, adj.requested_by_name),
    requestedAt: audit?.requested_at || adj.requested_at || null,
    phase: Number(adj.status) === 1 ? 'pending' : Number(adj.status) === 2 ? 'completed' : 'unknown',
    completedAt: adj.completed_at || null,
  }
}
async function readAdjustmentHandoff(db, adj, scopeWarehouseIds = null) {
  const [saved] = await db.query(
    `SELECT ${auditColumns} FROM document_operation_events e
     WHERE e.document_type='sale' AND e.document_id=? AND e.payload_version=1
       AND JSON_EXTRACT(e.payload_json,'$.context.adjustmentId')=CAST(? AS UNSIGNED)
     ORDER BY e.id DESC LIMIT 1`,
    [adj.sale_order_id, adj.id],
  )
  const [audit] = await authorizedAudits(db,saved,scopeWarehouseIds)
  return adjustmentHandoff(adj, audit)
}
function cancelHandoff(task, audit, events) {
  const request = events.find(e => e.event_type === 'CANCEL_REQUESTED')
  const completed = events.find(e => e.event_type === 'CANCEL_FINALIZED')
  return {
    reason: savedText(audit?.reason),
    requestedBy: actor(audit?.requested_by, audit?.requested_by_name) || actor(request?.operator_id, request?.operator_name),
    requestedAt: audit?.requested_at || request?.created_at || task.cancel_requested_at || null,
    phase: task.cancel_requested_at ? 'pending' : Number(task.status) === 8 && (audit || request || completed) ? 'completed' : 'unknown',
    completedAt: completed?.created_at || null,
  }
}
function confirmations(scans, events) {
  return [
    ...scans.map(s => ({ id:`scan-${s.id}`, kind:'container_return', barcode:s.barcode || null,
      qty:s.qty == null ? null : Number(s.qty), confirmedBy:actor(s.operator_id,s.operator_name), confirmedAt:s.scanned_at || null })),
    ...events.filter(e => e.event_type === 'CANCEL_RETURN_BOX_SCAN').map(e => ({ id:`event-${e.id}`, kind:'package_void',
      barcode:savedText(e.barcode), qty:null, confirmedBy:actor(e.operator_id,e.operator_name), confirmedAt:e.created_at || null })),
  ]
}
const cancelEventColumns = `id, task_id, event_type, operator_id, operator_name, created_at,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(detail,'$.barcode'))='STRING'
    THEN JSON_UNQUOTE(JSON_EXTRACT(detail,'$.barcode')) ELSE NULL END AS barcode`
async function readCancelHandoff(db, task, scopeWarehouseIds = null) {
  const [saved] = await db.query(
    `SELECT ${auditColumns} FROM document_operation_events e
     WHERE e.document_type='sale' AND e.document_id=? AND e.payload_version=1
       AND JSON_UNQUOTE(JSON_EXTRACT(e.payload_json,'$.context.phase'))='cancellation_requested'
       AND (JSON_CONTAINS(JSON_EXTRACT(e.payload_json,'$.context.warehouseTaskIds'),CAST(? AS JSON))
         OR (JSON_EXTRACT(e.payload_json,'$.context.warehouseTaskIds') IS NULL
           AND JSON_EXTRACT(e.payload_json,'$.context.warehouseTaskId')=CAST(? AS UNSIGNED)))
     ORDER BY e.id DESC LIMIT 1`,
    [task.sale_order_id, Number(task.id), Number(task.id)],
  )
  const [audit] = await authorizedAudits(db,saved,scopeWarehouseIds)
  const [events] = await db.query(
    `SELECT ${cancelEventColumns} FROM warehouse_task_events
     WHERE task_id=? AND event_type IN ('CANCEL_REQUESTED','CANCEL_RETURN_BOX_SCAN','CANCEL_FINALIZED') ORDER BY id DESC`, [task.id],
  )
  const [scans] = await db.query(
    `SELECT id, barcode, qty, operator_id, operator_name, scanned_at FROM scan_logs
     WHERE task_id=? AND scan_purpose=3 ORDER BY id ASC`, [task.id],
  )
  return { handoff:cancelHandoff(task,audit,events), confirmations:confirmations(scans,events) }
}
// 原单现存物料的范围不能授权已删物料对应的历史任务。先核真实任务仓，再批读交接事实。
async function readTaskHandoffs(db, taskIds, savedEvents, scopeWarehouseIds = null, authorizedAuditIds = null) {
  if (!taskIds.length || (Array.isArray(scopeWarehouseIds) && !scopeWarehouseIds.length)) return { rows:[], confirmations:[] }
  const scope = scopeFilter(scopeWarehouseIds, 'wt.warehouse_id')
  const [taskRows] = await db.query(
    `SELECT wt.id, wt.task_no, wt.sale_order_id, wt.warehouse_id, wt.status, wt.cancel_requested_at
     FROM warehouse_tasks wt WHERE wt.id IN (?) AND wt.deleted_at IS NULL${scope.sql}`, [taskIds, ...scope.params],
  )
  const requestedIds = new Set(taskIds.map(Number))
  const allowedWarehouses = Array.isArray(scopeWarehouseIds) ? new Set(scopeWarehouseIds.map(Number)) : null
  const tasks = taskRows.filter(t => requestedIds.has(Number(t.id)) && (!allowedWarehouses || allowedWarehouses.has(Number(t.warehouse_id))))
  if (!tasks.length) return { rows:[], confirmations:[] }
  const visibleTaskIds = tasks.map(t => Number(t.id))
  const [savedAdjustments] = await db.query(
    `SELECT soa.id, soa.adjustment_no, soa.sale_order_id, soa.warehouse_task_id, soa.status,
       soa.requested_by, soa.requested_by_name, soa.requested_at, soa.completed_at
     FROM sale_order_adjustments soa WHERE soa.warehouse_task_id IN (?) ORDER BY soa.id`, [visibleTaskIds],
  )
  const byTask = new Map(tasks.map(task=>[Number(task.id),task]))
  const adjustments = savedAdjustments.filter(adj=>Number(adj.sale_order_id)===Number(byTask.get(Number(adj.warehouse_task_id))?.sale_order_id))
  const byAdjustment = new Map(adjustments.map(adj=>[Number(adj.id),adj]))
  const [savedAudits] = await db.query(
    `SELECT ${auditColumns}, wt.id AS task_id,
       JSON_EXTRACT(e.payload_json,'$.context.adjustmentId') AS adjustment_id
     FROM document_operation_events e INNER JOIN warehouse_tasks wt ON wt.sale_order_id=e.document_id
     WHERE e.document_type='sale' AND e.payload_version=1 AND wt.id IN (?)
       AND ((JSON_UNQUOTE(JSON_EXTRACT(e.payload_json,'$.context.phase'))='cancellation_requested'
         AND (JSON_CONTAINS(JSON_EXTRACT(e.payload_json,'$.context.warehouseTaskIds'),CAST(wt.id AS JSON))
           OR (JSON_EXTRACT(e.payload_json,'$.context.warehouseTaskIds') IS NULL
             AND JSON_EXTRACT(e.payload_json,'$.context.warehouseTaskId')=wt.id)))
         OR JSON_EXTRACT(e.payload_json,'$.context.adjustmentId') IN
           (SELECT id FROM sale_order_adjustments WHERE warehouse_task_id=wt.id))
     ORDER BY e.id DESC`, [visibleTaskIds],
  )
  // A shared A/B change has indivisible reason/actor text. Reuse the activity's whole-event decision.
  const allowedAudits = Array.isArray(authorizedAuditIds) ? new Set(authorizedAuditIds.map(Number)) : null
  const audits = await authorizedAudits(db,savedAudits.filter(audit=>!allowedAudits || allowedAudits.has(Number(audit.id))),scopeWarehouseIds)
  const [savedVoids] = await db.query(
    `SELECT v.id, soa.id AS adjustment_id, soa.warehouse_task_id AS task_id, v.barcode, v.status,
       v.confirmed_by, v.confirmed_by_name, v.confirmed_at
     FROM sale_order_adjustment_package_voids v JOIN sale_order_adjustment_items i ON i.id=v.adjustment_item_id
     JOIN sale_order_adjustments soa ON soa.id=i.adjustment_id WHERE soa.warehouse_task_id IN (?)`, [visibleTaskIds],
  )
  const [savedReturns] = await db.query(
    `SELECT r.id, soa.id AS adjustment_id, soa.warehouse_task_id AS task_id, c.barcode, r.qty, r.status,
       r.confirmed_by, r.confirmed_by_name, r.confirmed_at
     FROM sale_order_adjustment_container_returns r JOIN sale_order_adjustment_items i ON i.id=r.adjustment_item_id
     JOIN sale_order_adjustments soa ON soa.id=i.adjustment_id LEFT JOIN inventory_containers c ON c.id=r.source_container_id
     WHERE soa.warehouse_task_id IN (?)`, [visibleTaskIds],
  )
  const confirmedAssociation = row=>Number(byAdjustment.get(Number(row.adjustment_id))?.warehouse_task_id)===Number(row.task_id)
  const voids = savedVoids.filter(confirmedAssociation), returns = savedReturns.filter(confirmedAssociation)
  const [scans] = await db.query(
    `SELECT id, task_id, barcode, qty, operator_id, operator_name, scanned_at FROM scan_logs
     WHERE task_id IN (?) AND scan_purpose=3 ORDER BY id ASC`, [visibleTaskIds],
  )
  const rows=[], confirmed=[]
  for (const adj of adjustments) {
    const task=tasks.find(t=>Number(t.id)===Number(adj.warehouse_task_id))
    const audit=audits.find(a=>Number(a.adjustment_id)===Number(adj.id) && Number(a.task_id)===Number(adj.warehouse_task_id))
    rows.push({ taskId:Number(adj.warehouse_task_id), taskNo:task?.task_no, kind:'改单', adjustmentId:Number(adj.id), adjustmentNo:adj.adjustment_no,
      ...adjustmentHandoff(adj,audit),
      packagesRemaining:voids.filter(v=>Number(v.adjustment_id)===Number(adj.id)&&Number(v.status)===1).length,
      containersRemaining:returns.filter(r=>Number(r.adjustment_id)===Number(adj.id)&&Number(r.status)===1).length })
  }
  for(const task of tasks) {
    const events=savedEvents.filter(e=>Number(e.task_id)===Number(task.id))
    const audit=audits.find(a=>a.adjustment_id==null && Number(a.task_id)===Number(task.id))
    if(!task.cancel_requested_at && !audit && !events.some(e=>e.event_type==='CANCEL_REQUESTED')) continue
    rows.push({ taskId:Number(task.id),taskNo:task.task_no,kind:'取消',...cancelHandoff(task,audit,events) })
    const eventProjection=events.map(e=>{
      let detail=e.detail
      if(typeof detail==='string') { try { detail=JSON.parse(detail) } catch { detail=null } }
      return {...e,barcode:detail?.barcode}
    })
    confirmed.push(...confirmations(scans.filter(s=>Number(s.task_id)===Number(task.id)),eventProjection).map(c=>({...c,taskNo:task.task_no,handoffKind:'取消',adjustmentId:null,adjustmentNo:null})))
  }
  for(const [entries,kind] of [[voids,'package_void'],[returns,'container_return']]) {
    confirmed.push(...entries.filter(e=>Number(e.status)===2).map(e=>({id:`${kind}-${e.id}`,kind,
      handoffKind:'改单',adjustmentId:Number(e.adjustment_id),adjustmentNo:adjustments.find(a=>Number(a.id)===Number(e.adjustment_id))?.adjustment_no || null,
      taskNo:tasks.find(t=>Number(t.id)===Number(e.task_id))?.task_no,barcode:e.barcode || null,qty:e.qty==null?null:Number(e.qty),
      confirmedBy:actor(e.confirmed_by,e.confirmed_by_name),confirmedAt:e.confirmed_at || null})))
  }
  return { rows, confirmations:confirmed }
}
module.exports = { actor, readAdjustmentHandoff, readCancelHandoff, readTaskHandoffs }
