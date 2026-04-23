const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')
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

async function findAll({ printerId, status, page = 1, pageSize = 50 } = {}) {
  const conds = ['1=1']
  const params = []
  if (printerId) { conds.push('j.printer_id=?'); params.push(printerId) }
  if (status !== undefined && status !== null) { conds.push('j.status=?'); params.push(status) }
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

async function findById(id) {
  return findByIdWithExecutor(pool, id)
}

async function findByIdWithExecutor(exec, id) {
  const [[row]] = await exec.query(
    `SELECT j.*, p.code AS printer_code, p.name AS printer_name
     FROM print_jobs j LEFT JOIN printers p ON p.id = j.printer_id
     WHERE j.id=?`,
    [id],
  )
  if (!row) throw new AppError('打印任务不存在', 404)
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

async function findBarcodeRecords({ category, keyword = '', status, page = 1, pageSize = 20, inboundTaskId = null, inboundTaskItemId = null } = {}) {
  const type = String(category || '').trim().toLowerCase()
  if (!['inbound', 'outbound', 'logistics'].includes(type)) {
    throw new AppError('条码分类无效', 400)
  }
  const normalizedStatus = normalizeBarcodeRecordStatus(status)
  if (type === 'inbound') return findInboundBarcodeRecords({ keyword, status: normalizedStatus, page, pageSize, inboundTaskId, inboundTaskItemId })
  if (type === 'outbound') return findOutboundBarcodeRecords({ keyword, status: normalizedStatus, page, pageSize })
  return findLogisticsBarcodeRecords({ keyword, status: normalizedStatus, page, pageSize })
}

async function findInboundBarcodeRecords({ keyword = '', status, page = 1, pageSize = 20, inboundTaskId = null, inboundTaskItemId = null } = {}) {
  const thresholds = await getInboundClosureThresholds()
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

  const offset = (page - 1) * pageSize
  const paginateSql = status ? '' : 'LIMIT ? OFFSET ?'
  const paginateParams = status ? [] : [pageSize, offset]
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
     ORDER BY c.id DESC
     ${paginateSql}`,
    [...inboundFilterParams, like, like, like, like, ...paginateParams],
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
  const filtered = status ? mapped.filter(row => (row.latestJob?.statusKey ?? 'queued') === status) : mapped
  const total = status
    ? filtered.length
    : Number((await pool.query(
      `SELECT COUNT(*) AS total
       FROM inventory_containers c
       LEFT JOIN product_items p ON p.id = c.product_id
       LEFT JOIN inbound_tasks t ON t.id = c.inbound_task_id
       WHERE c.deleted_at IS NULL
         AND (c.is_legacy = 0 OR c.is_legacy IS NULL)
         ${inboundFilterSql.join(' ')}
         AND (
           c.barcode LIKE ?
           OR IFNULL(p.code, '') LIKE ?
           OR IFNULL(p.name, '') LIKE ?
           OR IFNULL(t.task_no, '') LIKE ?
         )`,
      [...inboundFilterParams, like, like, like, like],
    ))[0][0].total)
  return {
    list: status ? filtered.slice(offset, offset + pageSize) : filtered,
    pagination: { page, pageSize, total },
  }
}

async function findOutboundBarcodeRecords({ keyword = '', status, page = 1, pageSize = 20 } = {}) {
  const like = `%${normalizeBarcodeQueryKeyword(keyword)}%`
  const offset = (page - 1) * pageSize
  const paginateSql = status ? '' : 'LIMIT ? OFFSET ?'
  const paginateParams = status ? [] : [pageSize, offset]

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
     WHERE p.barcode LIKE ?
        OR IFNULL(wt.task_no, '') LIKE ?
        OR IFNULL(wt.customer_name, '') LIKE ?
     ORDER BY p.id DESC
     ${paginateSql}`,
    [like, like, like, ...paginateParams],
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

  const filtered = status ? mapped.filter(row => (row.latestJob?.statusKey ?? 'queued') === status) : mapped
  const [[{ total: totalRaw }]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM packages p
     INNER JOIN warehouse_tasks wt ON wt.id = p.warehouse_task_id
     WHERE p.barcode LIKE ?
        OR IFNULL(wt.task_no, '') LIKE ?
        OR IFNULL(wt.customer_name, '') LIKE ?`,
    [like, like, like],
  )

  return {
    list: status ? filtered.slice(offset, offset + pageSize) : filtered,
    pagination: { page, pageSize, total: status ? filtered.length : Number(totalRaw) },
  }
}

async function findLogisticsBarcodeRecords({ keyword = '', status, page = 1, pageSize = 20 } = {}) {
  const like = `%${normalizeBarcodeQueryKeyword(keyword)}%`
  const offset = (page - 1) * pageSize
  const paginateSql = status ? '' : 'LIMIT ? OFFSET ?'
  const paginateParams = status ? [] : [pageSize, offset]
  const [rows] = await pool.query(
    `SELECT j.*, p.code AS printer_code, p.name AS printer_name
     FROM print_jobs j
     LEFT JOIN printers p ON p.id = j.printer_id
     WHERE (j.ref_type = 'waybill' OR j.job_type = 'waybill')
       AND (
         IFNULL(j.ref_code, '') LIKE ?
         OR IFNULL(j.title, '') LIKE ?
       )
     ORDER BY j.id DESC
     ${paginateSql}`,
    [like, like, ...paginateParams],
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
  const filtered = status ? mapped.filter(row => (row.latestJob?.statusKey ?? 'queued') === status) : mapped
  const [[{ total: totalRaw }]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM print_jobs j
     WHERE (j.ref_type = 'waybill' OR j.job_type = 'waybill')
       AND (
         IFNULL(j.ref_code, '') LIKE ?
         OR IFNULL(j.title, '') LIKE ?
       )`,
    [like, like],
  )

  return {
    list: status ? filtered.slice(offset, offset + pageSize) : filtered,
    pagination: { page, pageSize, total: status ? filtered.length : Number(totalRaw) },
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
