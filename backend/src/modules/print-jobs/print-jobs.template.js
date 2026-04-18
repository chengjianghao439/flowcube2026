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
const { create } = require('./print-jobs.command')
const { findById } = require('./print-jobs.query')
const { getDispatchHintForJob } = require('./print-jobs.dispatch')

function buildContainerLabelKind(containerCode) {
  const code = String(containerCode ?? '').toUpperCase()
  if (code.startsWith('B')) return '塑料盒'
  return '库存'
}

function buildContainerLabelZpl({ container_code, product_name, qty }) {
  const code = String(container_code ?? '').replace(/[\r\n^~]/g, '')
  const name = String(product_name ?? '')
    .slice(0, 32)
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
  const q = Number(qty)
  const qtyStr = Number.isFinite(q) ? String(q) : String(qty ?? '')
  const kind = buildContainerLabelKind(container_code)
  return `^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${code}^FS^FO32,108^A0N,24,24^FD${name}^FS^FO32,148^A0N,24,24^FD${kind}^FS^FO32,184^A0N,24,24^FDQTY ${qtyStr}^FS^XZ`
}

function buildRackLabelZpl({ rack_barcode, rack_code, zone, name }) {
  const code = String(rack_barcode ?? '').replace(/[\r\n^~]/g, '')
  const rc = String(rack_code ?? '')
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 28)
  const z = String(zone ?? '').slice(0, 12)
  const n = String(name ?? '')
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 20)
  return `^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${code}^FS^FO32,108^A0N,22,22^FD${rc}^FS^FO32,138^A0N,20,20^FD${z} ${n}^FS^XZ`
}

function buildPackageLabelZpl({ box_code, task_no, customer_name, summary }) {
  const bc = String(box_code ?? '').replace(/[\r\n^~]/g, '')
  const tn = String(task_no ?? '').slice(0, 24)
  const cn = String(customer_name ?? '')
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 24)
  const sm = String(summary ?? '').slice(0, 36)
  return `^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${bc}^FS^FO32,108^A0N,22,22^FD${tn}^FS^FO32,142^A0N,20,20^FD${cn}^FS^FO32,176^A0N,18,18^FD${sm}^FS^XZ`
}

function buildProductLabelZpl({ product_code, product_name, spec, unit, price }) {
  const code = String(product_code ?? '').replace(/[\r\n^~]/g, '')
  const name = String(product_name ?? '')
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 24)
  const sp = String(spec ?? '')
    .replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?')
    .slice(0, 20)
  const meta = [unit ? `/${unit}` : '', price ? `¥${price}` : ''].join(' ').trim()
  const metaSafe = meta.replace(/[^\x20-\x7E\u4e00-\u9fff]/g, '?').slice(0, 20)
  return `^XA^CI28^LH0,0^FO32,24^BY2^BCN,70,Y,N,N^FD${code}^FS^FO32,108^A0N,22,22^FD${name}^FS${sp ? `^FO32,142^A0N,20,20^FD${sp}^FS` : ''}${metaSafe ? `^FO32,176^A0N,18,18^FD${metaSafe}^FS` : ''}^XZ`
}

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

async function enqueueContainerLabelJob(payload) {
  const data = payload?.data
  if (!data?.container_code) return null
  const containerId =
    payload?.containerId != null && Number.isFinite(Number(payload.containerId)) ? Number(payload.containerId) : null
  const wh = payload.warehouseId != null ? Number(payload.warehouseId) : null
  const resolved = await resolvePrinterForJob({
    warehouseId: wh ?? undefined,
    jobType: 'container_label',
    contentType: 'zpl',
  })
  let printerId = resolved.printerId
  let dispatchReason = resolved.dispatchReason || 'fallback'
  if (!printerId) {
    printerId = await resolveLabelPrinterId()
    dispatchReason = 'fallback'
  }
  if (!printerId) return null
  const vars = {
    container_code: data.container_code,
    product_name: data.product_name,
    qty: data.qty,
  }
  const labelFmt = await getPrinterLabelRawFormat(printerId)
  const useTspl = labelFmt === 'tspl'
  const labelBody = useTspl
    ? (await getLabelTsplFromDefaultTemplate(6, vars))
      ?? buildContainerLabelTspl(vars)
    : (await getLabelZplFromDefaultTemplate(6, vars))
      ?? buildContainerLabelZpl(vars)
  return create({
    printerId,
    dispatchReason,
    warehouseId: Number.isFinite(wh) && wh > 0 ? wh : null,
    jobType: 'container_label',
    title: `容器标 ${data.container_code}`,
    contentType: useTspl ? 'tspl' : 'zpl',
    content: labelBody,
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
      throw new AppError('数据库缺少 warehouse_racks.barcode，请执行迁移 051_warehouse_racks_barcode.sql', 503)
    }
    throw e
  }
  if (!row || !row.barcode) return null
  const wh = row.warehouse_id != null ? Number(row.warehouse_id) : null
  const resolved = await resolvePrinterForJob({
    warehouseId: Number.isFinite(wh) && wh > 0 ? wh : undefined,
    jobType: 'rack_label',
    contentType: 'zpl',
  })
  let printerId = resolved.printerId
  let dispatchReason = resolved.dispatchReason || 'fallback'
  if (!printerId) {
    printerId = await resolveLabelPrinterId()
    dispatchReason = 'fallback'
  }
  if (!printerId) return null
  const vars = {
    rack_barcode: row.barcode,
    rack_code: row.code,
    zone: row.zone,
    name: row.name,
  }
  const labelFmt = await getPrinterLabelRawFormat(printerId)
  const useTspl = labelFmt === 'tspl'
  const labelBody = useTspl
    ? (await getLabelTsplFromDefaultTemplate(5, vars))
      ?? buildRackLabelTspl(vars)
    : (await getLabelZplFromDefaultTemplate(5, vars))
      ?? buildRackLabelZpl(vars)
  try {
    const job = await create({
      printerId,
      dispatchReason,
      warehouseId: Number.isFinite(wh) && wh > 0 ? wh : null,
      jobType: 'rack_label',
      title: `货架标 ${row.barcode}`,
      contentType: useTspl ? 'tspl' : 'zpl',
      content: labelBody,
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
      contentType: useTspl ? 'tspl' : 'zpl',
      content: labelBody,
    }
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR' || /Unknown column/i.test(String(e.message))) {
      throw new AppError('打印入库失败：数据库字段异常，请先执行迁移或联系管理员', 503)
    }
    throw e
  }
}

