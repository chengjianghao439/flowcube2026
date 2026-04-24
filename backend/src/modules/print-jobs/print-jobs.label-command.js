const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')
const { resolvePrinterForJob } = require('./print-dispatch')
const { getLabelZplFromDefaultTemplate } = require('./labelZplTemplate')
const {
  buildRackLabelTspl,
  buildContainerLabelTspl,
  buildPackageLabelTspl,
  buildProductLabelTspl,
  getLabelTsplFromDefaultTemplate,
} = require('./labelTsplTemplate')
const {
  buildContainerLabelZpl,
  buildRackLabelZpl,
  buildPackageLabelZpl,
  buildProductLabelZpl,
} = require('./print-jobs.template')
const { create, createWithinTransaction } = require('./print-jobs.command')
const { findById } = require('./print-jobs.query')
const { getDispatchHintForJob } = require('./print-jobs.dispatch')

async function getPrinterLabelRawFormat(printerId) {
  const id = Number(printerId)
  if (!Number.isFinite(id) || id <= 0) return 'zpl'
  const [[row]] = await pool.query('SELECT label_raw_format FROM printers WHERE id=?', [id])
  const f = String(row?.label_raw_format || 'zpl').toLowerCase()
  return f === 'tspl' ? 'tspl' : 'zpl'
}

async function resolveLabelPrinterId() {
  const code = (process.env.INBOUND_LABEL_PRINTER_CODE || process.env.PDA_LABEL_PRINTER_CODE || '').trim()
  if (code) {
    const [[byCode]] = await pool.query(
      'SELECT id, code FROM printers WHERE code = ? AND status = 1',
      [code],
    )
    if (byCode) return byCode.id
    logger.warn(`[print] 环境变量指定的标签机 code=${code} 不存在或未在线，将尝试使用默认标签机`, {}, 'PrintJobs')
  }
  const [[first]] = await pool.query(
    `SELECT id, code FROM printers WHERE status = 1 AND type = 1
     ORDER BY id ASC LIMIT 1`,
  )
  return first?.id ?? null
}

async function resolveLabelPrinter({ warehouseId, jobType }) {
  const wh = warehouseId != null ? Number(warehouseId) : null
  const resolved = await resolvePrinterForJob({
    warehouseId: Number.isFinite(wh) && wh > 0 ? wh : undefined,
    jobType,
    contentType: 'zpl',
  })
  let printerId = resolved.printerId
  let dispatchReason = resolved.dispatchReason || 'fallback'
  if (!printerId) {
    printerId = await resolveLabelPrinterId()
    dispatchReason = 'fallback'
  }
  return { printerId, dispatchReason }
}

async function buildLabelBody({ printerId, templateType, vars, tsplBuilder, zplBuilder }) {
  const labelFmt = await getPrinterLabelRawFormat(printerId)
  const useTspl = labelFmt === 'tspl'
  const content = useTspl
    ? (await getLabelTsplFromDefaultTemplate(templateType, vars)) ?? tsplBuilder(vars)
    : (await getLabelZplFromDefaultTemplate(templateType, vars)) ?? zplBuilder(vars)
  return {
    contentType: useTspl ? 'tspl' : 'zpl',
    content,
  }
}

async function enqueueContainerLabelJob(payload) {
  const data = payload?.data
  if (!data?.container_code) return null
  const conn = payload?.conn || null
  const containerId =
    payload?.containerId != null && Number.isFinite(Number(payload.containerId)) ? Number(payload.containerId) : null
  const wh = payload.warehouseId != null ? Number(payload.warehouseId) : null
  const { printerId, dispatchReason } = await resolveLabelPrinter({
    warehouseId: wh,
    jobType: 'container_label',
  })
  if (!printerId) return null
  const vars = {
    container_code: data.container_code,
    product_name: data.product_name,
    qty: data.qty,
  }
  const label = await buildLabelBody({
    printerId,
    templateType: 6,
    vars,
    tsplBuilder: buildContainerLabelTspl,
    zplBuilder: buildContainerLabelZpl,
  })
  const createJob = conn ? createWithinTransaction.bind(null, conn) : create
  return createJob({
    printerId,
    dispatchReason,
    warehouseId: Number.isFinite(wh) && wh > 0 ? wh : null,
    jobType: 'container_label',
    title: `容器标 ${data.container_code}`,
    contentType: label.contentType,
    content: label.content,
    copies: 1,
    createdBy: payload.createdBy ?? null,
    jobUniqueKey: payload.jobUniqueKey,
    refType: containerId ? 'inventory_container' : null,
    refId: containerId,
    refCode: data.container_code,
  })
}

