const { pool } = require('../../config/db')
const { readLabelVariables, containerLabelVariables } = require('./labelVariables')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')
const { resolvePrinterForJob } = require('./print-dispatch')
const { getLabelZplFromDefaultTemplate } = require('./labelZplTemplate')
const { renderLabelAsync } = require('./labelRasterService')
const { defaultLabelLayout } = require('./labelRasterDefaults')
const { create, createWithinTransaction } = require('./print-jobs.command')
const { findById } = require('./print-jobs.query')
const { getDispatchHintForJob } = require('./print-jobs.dispatch')

async function resolveLabelPrinterId(warehouseId) {
  const wh = Number(warehouseId)
  const scoped = Number.isFinite(wh) && wh > 0
  const scopeSql = scoped ? ' AND (warehouse_id IS NULL OR warehouse_id = ?)' : ''
  const scopeParams = scoped ? [wh] : []
  const code = (process.env.INBOUND_LABEL_PRINTER_CODE || process.env.PDA_LABEL_PRINTER_CODE || '').trim()
  if (code) {
    const [[byCode]] = await pool.query(
      `SELECT id, code FROM printers WHERE code = ? AND status = 1 AND type = 1${scopeSql}`,
      [code, ...scopeParams],
    )
    if (byCode) return byCode.id
    logger.warn(`[print] 环境变量指定的标签机 code=${code} 不可用于当前仓库，将尝试使用同仓或全局标签机`, {}, 'PrintJobs')
  }
  const [[first]] = await pool.query(
    `SELECT id, code FROM printers WHERE status = 1 AND type = 1${scopeSql}
     ORDER BY id ASC LIMIT 1`,
    scopeParams,
  )
  return first?.id ?? null
}

/**
 * 发起打印的那台桌面客户端名下的可用标签机。
 *
 * 用于「没有仓库归属」的打印（典型是商品标签：product_items 不属于任何仓库）。
 * 这类打印若只按绑定/负载解析，多仓库部署下会被派到别的仓库的机器上 —— 操作员在 A 仓点，
 * 纸从 B 仓出来。以发起请求的客户端为准最符合直觉，且不需要操作员做任何选择。
 * 同一客户端接多台标签机时，优先取配置了该用途绑定的那台。
 */
async function resolveClientPreferredPrinterId(clientId, printType) {
  const cid = String(clientId || '').trim()
  if (!cid) return null
  const [[bound]] = await pool.query(
    `SELECT p.id
     FROM printers p
     INNER JOIN printer_bindings b ON b.printer_id = p.id AND b.print_type = ?
     WHERE p.client_id = ? AND p.status = 1 AND p.type = 1
     ORDER BY p.id ASC LIMIT 1`,
    [printType, cid],
  )
  if (bound?.id) return Number(bound.id)
  const [[any]] = await pool.query(
    `SELECT id FROM printers
     WHERE client_id = ? AND status = 1 AND type = 1
     ORDER BY id ASC LIMIT 1`,
    [cid],
  )
  return any?.id != null ? Number(any.id) : null
}

async function resolveLabelPrinter({
  warehouseId,
  jobType,
  requireBinding = false,
  allowBindingFallback = true,
  preferClientId = null,
}) {
  if (preferClientId) {
    const byClient = await resolveClientPreferredPrinterId(preferClientId, jobType)
    if (byClient) return { printerId: byClient, dispatchReason: 'client_local' }
  }
  const wh = warehouseId != null ? Number(warehouseId) : null
  const resolved = await resolvePrinterForJob({
    warehouseId: Number.isFinite(wh) && wh > 0 ? wh : undefined,
    jobType,
    contentType: 'zpl',
    requireBinding,
    allowBindingFallback,
  })
  let printerId = resolved.printerId
  let dispatchReason = resolved.dispatchReason || 'fallback'
  if (!printerId && !requireBinding) {
    printerId = await resolveLabelPrinterId(wh)
    dispatchReason = 'fallback'
  }
  return { printerId, dispatchReason }
}

async function buildLabelBody({ templateType, vars }) {
  const content = (await getLabelZplFromDefaultTemplate(templateType, vars)) ?? (await renderLabelAsync({ layout: defaultLabelLayout(templateType), data: vars, preview: false })).zpl
  return { contentType: 'zpl', content }
}

