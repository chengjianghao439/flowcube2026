const svc = require('./print-jobs.service')
const AppError = require('../../utils/AppError')
const { extractRequestKey } = require('../../utils/requestKey')
const { successResponse } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { printerId, status, page, pageSize } = req.query
    const result = await svc.findAll({
      printerId: printerId ? +printerId : undefined,
      status:    svc.parseListStatus(status),
      page,
      pageSize,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result)
  } catch(e) { next(e) }
}

async function detail(req, res, next) {
  try {
    return successResponse(res, await svc.findById(+req.params.id, req.user?.warehouseIds ?? null))
  } catch (e) {
    next(e)
  }
}

async function create(req, res, next) {
  try {
    // 业务引用必须由对应业务打印入口读取真实来源，不能由原始打印载荷伪造。
    if (['refType', 'refId', 'refCode'].some(key => req.body?.[key] != null)) {
      throw new AppError('业务标签请使用对应业务打印入口', 400, 'PRINT_BUSINESS_REFERENCE_FORBIDDEN')
    }
    // 请求目的、姓名快照与克隆来源仅由业务入口及排队数据库决定。
    if (['requestPurpose', 'request_purpose', 'createdById', 'createdByName', 'created_by_name', 'sourcePrintJobId', 'source_print_job_id'].some(key => Object.prototype.hasOwnProperty.call(req.body ?? {}, key))) {
      throw new AppError('打印请求资料不能由客户端指定', 400, 'PRINT_REQUEST_METADATA_FORBIDDEN')
    }
    const job = await svc.create({
      ...req.body,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
      createdBy: req.user?.userId ?? req.user?.id,
    })
    return successResponse(res, job, '创建成功', 201)
  } catch(e) { next(e) }
}

async function claimClientJobs(req, res, next) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    return successResponse(res, await svc.claimClientJobs({
      identity: req.printClient,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
      limit: Number(body.limit) || 3,
    }))
  } catch (e) { next(e) }
}

async function stats(req, res, next) {
  try {
    return successResponse(res, await svc.getStatsCounts(req.user?.warehouseIds ?? null))
  } catch (e) {
    next(e)
  }
}

async function barcodeRecords(req, res, next) {
  try {
    const { category, keyword, status, page, pageSize, inboundTaskId, inboundTaskItemId } = req.query
    return successResponse(res, await svc.findBarcodeRecords({
      category,
      keyword: keyword || '',
      status: status || undefined,
      recovery: req.query.recovery === '1',
      page,
      pageSize,
      inboundTaskId: inboundTaskId ? Number(inboundTaskId) : null,
      inboundTaskItemId: inboundTaskItemId ? Number(inboundTaskItemId) : null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    }))
  } catch (e) {
    next(e)
  }
}

async function reprintBarcode(req, res, next) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const data = await svc.reprintBarcodeRecord({
      category: body.category, recordId: body.recordId, recovery: body.recovery === true,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
      createdBy: req.user?.userId ?? req.user?.id ?? null,
      requestKey: extractRequestKey(req),
    })
    return successResponse(res, data, data.queued ? '补打任务已加入打印队列' : '本次未出纸，已保留失败记录，请核对打印机和渲染配置后再补打')
  } catch (e) {
    next(e)
  }
}

async function printerHealth(req, res, next) {
  try {
    return successResponse(res, await svc.listPrinterHealth(req.user?.warehouseIds ?? null))
  } catch (e) {
    next(e)
  }
}

async function complete(req, res, next) {
  try {
    return successResponse(res, await svc.complete(+req.params.id, req.body || {}, req.user?.warehouseIds ?? null, req.printClient))
  } catch (e) {
    next(e)
  }
}

/** 桌面端本机打印后核销队列（需具备打印客户端消费权限） */
async function completeLocal(req, res, next) {
  try {
    return successResponse(res, await svc.completeLocalDesktop(+req.params.id, req.user?.warehouseIds ?? null, req.body || {}, req.printClient))
  } catch (e) {
    next(e)
  }
}

async function fail(req, res, next) {
  try {
    return successResponse(res, await svc.fail(+req.params.id, req.body, req.user?.warehouseIds ?? null, req.printClient))
  } catch (e) {
    next(e)
  }
}

async function retry(req, res, next) {
  try {
    return successResponse(res, await svc.retry(+req.params.id, req.user?.warehouseIds ?? null))
  } catch (e) {
    next(e)
  }
}

module.exports = {
  list,
  detail,
  create,
  claimClientJobs,
  stats,
  printerHealth,
  barcodeRecords,
  reprintBarcode,
  complete,
  completeLocal,
  fail,
  retry,
}
