const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')
const { assertInScope } = require('../../utils/warehouseScope')
const { fmt } = require('./print-jobs.helpers')
const {
  STATUS,
  normalizeBarcodeQueryKeyword,
  normalizeBarcodeRecordStatus,
  deriveInboundBarcodeStatus,
  deriveGenericBarcodeStatus,
  statusKey,
  printStateLabel,
} = require('./print-jobs.status')

async function listJobsByIds(ids, { includeAckToken = false } = {}) {
  const uniq = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))]
  if (!uniq.length) return []
  const [rows] = await pool.query(
    `SELECT j.*, p.code AS printer_code, p.name AS printer_name
     FROM print_jobs j
     LEFT JOIN printers p ON p.id = j.printer_id
     WHERE j.id IN (${uniq.map(() => '?').join(',')})
     ORDER BY j.priority DESC, j.id ASC`,
    uniq,
  )
  return rows.map((row) => fmt(row, {
    includeAckToken,
    statusKey: statusKey(row.status),
    printStateLabel: printStateLabel(row.status),
  }))
}

async function findAll({ printerId, status, page = 1, pageSize = 50, scopeWarehouseIds = null } = {}) {
  const conds = ['1=1']
  const params = []
  if (printerId) { conds.push('j.printer_id=?'); params.push(printerId) }
  if (status !== undefined && status !== null) { conds.push('j.status=?'); params.push(status) }
  // 仓库数据权限（2026-09-18 审计 P2）：打印任务带完整 ZPL 内容（含箱贴/面单与业务条码），
  // 此前列表与详情都不做范围过滤，限仓用户可跨仓读取全部打印内容。
  if (Array.isArray(scopeWarehouseIds)) {
    if (scopeWarehouseIds.length) { conds.push('j.warehouse_id IN (?)'); params.push(scopeWarehouseIds) }
    else conds.push('1=0')
  }
  const where = 'WHERE ' + conds.join(' AND ')
  const offset = (page - 1) * pageSize
  const [rows] = await pool.query(
    `SELECT j.*, p.code AS printer_code, p.name AS printer_name
     FROM print_jobs j
     LEFT JOIN printers p ON p.id = j.printer_id
     ${where} ORDER BY j.priority DESC, j.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM print_jobs j ${where}`, params)
  return {
    list: rows.map((row) => fmt(row, {
      statusKey: statusKey(row.status),
      printStateLabel: printStateLabel(row.status),
    })),
    pagination: { page, pageSize, total },
  }
}

async function findById(id, scopeWarehouseIds = null) {
  const job = await findByIdWithExecutor(pool, id)
  assertInScope(scopeWarehouseIds, job.warehouseId, '打印任务')
  return job
}

async function findByIdWithExecutor(exec, id) {
  const [[row]] = await exec.query(
    `SELECT j.*, p.code AS printer_code, p.name AS printer_name
     FROM print_jobs j LEFT JOIN printers p ON p.id = j.printer_id
     WHERE j.id=?`,
    [id],
  )
  if (!row) throw new AppError('打印任务不存在', 404, 'PRINT_JOB_NOT_FOUND')
  return fmt(row, {
    statusKey: statusKey(row.status),
    printStateLabel: printStateLabel(row.status),
  })
}

async function getStatsCounts() {
  const [[p]] = await pool.query('SELECT COUNT(*) AS c FROM print_jobs WHERE status=?', [STATUS.PENDING])
  const [[f]] = await pool.query('SELECT COUNT(*) AS c FROM print_jobs WHERE status=?', [STATUS.FAILED])
  return { pending: Number(p.c), failed: Number(f.c) }
}

async function listPrinterHealth() {
  const [rows] = await pool.query(
    `SELECT h.printer_id, h.error_rate, h.avg_latency_ms, h.sample_count, h.updated_at,
            p.code AS printer_code, p.name AS printer_name
     FROM printer_health_stats h
     LEFT JOIN printers p ON p.id = h.printer_id
     ORDER BY h.printer_id ASC`,
  )
  return rows.map((r) => ({
    printerId: Number(r.printer_id),
    printerCode: r.printer_code,
    printerName: r.printer_name,
    errorRate: Number(r.error_rate),
    avgLatencyMs: Number(r.avg_latency_ms),
    sampleCount: Number(r.sample_count),
    updatedAt: r.updated_at,
  }))
}

