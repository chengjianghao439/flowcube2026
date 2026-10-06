'use strict'
const rules = require('./disposal.handling.rules')
const proof = require('./disposal.handling.proof')
const uniq = rows => [...new Set(rows)]
const group = (rows, field) => {
  const result = new Map()
  for (const row of rows) { const key = Number(row[field]); if (!result.has(key)) result.set(key, []); result.get(key).push(row) }
  return result
}
async function selected(conn, table, column, ids) {
  // Every identifier comes from the closed mapping above or this module's fixed call sites.
  const { assertSqlIdentifier } = require('../../utils/sqlIdentifier')
  assertSqlIdentifier(table, '事实表'); assertSqlIdentifier(column, '事实归属列')
  if (!ids.length) return []
  const [rows] = await conn.query(`SELECT * FROM ${table} WHERE ${column} IN (?) ORDER BY id`, [uniq(ids)])
  return rows
}
async function identities(conn, sources, links) {
  const contexts = new Map(), sourceMap = new Map(sources.map(s => [Number(s.id), s]))
  if (!links.length) return contexts
  const opUuids = uniq(links.map(l => l.created_operation_uuid).filter(value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)))
  const ops = opUuids.length ? (await conn.query('SELECT * FROM disposal_handling_operations WHERE operation_uuid IN (?)', [opUuids]))[0] : []
  const opMap = new Map(ops.map(op => [op.operation_uuid, op]))
  const heads = new Map(), lines = new Map()
  for (const type of Object.keys(proof.TARGETS)) {
    const ids = links.filter(l => l.target_type === type).map(l => Number(l.target_id)), meta = proof.metadata(type)
    if (!ids.length) continue
    heads.set(type, new Map((await selected(conn, meta.head, 'id', ids)).map(row => [Number(row.id), row])))
    lines.set(type, group(await selected(conn, meta.line, meta.parent, ids), meta.parent))
  }
  const saleIds = uniq(links.filter(l => l.target_type === 'sale_order').map(l => Number(l.target_id)))
  const prIds = uniq(links.filter(l => l.target_type === 'purchase_return').map(l => Number(l.target_id)))
  let tasks = []
  if (saleIds.length || prIds.length) {
    // Empty branches use [0], never an empty IN; no matching positive task owner is broadened.
    ;[tasks] = await conn.query("SELECT * FROM warehouse_tasks WHERE sale_order_id IN (?) OR (task_type='purchase_return' AND return_id IN (?)) ORDER BY id", [saleIds.length ? saleIds : [0], prIds.length ? prIds : [0]])
  }
  for (const link of links) {
    const type = link.target_type
    contexts.set(Number(link.id), { source: sourceMap.get(Number(link.source_id)), link, head: heads.get(type)?.get(Number(link.target_id)), lines: lines.get(type)?.get(Number(link.target_id)) || [], operation: opMap.get(link.created_operation_uuid), tasks: tasks.filter(t => type === 'sale_order' ? Number(t.sale_order_id) === Number(link.target_id) : type === 'purchase_return' && t.task_type === 'purchase_return' && Number(t.return_id) === Number(link.target_id)) })
  }
  return contexts
}
function sameItem(row, link, head, parent) {
  return Number(row.id) === Number(link.target_line_id) && Number(row[parent]) === Number(link.target_id) && Number(row.product_id) === Number(link.product_id) && row.unit === link.unit && Number(row.warehouse_id ?? head.warehouse_id) === Number(link.warehouse_id)
}
function logCandidate(log, task, type, head) {
  return task ? log.ref_type === 'warehouse_task' && Number(log.ref_id) === Number(task.id) || log.log_source_type === 'sale_task' && Number(log.log_source_ref_id) === Number(task.id) || log.ref_no === task.task_no
    : log.ref_type === 'disposal' && Number(log.ref_id) === Number(head.id) || log.log_source_type === 'disposal' && Number(log.log_source_ref_id) === Number(head.id) || log.ref_no === head.disposal_no
}
function logsTotal(logs, link, task, head) {
  const seen = new Set(); let total = 0
  for (const log of logs) {
    if (!proof.id(log.id)) throw proof.invalid()
    if (seen.has(Number(log.id))) continue
    seen.add(Number(log.id))
    const refType = task ? 'warehouse_task' : 'disposal', sourceType = task ? 'sale_task' : 'disposal', id = Number(task?.id ?? head.id), no = task?.task_no ?? head.disposal_no
    if (Number(log.move_type) !== (task ? 8 : 13) || Number(log.type) !== 2 || Number(log.product_id) !== Number(link.product_id) || Number(log.warehouse_id) !== Number(link.warehouse_id)
      || log.ref_type !== refType || Number(log.ref_id) !== id || log.ref_no !== no || log.log_source_type !== sourceType || Number(log.log_source_ref_id) !== id) throw proof.invalid()
    total += proof.units(log.quantity, true)
    if (!Number.isSafeInteger(total)) throw proof.invalid()
  }
  return total
}
function evaluate(context) {
  const { source, link, head, lines, operation, tasks, taskItems = [], logs = [], containers = [], packages = [], scrapped = [], purchaseItems = [] } = context
  const creation = proof.createIdentity(source, link, head, operation), a = proof.units(link.allocated_quantity, true), type = link.target_type
  let e = 0, returned = true, terminal = false
  if (type === 'inventory_disposal') {
    if (lines.length !== 1 || !sameItem(lines[0], link, head, 'disposal_id') || proof.units(lines[0].quantity, true) !== a || Number(lines[0].dispose_type) !== 3) throw proof.invalid()
    const candidates = logs.filter(log => logCandidate(log, null, type, head)), total = logsTotal(candidates, link, null, head)
    if (Number(head.status) === 4) {
      if (!head.disposed_at || scrapped.length !== 1) throw proof.invalid()
      const row = scrapped[0]
      if (Number(row.disposal_id) !== Number(head.id) || row.disposal_no !== head.disposal_no || Number(row.product_id) !== Number(link.product_id) || Number(row.warehouse_id) !== Number(link.warehouse_id) || row.unit !== link.unit || proof.units(row.quantity, true) !== a || total !== a) throw proof.invalid()
      e = a; terminal = true
    } else if ([5, 6].includes(Number(head.status))) {
      if (head.disposed_at || scrapped.length || candidates.length) throw proof.invalid()
      terminal = true
    } else { if (head.disposed_at || scrapped.length || candidates.length) throw proof.invalid() }
  } else {
    const parent = type === 'sale_order' ? 'order_id' : 'return_id'
    // Closed sales may legitimately shrink/delete current SOI; task/ledger evidence remains authoritative.
    if (lines.length > 1 || lines.some(row => !sameItem(row, link, head, parent) || proof.units(row.quantity) > a)) throw proof.invalid()
    if (type === 'purchase_return') {
      if (lines.length !== 1 || !proof.id(head.purchase_order_id) || !proof.id(lines[0].purchase_item_id)) throw proof.invalid()
      const poi = purchaseItems.find(row => Number(row.id) === Number(lines[0].purchase_item_id))
      if (!poi || Number(poi.order_id) !== Number(head.purchase_order_id) || Number(poi.product_id) !== Number(link.product_id) || poi.unit !== link.unit) throw proof.invalid()
      terminal = Number(head.status) === 4
    } else terminal = [4, 5].includes(Number(head.status))
    if (!tasks.length) {
      const normal = type === 'sale_order' ? [1, 2, 6].includes(Number(head.status)) : Number(head.status) === 1
      const cancelled = type === 'sale_order' ? Number(head.status) === 5 : Number(head.status) === 4
      if (type === 'sale_order' && (!Object.hasOwn(head, 'task_id') || ['shipped_qty','dispatched_qty','reserved_qty'].some(key => !Object.hasOwn(lines[0] || {}, key)))) throw proof.invalid()
      if ((!normal && !cancelled) || type === 'sale_order' && head.task_id != null || lines.length !== 1 || proof.units(lines[0].quantity, true) !== a
        || proof.units(lines[0].shipped_qty ?? 0) !== 0 || proof.units(lines[0].dispatched_qty ?? 0) !== 0 || proof.units(lines[0].reserved_qty ?? 0) > a
        || cancelled && proof.units(lines[0].reserved_qty ?? 0) !== 0) throw proof.invalid()
    }
    let totalRequired = 0
    for (const task of tasks) {
      if (['id','task_no','task_type','warehouse_id','status','shipped_at','cancel_requested_at','adjustment_requested_at'].some(key => !Object.hasOwn(task, key)) || !proof.id(task.id) || !task.task_no || Number(task.warehouse_id) !== Number(link.warehouse_id) || task.task_type !== (type === 'sale_order' ? 'sale_out' : 'purchase_return')
        || type === 'sale_order' && Number(task.sale_order_id) !== Number(head.id)
        || type === 'purchase_return' && (Number(task.return_id) !== Number(head.id) || !Object.hasOwn(task, 'sale_order_id') || task.sale_order_id !== null)) throw proof.invalid()
      const rows = taskItems.filter(row => Number(row.task_id) === Number(task.id))
      if (rows.length !== 1 || !proof.id(rows[0].id) || Number(rows[0].product_id) !== Number(link.product_id) || rows[0].unit !== link.unit
        || type === 'purchase_return' && Number(rows[0].purchase_return_item_id) !== Number(link.target_line_id)) throw proof.invalid()
      const required = proof.units(rows[0].required_qty, true), picked = proof.units(rows[0].picked_qty)
      if (required > a || picked > required) throw proof.invalid()
      totalRequired += required
      // Cancel/re-dispatch can produce historical required totals > A; only actual E is bounded by A.
      if (!Number.isSafeInteger(totalRequired)) throw proof.invalid()
      const candidates = logs.filter(log => logCandidate(log, task, type, head)), total = logsTotal(candidates, link, task, head)
      if (Number(task.status) === 7) {
        if (!task.shipped_at || !picked || total !== picked || !candidates.length) throw proof.invalid()
        e += picked
      } else if (task.shipped_at || candidates.length) throw proof.invalid()
      if (![7, 8].includes(Number(task.status)) || task.cancel_requested_at != null || task.adjustment_requested_at != null
        || containers.some(c => Number(c.locked_by_task_id) === Number(task.id))
        || packages.some(p => Number(p.warehouse_task_id) === Number(task.id) && (Number(task.status) === 8 ? Number(p.status) !== 3 : ![2, 3].includes(Number(p.status))))) returned = false
    }
    if (e > a || type === 'sale_order' && (Number(head.status) === 5 && e !== 0 || Number(head.status) === 4 && e === 0)
      || type === 'purchase_return' && Number(head.status) === 4 && e !== 0) throw proof.invalid()
    if (type === 'purchase_return' && Number(head.status) === 3) {
      if (proof.units(lines[0].quantity, true) !== a || !tasks.length || e !== a) throw proof.invalid()
      terminal = returned
    }
  }
  const physicalPending = !returned && (terminal || type === 'purchase_return' && Number(head.status) === 3)
  const reason = physicalPending ? { code: 'RETURN_PENDING', message: '实物归还或任务终结尚未闭合，请先完成原仓库任务' } : !terminal ? { code: 'TARGET_NOT_TERMINATED', message: '原业务尚未终结，请先按原业务完成或取消' } : !returned ? { code: 'RETURN_PENDING', message: '实物归还或任务终结尚未闭合，请先完成原仓库任务' } : null
  return { executedQuantity: e / 100, terminal, returnClosed: returned && terminal, pendingReason: reason, evidence: { version: 1, source: proof.sourceIdentity(source), link: proof.linkIdentity(link), creation, snapshot: contextSnapshot(context), executedQuantity: e / 100, releasedQuantity: (a - e) / 100 } }
}
function contextSnapshot(context) {
  // Evidence is internal and immutable, never returned by source list/detail.
  const keep = (row, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]))
  const headFields = ['id','warehouse_id','order_no','return_no','disposal_no','status','commercial_model','disposal_handling_link_id','task_id','disposed_at','deleted_at','purchase_order_id','purchase_order_no','supplier_id']
  const lineFields = ['id','order_id','return_id','disposal_id','product_id','warehouse_id','unit','quantity','shipped_qty','dispatched_qty','reserved_qty','purchase_item_id','dispose_type']
  const taskFields = ['id','task_no','task_type','sale_order_id','return_id','warehouse_id','status','shipped_at','cancel_requested_at','adjustment_requested_at','deleted_at']
  const logFields = ['id','move_type','type','product_id','warehouse_id','quantity','ref_type','ref_id','ref_no','log_source_type','log_source_ref_id','container_id']
  return { head: keep(context.head, headFields), lines: context.lines.map(r => keep(r, lineFields)), operation: keep(context.operation, ['operation_uuid','action','actor_id','request_key','intent_uuid','payload_hash','payload_json','response_json','source_id','target_type','target_id','target_line_id','resource_type','resource_id','status']), tasks: context.tasks.map(r => keep(r, taskFields)), taskItems: (context.taskItems || []).map(r => keep(r, ['id','task_id','product_id','unit','required_qty','picked_qty','purchase_return_item_id'])), logs: (context.logs || []).map(r => keep(r, logFields)), containers: (context.containers || []).map(r => keep(r, ['id','locked_by_task_id'])), packages: (context.packages || []).map(r => keep(r, ['id','warehouse_task_id','status'])), scrapped: (context.scrapped || []).map(r => keep(r, ['id','disposal_id','disposal_no','product_id','warehouse_id','unit','quantity'])), purchaseItems: (context.purchaseItems || []).map(r => keep(r, ['id','order_id','product_id','unit'])) }
}
function frozen(source, link) {
  try {
    const evidence = JSON.parse(link.release_evidence_json)
    if (rules.stableJson(evidence) !== link.release_evidence_json || evidence.version !== 1 || rules.stableJson(evidence.source) !== rules.stableJson(proof.sourceIdentity(source))
      || rules.stableJson(evidence.link) !== rules.stableJson(proof.linkIdentity(link))) throw proof.invalid()
    // Re-evaluate the versioned frozen rows, not today's expiring logs or mutable line quantities.
    const originalLink = { ...link, state: 'ACTIVE', released_quantity: 0, final_executed_quantity: null }
    const verified = evaluate({ ...evidence.snapshot, source, link: originalLink })
    if (!verified.returnClosed || rules.stableJson(verified.evidence) !== rules.stableJson(evidence)
      || proof.units(evidence.executedQuantity) !== proof.units(link.final_executed_quantity) || proof.units(evidence.releasedQuantity) !== proof.units(link.released_quantity)) throw proof.invalid()
    return verified
  } catch { throw proof.invalid() }
}
async function read(conn, sources, links, { contexts = null } = {}) {
  contexts = contexts || await identities(conn, sources, links)
  const active = links.filter(l => l.state === 'ACTIVE'), tasks = uniq(active.flatMap(l => contexts.get(Number(l.id))?.tasks.map(t => Number(t.id)) || []))
  const taskItems = await selected(conn, 'warehouse_task_items', 'task_id', tasks)
  const containers = await selected(conn, 'inventory_containers', 'locked_by_task_id', tasks)
  const packages = await selected(conn, 'packages', 'warehouse_task_id', tasks)
  const scrapIds = active.filter(l => l.target_type === 'inventory_disposal').map(l => Number(l.target_id))
  const scrapped = await selected(conn, 'disposal_scrapped', 'disposal_id', scrapIds)
  const pri = active.filter(l => l.target_type === 'purchase_return').flatMap(l => contexts.get(Number(l.id))?.lines || [])
  const purchaseItems = await selected(conn, 'purchase_order_items', 'id', uniq(pri.filter(row => proof.id(row.purchase_item_id)).map(row => Number(row.purchase_item_id))))
  const taskNos = uniq(active.flatMap(l => contexts.get(Number(l.id))?.tasks.map(t => t.task_no) || [])), scrapNos = active.filter(l => l.target_type === 'inventory_disposal').map(l => contexts.get(Number(l.id))?.head?.disposal_no).filter(Boolean)
  let logs = []
  if (tasks.length || scrapIds.length) {
    ;[logs] = await conn.query("SELECT * FROM inventory_logs WHERE (ref_type='warehouse_task' AND ref_id IN (?)) OR (log_source_type='sale_task' AND log_source_ref_id IN (?)) OR ref_no IN (?) OR (ref_type='disposal' AND ref_id IN (?)) OR (log_source_type='disposal' AND log_source_ref_id IN (?)) OR ref_no IN (?) ORDER BY id", [tasks.length ? tasks : [0], tasks.length ? tasks : [0], taskNos.length ? taskNos : [''], scrapIds.length ? scrapIds : [0], scrapIds.length ? scrapIds : [0], scrapNos.length ? scrapNos : ['']])
  }
  const results = new Map()
  for (const link of links) {
    const context = contexts.get(Number(link.id))
    try {
      const taskIds = context.tasks.map(t => Number(t.id))
      const result = link.state === 'TERMINATED' ? frozen(context.source, link) : evaluate({ ...context, taskItems: taskItems.filter(r => taskIds.includes(Number(r.task_id))), logs: logs.filter(r => context.tasks.some(t => logCandidate(r, t, link.target_type, context.head)) || link.target_type === 'inventory_disposal' && logCandidate(r, null, link.target_type, context.head)), containers: containers.filter(r => taskIds.includes(Number(r.locked_by_task_id))), packages: packages.filter(r => taskIds.includes(Number(r.warehouse_task_id))), scrapped: scrapped.filter(r => Number(r.disposal_id) === Number(link.target_id)), purchaseItems })
      results.set(Number(link.id), { ...result, context })
    } catch (error) {
      if (error.code !== 'DISPOSAL_HANDLING_FACTS_INVALID' && error.code !== 'DISPOSAL_HANDLING_DATA_INVALID') throw error
      results.set(Number(link.id), { executedQuantity: null, terminal: false, returnClosed: false, pendingReason: { code: 'EXECUTION_UNVERIFIED', message: '原执行证据缺失或不一致，请保留记录人工核对' }, evidence: null, context })
    }
  }
  return results
}
module.exports = { identities, read, evaluate, frozen }