async function enqueueRackLabelJob(payload) {
  const rackId = payload?.rackId
  if (!rackId) return null
  let row
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.barcode, r.code, r.zone, r.name, r.warehouse_id
       FROM warehouse_racks r
       WHERE r.id = ? AND r.deleted_at IS NULL`,
      [rackId],
    )
    row = rows[0]
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR' || /Unknown column ['`]?barcode/i.test(String(e.message))) {
      throw new AppError('数据库缺少 warehouse_racks.barcode，请执行迁移 051_warehouse_racks_barcode.sql', 503, 'DB_CONFIG_MISSING')
    }
    throw e
  }
  if (!row || !row.barcode) return null
  const wh = row.warehouse_id != null ? Number(row.warehouse_id) : null
  const { printerId, dispatchReason } = await resolveLabelPrinter({
    warehouseId: wh,
    jobType: 'rack_label',
  })
  if (!printerId) return null
  const vars = {
    rack_barcode: row.barcode,
    rack_code: row.code,
    zone: row.zone,
    name: row.name,
  }
  const label = await buildLabelBody({
    printerId,
    templateType: 5,
    vars,
    tsplBuilder: buildRackLabelTspl,
    zplBuilder: buildRackLabelZpl,
  })
  try {
    const job = await create({
      printerId,
      dispatchReason,
      warehouseId: Number.isFinite(wh) && wh > 0 ? wh : null,
      jobType: 'rack_label',
      title: `货架标 ${row.barcode}`,
      contentType: label.contentType,
      content: label.content,
      copies: 1,
      createdBy: payload.createdBy ?? null,
      jobUniqueKey: payload.jobUniqueKey ?? null,
    })
    const dispatchHint = await getDispatchHintForJob(job.printerCode, job.id)
    return {
      id: job.id,
      printerCode: job.printerCode,
      printerName: job.printerName,
      dispatchHint,
      contentType: label.contentType,
      content: label.content,
    }
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR' || /Unknown column/i.test(String(e.message))) {
      throw new AppError('打印入库失败：数据库字段异常，请先执行迁移或联系管理员', 503, 'DB_CONFIG_MISSING')
    }
    throw e
  }
}

async function enqueuePackageLabelJob(payload) {
  const packageId = payload?.packageId
  if (!packageId) return null
  const conn = payload?.conn || null
  const exec = conn || pool
  const [[row]] = await exec.query(
    `SELECT p.id, p.barcode, wt.task_no, wt.customer_name, wt.warehouse_id,
            (SELECT COUNT(*) FROM package_items pi WHERE pi.package_id = p.id) AS line_count,
            (SELECT COALESCE(SUM(pi.qty), 0) FROM package_items pi WHERE pi.package_id = p.id) AS total_qty
     FROM packages p
     JOIN warehouse_tasks wt ON wt.id = p.warehouse_task_id
     WHERE p.id = ?`,
    [packageId],
  )
  if (!row) return null
  const wh = row.warehouse_id != null ? Number(row.warehouse_id) : null
  const summary = `${Number(row.line_count)} 行 / ${Number(row.total_qty)} 件`
  const { printerId, dispatchReason } = await resolveLabelPrinter({
    warehouseId: wh,
    jobType: 'package_label',
  })
  if (!printerId) return null
  const vars = {
    box_code: row.barcode,
    task_no: row.task_no,
    customer_name: row.customer_name,
    summary,
  }
  const label = await buildLabelBody({
    printerId,
    templateType: 7,
    vars,
    tsplBuilder: buildPackageLabelTspl,
    zplBuilder: buildPackageLabelZpl,
  })
  const createJob = conn ? createWithinTransaction.bind(null, conn) : create
  return createJob({
    printerId,
    dispatchReason,
    warehouseId: Number.isFinite(wh) && wh > 0 ? wh : null,
    jobType: 'package_label',
    title: `箱贴 ${row.barcode}`,
    contentType: label.contentType,
    content: label.content,
    copies: 1,
    createdBy: payload.createdBy ?? null,
    jobUniqueKey: payload.jobUniqueKey ?? null,
    refType: 'package',
    refId: Number(packageId),
    refCode: row.barcode,
  })
}