async function findBarcodeRecords({ category, keyword = '', status, page = 1, pageSize = 20, inboundTaskId = null, inboundTaskItemId = null, scopeWarehouseIds = null } = {}) {
  const type = String(category || '').trim().toLowerCase()
  if (!['inbound', 'outbound', 'logistics'].includes(type)) {
    throw new AppError('条码分类无效', 400, 'PRINT_BARCODE_CATEGORY_INVALID')
  }
  const normalizedStatus = normalizeBarcodeRecordStatus(status)
  // 仓库范围必须透传到三个子查询（2026-09-18 审计 P2）：条码补打中心会列出容器/箱贴条码、
  // 商品、供应商与库位，此前无范围过滤，限仓用户可跨仓读取。
  if (type === 'inbound') return findInboundBarcodeRecords({ keyword, status: normalizedStatus, page, pageSize, inboundTaskId, inboundTaskItemId, scopeWarehouseIds })
  if (type === 'outbound') return findOutboundBarcodeRecords({ keyword, status: normalizedStatus, page, pageSize, scopeWarehouseIds })
  return findLogisticsBarcodeRecords({ keyword, status: normalizedStatus, page, pageSize, scopeWarehouseIds })
}

/**
 * 补打中心 = 打印记录（2026-09-14 用户决定）。
 *
 * 列表只列**唯一对象**且**真的生成过打印任务**的记录：入库条码按容器、出库条码按箱贴，
 * 各自要求最近一条 `print_jobs` 存在（物流条码本来就取自 print_jobs）。从未打印过的容器/箱子
 * 不出现在这里——它们的打印入口在业务单据本身（如收货订单详情的「整单 / 明细 / 条码补打」）。
 *
 * 「唯一」的含义（2026-09-14 用户规则）：条码指向一个唯一对象才值得留打印记录，丢了能按记录补打。
 * 因此排除可复用的固定码——塑料盒自身的码（`source_ref_type='plastic_box_create'`，同一个盒子
 * 反复装不同货）不进本页，它在「塑料盒」功能里随时重复打印；货架/库位标签同理（本就不在本页取数）。
 * 拆分产生的散货容器（`container_split` / `sale_order_adjustment_return`）虽然也是 `B` 码，
 * 但每次新建、指向唯一一批货，**照常记录**。
 *
 * 这样「补打」才真的等于重打：点下去为该对象新建一条任务，而不是给一个从没打过标签的
 * 对象凭空造任务（2026-09-14 生产误操作：从未打印过的塑料盒 B000001 被从补打中心打了出去）。
 */
function inboundStatusClause(status, thresholdMinutes) {
  if (!status) return { sql: '', params: [] }
  if (status === 'cancelled') {
    return { sql: 'AND t.status = 5', params: [] }
  }
  if (status === 'no_job') {
    return { sql: 'AND IFNULL(t.status, 0) <> 5 AND pj.id IS NULL', params: [] }
  }
  if (status === 'timeout') {
    return {
      sql: `AND IFNULL(t.status, 0) <> 5
            AND (
              (pj.status IN (?, ?) AND pj.updated_at IS NOT NULL AND pj.updated_at <= DATE_SUB(NOW(), INTERVAL ? MINUTE))
              OR (pj.status = ? AND IFNULL(pj.error_message, '') = ?)
            )`,
      params: [STATUS.PENDING, STATUS.PRINTING, thresholdMinutes, STATUS.FAILED, 'no printer available'],
    }
  }
  if (status === 'success') return { sql: 'AND IFNULL(t.status, 0) <> 5 AND pj.status = ?', params: [STATUS.DONE] }
  if (status === 'failed') {
    return {
      sql: "AND IFNULL(t.status, 0) <> 5 AND pj.status = ? AND IFNULL(pj.error_message, '') <> ?",
      params: [STATUS.FAILED, 'no printer available'],
    }
  }
  if (status === 'printing') {
    return {
      sql: `AND IFNULL(t.status, 0) <> 5
            AND pj.status = ?
            AND (pj.updated_at IS NULL OR pj.updated_at > DATE_SUB(NOW(), INTERVAL ? MINUTE))`,
      params: [STATUS.PRINTING, thresholdMinutes],
    }
  }
  if (status === 'queued') {
    return {
      sql: `AND IFNULL(t.status, 0) <> 5
            AND pj.id IS NOT NULL
            AND pj.status = ?
            AND (pj.updated_at IS NULL OR pj.updated_at > DATE_SUB(NOW(), INTERVAL ? MINUTE))`,
      params: [STATUS.PENDING, thresholdMinutes],
    }
  }
  return { sql: '', params: [] }
}