/** 幂等兜底时间窗（秒）：同一对象在窗口内重复入队会合并为同一个打印任务 */
function labelJobKeyBucketSeconds() {
  const n = Number(process.env.PRINT_LABEL_DEDUP_WINDOW_SECONDS)
  return Number.isFinite(n) && n > 0 ? n : 10
}

/**
 * 幂等键兜底：调用方未显式指定 jobUniqueKey 时，按「引用对象 + 时间窗」自动分桶去重。
 * 这样新增打印入口默认就能挡住连点 / 网络重试造成的重复出纸，而不必依赖各调用方自觉传 key。
 * 需要每次都新建任务的场景（人工补打）由调用方显式传入带唯一标识的 key 覆盖本默认值。
 */
function defaultLabelJobKey(kind, refId) {
  const id = Number(refId)
  if (!kind || !Number.isFinite(id) || id <= 0) return null
  return `${kind}:${id}:${Math.floor(Date.now() / (labelJobKeyBucketSeconds() * 1000))}`
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
  const isPlasticBox = String(data.container_code || '').toUpperCase().startsWith('B')
  const source = containerId > 0 ? await readLabelVariables(isPlasticBox ? 9 : 6, { id: containerId, conn: conn || pool }) : null
  const vars = {
    ...(source?.vars || containerLabelVariables()),
    container_code: data.container_code,
    product_name: data.product_name,
    qty: data.qty,
  }
  const label = await buildLabelBody({
    printerId,
    templateType: isPlasticBox ? 9 : 6,
    vars,
  })
  const createJob = conn ? createWithinTransaction.bind(null, conn) : create
  return createJob({
    printerId,
    dispatchReason,
    warehouseId: Number.isFinite(wh) && wh > 0 ? wh : null,
    jobType: 'container_label',
    title: `${isPlasticBox ? '塑料盒标' : '容器标'} ${data.container_code}`,
    contentType: label.contentType,
    content: label.content,
    copies: 1,
    createdBy: payload.createdBy ?? null,
    jobUniqueKey: payload.jobUniqueKey ?? defaultLabelJobKey('container_label', containerId),
    refType: containerId ? 'inventory_container' : null,
    refId: containerId,
    refCode: data.container_code,
  })
}

async function enqueueRackLabelJob(payload) {
  const rackId = payload?.rackId
  if (!rackId) return null
  let row
  let vars
  try {
    const source = await readLabelVariables(5, { id: rackId })
    row = source?.row
    vars = source?.vars
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
  const label = await buildLabelBody({
    printerId,
    templateType: 5,
    vars,
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
      jobUniqueKey: payload.jobUniqueKey ?? defaultLabelJobKey('rack_label', rackId),
    })
    const dispatchHint = await getDispatchHintForJob(job.printerCode, job.id)
    return {
      id: job.id,
      printerCode: job.printerCode,
      printerName: job.printerName,
      dispatchHint,
      contentType: job.contentType,
      content: job.content,
    }
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR' || /Unknown column/i.test(String(e.message))) {
      throw new AppError('打印入库失败：数据库字段异常，请先执行迁移或联系管理员', 503, 'DB_CONFIG_MISSING')
    }
    throw e
  }
}

/**
 * 库位标签入队（warehouse_locations，条码 R+数字）。
 * 对照 enqueueRackLabelJob：同款 resolveLabelPrinter（按库位所属仓库解析）、
 * 默认分桶幂等键（location_label:<id>:<时间窗>）、模板 type 10（库位标签）。
 */