async function enqueueProductLabelJob(payload) {
  const productId = payload?.productId
  if (!productId) return null
  const [[row]] = await pool.query(
    `SELECT p.id, p.code, p.name, p.spec, p.unit, p.sale_price
     FROM product_items p
     WHERE p.id = ? AND p.deleted_at IS NULL`,
    [productId],
  )
  if (!row) return null

  const { printerId, dispatchReason } = await resolveLabelPrinter({
    jobType: 'product_label',
  })
  if (!printerId) return null

  const vars = {
    product_code: row.code,
    product_name: row.name,
    spec: row.spec,
    unit: row.unit,
    price: row.sale_price != null ? Number(row.sale_price).toFixed(2) : '',
  }
  const label = await buildLabelBody({
    printerId,
    templateType: 8,
    vars,
    tsplBuilder: buildProductLabelTspl,
    zplBuilder: buildProductLabelZpl,
  })

  const job = await create({
    printerId,
    dispatchReason,
    warehouseId: null,
    jobType: 'product_label',
    title: `商品标签 ${row.code}`,
    contentType: label.contentType,
    content: label.content,
    copies: 1,
    createdBy: payload.createdBy ?? null,
    jobUniqueKey: payload.jobUniqueKey ?? null,
    refType: 'product',
    refId: Number(productId),
    refCode: row.code,
  })
  const dispatchHint = await getDispatchHintForJob(job.printerCode, job.id)
  return {
    id: job.id,
    printerCode: job.printerCode,
    printerName: job.printerName,
    dispatchHint,
    contentType: label.contentType,
    content: label.content,
  }
}

async function reprintInboundBarcode(recordId, { createdBy = null } = {}) {
  const id = Number(recordId)
  if (!Number.isFinite(id) || id <= 0) throw new AppError('入库条码不存在', 404, 'PRINT_BARCODE_RECORD_NOT_FOUND')
  const [[row]] = await pool.query(
    `SELECT c.id, c.barcode, c.remaining_qty, c.warehouse_id, p.name AS product_name
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     WHERE c.id = ? AND c.deleted_at IS NULL`,
    [id],
  )
  if (!row) throw new AppError('入库条码不存在', 404, 'PRINT_BARCODE_RECORD_NOT_FOUND')
  return enqueueContainerLabelJob({
    containerId: id,
    warehouseId: row.warehouse_id != null ? Number(row.warehouse_id) : null,
    data: {
      container_code: row.barcode,
      product_name: row.product_name,
      qty: row.remaining_qty,
    },
    createdBy,
    jobUniqueKey: `reprint_container:${id}:${Date.now()}`,
  })
}

async function reprintOutboundBarcode(recordId, { createdBy = null } = {}) {
  const id = Number(recordId)
  if (!Number.isFinite(id) || id <= 0) throw new AppError('条码记录不存在', 404, 'PRINT_BARCODE_RECORD_NOT_FOUND')
  return enqueuePackageLabelJob({
    packageId: id,
    createdBy,
    jobUniqueKey: `reprint_package:${id}:${Date.now()}`,
  })
}

async function reprintLogisticsBarcode(recordId, { createdBy = null } = {}) {
  const id = Number(recordId)
  if (!Number.isFinite(id) || id <= 0) throw new AppError('条码记录不存在', 404, 'PRINT_BARCODE_RECORD_NOT_FOUND')
  const job = await findById(id)
  if (job.jobType !== 'waybill' && job.refType !== 'waybill') {
    throw new AppError('该记录不是物流条码打印任务', 400, 'PRINT_BARCODE_CATEGORY_INVALID')
  }
  return create({
    printerId: job.printerId,
    warehouseId: job.warehouseId,
    jobType: 'waybill',
    title: job.title,
    contentType: job.contentType,
    content: job.content,
    copies: job.copies || 1,
    createdBy,
    dispatchReason: 'manual_reprint',
    refType: 'waybill',
    refId: job.refId,
    refCode: job.refCode,
    jobUniqueKey: `reprint_waybill:${id}:${Date.now()}`,
  })
}

async function reprintBarcodeRecord({ category, recordId, createdBy = null } = {}) {
  const type = String(category || '').trim().toLowerCase()
  if (type === 'inbound') return reprintInboundBarcode(recordId, { createdBy })
  if (type === 'outbound') return reprintOutboundBarcode(recordId, { createdBy })
  if (type === 'logistics') return reprintLogisticsBarcode(recordId, { createdBy })
  throw new AppError('条码分类无效', 400, 'PRINT_BARCODE_CATEGORY_INVALID')
}

module.exports = {
  enqueueContainerLabelJob,
  enqueueRackLabelJob,
  enqueuePackageLabelJob,
  enqueueProductLabelJob,
  reprintBarcodeRecord,
  getPrinterLabelRawFormat,
  resolveLabelPrinterId,
}