function genericStatusClause(status, alias = 'j') {
  if (!status) return { sql: '', params: [] }
  if (status === 'no_job') return { sql: `AND ${alias}.id IS NULL`, params: [] }
  if (status === 'timeout') return { sql: `AND ${alias}.status = ? AND IFNULL(${alias}.error_message, '') = ?`, params: [STATUS.FAILED, 'no printer available'] }
  if (status === 'success') return { sql: `AND ${alias}.status = ?`, params: [STATUS.DONE] }
  if (status === 'failed') return { sql: `AND ${alias}.status = ? AND IFNULL(${alias}.error_message, '') <> ?`, params: [STATUS.FAILED, 'no printer available'] }
  if (status === 'printing') return { sql: `AND ${alias}.status = ?`, params: [STATUS.PRINTING] }
  if (status === 'queued') return { sql: `AND ${alias}.id IS NOT NULL AND ${alias}.status = ?`, params: [STATUS.PENDING] }
  if (status === 'cancelled') return { sql: 'AND 1=0', params: [] }
  return { sql: '', params: [] }
}

/**
 * 仓库范围 → SQL 谓词与参数（2026-09-18 审计 P2）。
 * 返回的 sql 是不含 AND 的完整谓词；调用方决定拼成 `AND <sql>` 还是 `<sql> AND `。
 * 调用方必须把 params 插到与 sql 在语句中相同的相对位置，否则会静默绑错值。
 */
function warehouseScopePredicate(scopeWarehouseIds, column) {
  if (!Array.isArray(scopeWarehouseIds)) return { sql: '', params: [] }
  if (!scopeWarehouseIds.length) return { sql: '1=0', params: [] }
  return { sql: `${column} IN (?)`, params: [scopeWarehouseIds] }
}