async function enqueueLocationLabelJob(payload) {
  const locationId = payload?.locationId
  if (!locationId) return null
  const source = await readLabelVariables(10, { id: locationId })
  const row = source?.row
  if (!row || !row.barcode) return null
  const wh = row.warehouse_id != null ? Number(row.warehouse_id) : null
  const { printerId, dispatchReason } = await resolveLabelPrinter({
    warehouseId: wh,
    jobType: 'location_label',
  })
  if (!printerId) return null
  const vars = source.vars
  const label = await buildLabelBody({
    printerId,
    templateType: 10,
    vars,
  })
  try {
    const job = await create({
      printerId,
      dispatchReason,
      warehouseId: Number.isFinite(wh) && wh > 0 ? wh : null,
      jobType: 'location_label',
      title: `库位标 ${row.barcode}`,
      contentType: label.contentType,
      content: label.content,
      copies: 1,
      createdBy: payload.createdBy ?? null,
      jobUniqueKey: payload.jobUniqueKey ?? defaultLabelJobKey('location_label', locationId),
      refType: 'warehouse_location',
      refId: Number(locationId),
      refCode: row.barcode,
    })
    const dispatchHint = await getDispatchHintForJob(job.printerCode, job.id)
    return {
      id: job.id,
      printerCode: job.printerCode,
      printerName: job.printerName,
      dispatchHint,
      contentType: job.contentType,
      content: job.content,
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
  const source = await readLabelVariables(7, { id: packageId, conn: conn || pool })
  const row = source?.row
  if (!row) return null

  const wh = row.warehouse_id != null ? Number(row.warehouse_id) : null
  const { printerId, dispatchReason } = await resolveLabelPrinter({
    warehouseId: wh,
    jobType: 'package_label',
    requireBinding: true,
    allowBindingFallback: false,
  })
  if (!printerId) return null
  const vars = source.vars
  const label = await buildLabelBody({
    printerId,
    templateType: 7,
    vars,
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
    jobUniqueKey: payload.jobUniqueKey ?? defaultLabelJobKey('package_label', packageId),
    refType: 'package',
    refId: Number(packageId),
    refCode: row.barcode,
  })
}

/**
 * 电子面单入队（文档 06 · 5.3）——补上"正向入队"缺口。
 *
 * 平台取号成功后由**异步 worker（事务外）**调用，把平台返回的面单 ZPL 原样入队走现有 print_jobs 链。
 * 面单版式由快递平台决定，**不经本地模板**（不 buildLabelBody）。
 * 无面单机绑定时返回 null（跳过入队，取号仍算成功，之后可用 reprintLogisticsBarcode 补打），
 * 只使用明确配置的 waybill 用途绑定，不自动回退到普通标签机。
 * jobUniqueKey 默认 `waybill:<id>`，同运单重复入队幂等（活跃期唯一索引挡重复出纸）。
 */
async function enqueueWaybillLabelJob(payload) {
  const waybillId = Number(payload?.waybillId)
  const content = payload?.content
  if (!Number.isFinite(waybillId) || waybillId <= 0 || !content) return null
  const wh = payload.warehouseId != null ? Number(payload.warehouseId) : null
  const resolved = await resolvePrinterForJob({
    warehouseId: Number.isFinite(wh) && wh > 0 ? wh : undefined,
    jobType: 'waybill',
    contentType: 'zpl',
    requireBinding: true,
    allowBindingFallback: false,
  })
  const printerId = resolved?.printerId
  if (!printerId) return null
  return create({
    printerId,
    dispatchReason: resolved.dispatchReason || 'fallback',
    warehouseId: Number.isFinite(wh) && wh > 0 ? wh : null,
    jobType: 'waybill',
    title: payload.title || `面单 ${waybillId}`,
    contentType: 'zpl',
    content,
    copies: 1,
    createdBy: payload.createdBy ?? null,
    jobUniqueKey: payload.jobUniqueKey ?? `waybill:${waybillId}`,
    refType: 'waybill',
    refId: waybillId,
    refCode: payload.refCode ?? null,
  })
}

async function enqueueProductLabelJob(payload) {
  const productId = payload?.productId
  if (!productId) return null
  const source = await readLabelVariables(8, { id: productId })
  const row = source?.row
  if (!row) return null

  // 商品无仓库归属：优先派给发起请求的那台桌面客户端的打印机，避免跨仓库出纸
  const { printerId, dispatchReason } = await resolveLabelPrinter({
    jobType: 'product_label',
    preferClientId: payload?.preferClientId ?? null,
  })
  if (!printerId) return null

  const vars = source.vars
  const label = await buildLabelBody({
    printerId,
    templateType: 8,
    vars,
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
    jobUniqueKey: payload.jobUniqueKey ?? defaultLabelJobKey('product_label', productId),
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
    contentType: job.contentType,
    content: job.content,
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
  enqueueLocationLabelJob,
  enqueuePackageLabelJob,
  enqueueWaybillLabelJob,
  enqueueProductLabelJob,
  reprintBarcodeRecord,
  resolveLabelPrinterId,
}
