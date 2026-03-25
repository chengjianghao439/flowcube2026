/**
 * 多租户打印调度：绑定/兜底 → 本租户负载 → 设备分（错误率/延迟/心跳）→ 自适应探索选次优
 */
const { pool } = require('../../config/db')
const { getHealthMap } = require('./printer-health')
const { getTenantPrintPolicy } = require('./print-tenant-settings.service')
const {
  heartbeatScore,
  printerScore,
  computeExplorationRate,
  pickWithExploration,
} = require('./print-policy')

function tenantSqlParam(tenantId) {
  const t = Number(tenantId) >= 0 ? Number(tenantId) : 0
  return t
}

/** contentType / 业务 type → printer_bindings.print_type */
function normalizeJobType(jobType, contentType) {
  const j = String(jobType || '').trim().toLowerCase()
  if (j === 'container_label') return 'inventory_label'
  if (j === 'pda_label' || j === 'label') return 'product_label'
  if (['waybill', 'product_label', 'inventory_label'].includes(j)) return j
  const ct = String(contentType || '').toLowerCase()
  if (ct === 'zpl') return 'product_label'
  return j || 'product_label'
}

function printerTypeForContentType(contentType) {
  const ct = String(contentType || '').toLowerCase()
  if (ct === 'zpl') return 1
  if (ct === 'html' || ct === 'pdf') return 3
  return 1
}

async function fetchHeartbeatMap(printerIds) {
  const ids = [...new Set(printerIds.map(Number).filter((n) => n > 0))]
  if (!ids.length) return new Map()
  const [rows] = await pool.query(
    `SELECT p.id, pc.last_seen
     FROM printers p
     LEFT JOIN print_clients pc ON pc.client_id = p.client_id
     WHERE p.id IN (${ids.map(() => '?').join(',')})`,
    ids,
  )
  return new Map(rows.map((r) => [Number(r.id), r.last_seen]))
}

/**
 * @param {{
 *   tenantId?: number,
 *   warehouseId?: number|null,
 *   jobType?: string|null,
 *   contentType?: string
 * }} opts
 * @returns {Promise<{ printerId: number|null, dispatchReason: string|null, explorationRate?: number }>}
 */
async function resolvePrinterForJob({ tenantId = 0, warehouseId, jobType, contentType }) {
  const tid = tenantSqlParam(tenantId)
  const wh = warehouseId != null && warehouseId !== '' ? Number(warehouseId) : null
  const ptype = normalizeJobType(jobType, contentType)
  const whNum = Number.isFinite(wh) && wh > 0 ? wh : null

  let candidates = []
  let fromBinding = false

  if (ptype) {
    const params = [ptype, tid, tid]
    let sql = `SELECT b.printer_id FROM printer_bindings b
     WHERE b.print_type = ? AND (b.tenant_id = ? OR b.tenant_id = 0)`
    if (whNum) {
      sql += ` AND (b.warehouse_id = 0 OR b.warehouse_id = ?)`
      params.push(whNum)
    } else {
      sql += ` AND b.warehouse_id = 0`
    }
    if (whNum) {
      sql += ` ORDER BY CASE WHEN b.warehouse_id = ? THEN 0 ELSE 1 END, CASE WHEN b.tenant_id = ? THEN 0 ELSE 1 END, b.printer_id ASC`
      params.push(whNum, tid)
    } else {
      sql += ` ORDER BY CASE WHEN b.tenant_id = ? THEN 0 ELSE 1 END, b.printer_id ASC`
      params.push(tid)
    }
    const [bindRows] = await pool.query(sql, params)
    candidates = bindRows.map((r) => Number(r.printer_id)).filter(Boolean)
    fromBinding = candidates.length > 0
  }

  if (!candidates.length) {
    const type = printerTypeForContentType(contentType)
    const params = [type, tid, tid]
    let sql = `SELECT p.id FROM printers p
     WHERE p.status = 1 AND p.type = ? AND (p.tenant_id = ? OR p.tenant_id = 0)`
    if (whNum) {
      sql += ' AND (p.warehouse_id IS NULL OR p.warehouse_id = ?)'
      params.push(whNum)
    }
    sql += ' ORDER BY p.id ASC LIMIT 16'
    const [rows] = await pool.query(sql, params)
    candidates = rows.map((r) => Number(r.id))
  }

  if (!candidates.length) return { printerId: null, dispatchReason: null }

  const uniq = [...new Set(candidates)]
  const dispatchPolicy = await getTenantPrintPolicy(tid)
  const healthMap = await getHealthMap(tid, uniq)
  const explorationRate = computeExplorationRate(healthMap, uniq, dispatchPolicy)
  const hbMap = await fetchHeartbeatMap(uniq)

  const [loads] = await pool.query(
    `SELECT printer_id, COUNT(*) AS load_cnt
     FROM print_jobs
     WHERE tenant_id = ? AND status IN (0, 1) AND printer_id IN (${uniq.map(() => '?').join(',')})
     GROUP BY printer_id`,
    [tid, ...uniq],
  )
  const loadMap = new Map(loads.map((r) => [Number(r.printer_id), Number(r.load_cnt)]))

  uniq.sort((a, b) => {
    const la = loadMap.get(a) ?? 0
    const lb = loadMap.get(b) ?? 0
    if (la !== lb) return la - lb
    const ha = healthMap.get(a)
    const hb = healthMap.get(b)
    const sa = printerScore(ha, heartbeatScore(hbMap.get(a)), dispatchPolicy)
    const sb = printerScore(hb, heartbeatScore(hbMap.get(b)), dispatchPolicy)
    if (sb !== sa) return sb - sa
    return a - b
  })

  const onlineOrdered = []
  for (const id of uniq) {
    const [[o]] = await pool.query(
      `SELECT id FROM printers WHERE id = ? AND status = 1 AND (tenant_id = ? OR tenant_id = 0) LIMIT 1`,
      [id, tid],
    )
    if (o) onlineOrdered.push(id)
  }

  if (!onlineOrdered.length) return { printerId: null, dispatchReason: null }

  const chosen = pickWithExploration(onlineOrdered, explorationRate)
  const multi = uniq.length > 1
  const dispatchReason = fromBinding
    ? (multi ? 'load_balance' : 'binding')
    : (multi ? 'load_balance' : 'fallback')

  return { printerId: chosen, dispatchReason, explorationRate }
}

module.exports = {
  normalizeJobType,
  resolvePrinterForJob,
  printerTypeForContentType,
}