async function findInboundBarcodeRecords({ keyword = '', status, page = 1, pageSize = 20, inboundTaskId = null, inboundTaskItemId = null, scopeWarehouseIds = null } = {}) {
  const thresholds = await getInboundClosureThresholds()
  const timeoutMinutes = Number(thresholds.printTimeoutMinutes || 30)
  const like = `%${normalizeBarcodeQueryKeyword(keyword)}%`
  const inboundTaskIdNum = Number(inboundTaskId)
  const inboundTaskItemIdNum = Number(inboundTaskItemId)
  const inboundFilterSql = []
  const inboundFilterParams = []
  if (Number.isFinite(inboundTaskIdNum) && inboundTaskIdNum > 0) {
    inboundFilterSql.push('AND c.inbound_task_id = ?')
    inboundFilterParams.push(inboundTaskIdNum)
  }
  if (Number.isFinite(inboundTaskItemIdNum) && inboundTaskItemIdNum > 0) {
    inboundFilterSql.push('AND EXISTS (SELECT 1 FROM inbound_task_items iti WHERE iti.task_id = c.inbound_task_id AND iti.id = ? AND iti.product_id = c.product_id)')
    inboundFilterParams.push(inboundTaskItemIdNum)
  }
  // 仓库范围：片段追加在 inboundFilterSql 末尾、参数追加在 inboundFilterParams 末尾，
  // 两者在 SQL 与 params 中的相对位置一致，因此主查询与计数查询都能直接复用
  const inboundScope = warehouseScopePredicate(scopeWarehouseIds, 'c.warehouse_id')
  if (inboundScope.sql) {
    inboundFilterSql.push('AND ' + inboundScope.sql)
    inboundFilterParams.push(...inboundScope.params)
  }

  const offset = (page - 1) * pageSize
  const statusClause = inboundStatusClause(status, timeoutMinutes)
  const [rows] = await pool.query(
    `SELECT
        c.id AS record_id,
        c.barcode,
        CASE WHEN c.container_type = 2 OR c.barcode LIKE 'B%' THEN 'plastic_box' ELSE 'inventory' END AS container_kind,
        c.status AS container_status,
        c.remaining_qty,
        c.created_at AS barcode_created_at,
        p.id AS product_id,
        p.code AS product_code,
        p.name AS product_name,
        p.unit,
        t.id AS inbound_task_id,
        t.task_no AS inbound_task_no,
        t.status AS inbound_task_status,
        t.supplier_name,
        (
          SELECT CASE WHEN COUNT(*) = 1 THEN MAX(iti.id) ELSE NULL END
          FROM inbound_task_items iti
          WHERE iti.task_id = c.inbound_task_id AND iti.product_id = c.product_id
        ) AS inbound_task_item_id,
        w.id AS warehouse_id,
        w.name AS warehouse_name,
        loc.code AS location_code,
        pj.id AS print_job_id,
        pj.status AS print_status,
        pj.error_message,
        pj.printer_id,
        pj.created_at AS print_created_at,
        pj.updated_at AS print_updated_at,
        pj.dispatch_reason,
        pj.printer_code,
        pj.printer_name
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     LEFT JOIN inbound_tasks t ON t.id = c.inbound_task_id
     LEFT JOIN inventory_warehouses w ON w.id = c.warehouse_id
     LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
     LEFT JOIN (
       SELECT j.*, pr.code AS printer_code, pr.name AS printer_name
       FROM print_jobs j
       LEFT JOIN printers pr ON pr.id = j.printer_id
       INNER JOIN (
         SELECT ref_id, MAX(id) AS max_id
         FROM print_jobs
         WHERE ref_type = 'inventory_container'
         GROUP BY ref_id
       ) latest ON latest.max_id = j.id
     ) pj ON pj.ref_id = c.id
     WHERE c.deleted_at IS NULL
       AND (c.is_legacy = 0 OR c.is_legacy IS NULL)
       ${inboundFilterSql.join(' ')}
       AND (
         c.barcode LIKE ?
         OR IFNULL(p.code, '') LIKE ?
         OR IFNULL(p.name, '') LIKE ?
         OR IFNULL(t.task_no, '') LIKE ?
       )
       AND pj.id IS NOT NULL
       AND IFNULL(c.source_ref_type, '') <> 'plastic_box_create'
       ${statusClause.sql}
     ORDER BY c.id DESC
     LIMIT ? OFFSET ?`,
    [...inboundFilterParams, like, like, like, like, ...statusClause.params, pageSize, offset],
  )

  const mapped = rows.map((row) => {
    const derived = deriveInboundBarcodeStatus(row, thresholds)
    return {
      category: 'inbound',
      recordId: Number(row.record_id),
      inboundTaskId: row.inbound_task_id != null ? Number(row.inbound_task_id) : null,
      inboundTaskItemId: row.inbound_task_item_id != null ? Number(row.inbound_task_item_id) : null,
      barcode: row.barcode,
      barcodeLabel: '入库条码',
      barcodeKind: row.container_kind === 'plastic_box' ? '塑料盒条码' : '库存条码',
      bizNo: row.inbound_task_no || null,
      title: row.product_name || row.barcode,
      subtitle: row.product_code ? `${row.product_code}${row.unit ? ` / ${row.unit}` : ''}` : (row.unit || null),
      extraInfo: row.supplier_name || null,
      warehouseName: row.warehouse_name || null,
      locationCode: row.location_code || null,
      qty: Number(row.remaining_qty),
      createdAt: row.barcode_created_at,
      latestJob: row.print_job_id
        ? {
            id: Number(row.print_job_id),
            status: Number(row.print_status),
            statusKey: derived.statusKey,
            printStateLabel: derived.printStateLabel,
            printerId: row.printer_id != null ? Number(row.printer_id) : null,
            printerCode: row.printer_code ?? null,
            printerName: row.printer_name ?? null,
            errorMessage: row.error_message ?? null,
            dispatchReason: row.dispatch_reason ?? null,
            createdAt: row.print_created_at,
            updatedAt: row.print_updated_at,
          }
        : null,
      canReprint: true,
    }
  })
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     LEFT JOIN inbound_tasks t ON t.id = c.inbound_task_id
     LEFT JOIN (
       SELECT j.*
       FROM print_jobs j
       INNER JOIN (
         SELECT ref_id, MAX(id) AS max_id
         FROM print_jobs
         WHERE ref_type = 'inventory_container'
         GROUP BY ref_id
       ) latest ON latest.max_id = j.id
     ) pj ON pj.ref_id = c.id
     WHERE c.deleted_at IS NULL
       AND (c.is_legacy = 0 OR c.is_legacy IS NULL)
       ${inboundFilterSql.join(' ')}
       AND (
         c.barcode LIKE ?
         OR IFNULL(p.code, '') LIKE ?
         OR IFNULL(p.name, '') LIKE ?
         OR IFNULL(t.task_no, '') LIKE ?
       )
       AND pj.id IS NOT NULL
       AND IFNULL(c.source_ref_type, '') <> 'plastic_box_create'
       ${statusClause.sql}`,
    [...inboundFilterParams, like, like, like, like, ...statusClause.params],
  )
  return {
    list: mapped,
    pagination: { page, pageSize, total: Number(total) },
  }
}

async function findOutboundBarcodeRecords({ keyword = '', status, page = 1, pageSize = 20, scopeWarehouseIds = null } = {}) {
  const outboundScope = warehouseScopePredicate(scopeWarehouseIds, 'wt.warehouse_id')
  const like = `%${normalizeBarcodeQueryKeyword(keyword)}%`
  const offset = (page - 1) * pageSize
  const statusClause = genericStatusClause(status, 'pj')

  const [rows] = await pool.query(
    `SELECT
        p.id AS record_id,
        p.barcode,
        p.status AS package_status,
        p.created_at AS barcode_created_at,
        wt.id AS warehouse_task_id,
        wt.task_no,
        wt.customer_name,
        wt.warehouse_name,
        pw.id AS wave_id,
        pw.wave_no,
        (
          SELECT COUNT(*) FROM package_items pi WHERE pi.package_id = p.id
        ) AS line_count,
        (
          SELECT COALESCE(SUM(pi.qty), 0) FROM package_items pi WHERE pi.package_id = p.id
        ) AS total_qty,
        pj.id AS print_job_id,
        pj.status AS print_status,
        pj.error_message,
        pj.printer_id,
        pj.created_at AS print_created_at,
        pj.updated_at AS print_updated_at,
        pj.dispatch_reason,
        pj.printer_code,
        pj.printer_name
     FROM packages p
     INNER JOIN warehouse_tasks wt ON wt.id = p.warehouse_task_id
     LEFT JOIN picking_wave_tasks pwt ON pwt.task_id = wt.id
     LEFT JOIN picking_waves pw ON pw.id = pwt.wave_id
     LEFT JOIN (
       SELECT j.*, pr.code AS printer_code, pr.name AS printer_name
       FROM print_jobs j
       LEFT JOIN printers pr ON pr.id = j.printer_id
       INNER JOIN (
         SELECT ref_id, MAX(id) AS max_id
         FROM print_jobs
         WHERE ref_type = 'package'
         GROUP BY ref_id
       ) latest ON latest.max_id = j.id
     ) pj ON pj.ref_id = p.id
     WHERE ${outboundScope.sql ? outboundScope.sql + ' AND ' : ''}(
          p.barcode LIKE ?
          OR IFNULL(wt.task_no, '') LIKE ?
          OR IFNULL(wt.customer_name, '') LIKE ?
       )
       AND pj.id IS NOT NULL
       ${statusClause.sql}
     ORDER BY p.id DESC
     LIMIT ? OFFSET ?`,
    [...outboundScope.params, like, like, like, ...statusClause.params, pageSize, offset],
  )
  const mapped = rows.map((row) => {
    const derived = deriveGenericBarcodeStatus(row)
    return {
      category: 'outbound',
      recordId: Number(row.record_id),
      warehouseTaskId: row.warehouse_task_id != null ? Number(row.warehouse_task_id) : null,
      waveId: row.wave_id != null ? Number(row.wave_id) : null,
      waveNo: row.wave_no ?? null,
      barcode: row.barcode,
      barcodeLabel: '出库条码',
      barcodeKind: '箱贴条码',
      bizNo: row.task_no || null,
      title: row.customer_name || row.barcode,
      subtitle: `${Number(row.line_count)} 行 / ${Number(row.total_qty)} 件`,
      extraInfo: row.task_no || null,
      warehouseName: row.warehouse_name || null,
      locationCode: null,
      qty: Number(row.total_qty),
      createdAt: row.barcode_created_at,
      latestJob: row.print_job_id
        ? {
            id: Number(row.print_job_id),
            status: Number(row.print_status),
            statusKey: derived.statusKey,
            printStateLabel: derived.printStateLabel,
            printerId: row.printer_id != null ? Number(row.printer_id) : null,
            printerCode: row.printer_code ?? null,
            printerName: row.printer_name ?? null,
            errorMessage: row.error_message ?? null,
            dispatchReason: row.dispatch_reason ?? null,
            createdAt: row.print_created_at,
            updatedAt: row.print_updated_at,
          }
        : null,
      canReprint: true,
    }
  })

  const [[{ total: totalRaw }]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM packages p
     INNER JOIN warehouse_tasks wt ON wt.id = p.warehouse_task_id
     LEFT JOIN (
       SELECT j.*
       FROM print_jobs j
       INNER JOIN (
         SELECT ref_id, MAX(id) AS max_id
         FROM print_jobs
         WHERE ref_type = 'package'
         GROUP BY ref_id
       ) latest ON latest.max_id = j.id
     ) pj ON pj.ref_id = p.id
     WHERE ${outboundScope.sql ? outboundScope.sql + ' AND ' : ''}(
          p.barcode LIKE ?
          OR IFNULL(wt.task_no, '') LIKE ?
          OR IFNULL(wt.customer_name, '') LIKE ?
       )
       AND pj.id IS NOT NULL
       ${statusClause.sql}`,
    [...outboundScope.params, like, like, like, ...statusClause.params],
  )

  return {
    list: mapped,
    pagination: { page, pageSize, total: Number(totalRaw) },
  }
}