async function enqueuePackageLabelJob(payload) {
  const packageId = payload?.packageId
  if (!packageId) return null
  const [[row]] = await pool.query(
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
  const resolved = await resolvePrinterForJob({
    warehouseId: Number.isFinite(wh) && wh > 0 ? wh : undefined,
    jobType: 'package_label',
    contentType: 'zpl',
  })
  let printerId = resolved.printerId
  let dispatchReason = resolved.dispatchReason || 'fallback'
  if (!printerId) {
    printerId = await resolveLabelPrinterId()
    dispatchReason = 'fallback'
  }
  if (!printerId) return null
  const vars = {
    box_code: row.barcode,
    task_no: row.task_no,
    customer_name: row.customer_name,
    summary,
  }
  const labelFmt = await getPrinterLabelRawFormat(printerId)
  const useTspl = labelFmt === 'tspl'
  const labelBody = useTspl
    ? (await getLabelTsplFromDefaultTemplate(7, vars))
      ?? buildPackageLabelTspl(vars)
    : (await getLabelZplFromDefaultTemplate(7, vars))
      ?? buildPackageLabelZpl(vars)
  return create({
    printerId,
    dispatchReason,
    warehouseId: Number.isFinite(wh) && wh > 0 ? wh : null,
    jobType: 'package_label',
    title: `箱贴 ${row.barcode}`,
    contentType: useTspl ? 'tspl' : 'zpl',
    content: labelBody,
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

  const resolved = await resolvePrinterForJob({
    jobType: 'product_label',
    contentType: 'zpl',
  })
  let printerId = resolved.printerId
  let dispatchReason = resolved.dispatchReason || 'fallback'
  if (!printerId) {
    printerId = await resolveLabelPrinterId()
    dispatchReason = 'fallback'
  }
  if (!printerId) return null

  const vars = {
    product_code: row.code,
    product_name: row.name,
    spec: row.spec,
    unit: row.unit,
    price: row.sale_price != null ? Number(row.sale_price).toFixed(2) : '',
  }
  const labelFmt = await getPrinterLabelRawFormat(printerId)
  const useTspl = labelFmt === 'tspl'
  const labelBody = useTspl
    ? (await getLabelTsplFromDefaultTemplate(8, vars))
      ?? buildProductLabelTspl(vars)
    : (await getLabelZplFromDefaultTemplate(8, vars))
      ?? buildProductLabelZpl(vars)

  const job = await create({
    printerId,
    dispatchReason,
    warehouseId: null,
    jobType: 'product_label',
    title: `商品标签 ${row.code}`,
    contentType: useTspl ? 'tspl' : 'zpl',
    content: labelBody,
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
    contentType: useTspl ? 'tspl' : 'zpl',
    content: labelBody,
  }
}

async function reprintInboundBarcode(recordId, { createdBy = null } = {}) {
  const id = Number(recordId)
  if (!Number.isFinite(id) || id <= 0) throw new AppError('入库条码不存在', 404)
  const [[row]] = await pool.query(
    `SELECT c.id, c.barcode, c.remaining_qty, c.warehouse_id, p.name AS product_name
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     WHERE c.id = ? AND c.deleted_at IS NULL`,
    [id],
  )
  if (!row) throw new AppError('入库条码不存在', 404)
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
  if (!Number.isFinite(id) || id <= 0) throw new AppError('条码记录不存在', 404)
  return enqueuePackageLabelJob({
    packageId: id,
    createdBy,
    jobUniqueKey: `reprint_package:${id}:${Date.now()}`,
  })
}

async function reprintLogisticsBarcode(recordId, { createdBy = null } = {}) {
  const id = Number(recordId)
  if (!Number.isFinite(id) || id <= 0) throw new AppError('条码记录不存在', 404)
  const job = await findById(id)
  if (job.jobType !== 'waybill' && job.refType !== 'waybill') {
    throw new AppError('该记录不是物流条码打印任务', 400)
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
  throw new AppError('条码分类无效', 400)
}

module.exports = {
  enqueueContainerLabelJob,
  enqueueRackLabelJob,
  enqueuePackageLabelJob,
  enqueueProductLabelJob,
  reprintBarcodeRecord,
  buildContainerLabelZpl,
  buildRackLabelZpl,
  buildPackageLabelZpl,
  buildProductLabelZpl,
  getPrinterLabelRawFormat,
  resolveLabelPrinterId,
}