async function findLogisticsBarcodeRecords({ keyword = '', status, page = 1, pageSize = 20, scopeWarehouseIds = null } = {}) {
  const logisticsScope = warehouseScopePredicate(scopeWarehouseIds, 'j.warehouse_id')
  const like = `%${normalizeBarcodeQueryKeyword(keyword)}%`
  const offset = (page - 1) * pageSize
  const statusClause = genericStatusClause(status, 'j')
  const [rows] = await pool.query(
    `SELECT j.*, p.code AS printer_code, p.name AS printer_name
     FROM print_jobs j
     LEFT JOIN printers p ON p.id = j.printer_id
     WHERE ${logisticsScope.sql ? logisticsScope.sql + ' AND ' : ''}(j.ref_type = 'waybill' OR j.job_type = 'waybill')
       AND (
         IFNULL(j.ref_code, '') LIKE ?
         OR IFNULL(j.title, '') LIKE ?
       )
       ${statusClause.sql}
     ORDER BY j.id DESC
     LIMIT ? OFFSET ?`,
    [...logisticsScope.params, like, like, ...statusClause.params, pageSize, offset],
  )
  const mapped = rows.map((row) => {
    const derived = deriveGenericBarcodeStatus(row)
    return {
      category: 'logistics',
      recordId: Number(row.id),
      barcode: row.ref_code || row.title,
      barcodeLabel: '物流条码',
      barcodeKind: '物流标签',
      bizNo: row.ref_code || null,
      title: row.title,
      subtitle: row.ref_code || null,
      extraInfo: null,
      warehouseName: null,
      locationCode: null,
      qty: row.copies != null ? Number(row.copies) : 1,
      createdAt: row.created_at,
      latestJob: {
        id: Number(row.id),
        status: Number(row.status),
        statusKey: derived.statusKey,
        printStateLabel: derived.printStateLabel,
        printerId: row.printer_id != null ? Number(row.printer_id) : null,
        printerCode: row.printer_code ?? null,
        printerName: row.printer_name ?? null,
        errorMessage: row.error_message ?? null,
        dispatchReason: row.dispatch_reason ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      canReprint: true,
    }
  })
  const [[{ total: totalRaw }]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM print_jobs j
     WHERE ${logisticsScope.sql ? logisticsScope.sql + ' AND ' : ''}(j.ref_type = 'waybill' OR j.job_type = 'waybill')
       AND (
         IFNULL(j.ref_code, '') LIKE ?
         OR IFNULL(j.title, '') LIKE ?
       )
       ${statusClause.sql}`,
    [...logisticsScope.params, like, like, ...statusClause.params],
  )

  return {
    list: mapped,
    pagination: { page, pageSize, total: Number(totalRaw) },
  }
}

module.exports = {
  listJobsByIds,
  findAll,
  findById,
  getStatsCounts,
  listPrinterHealth,
  findBarcodeRecords,
  findByIdWithExecutor,
}
