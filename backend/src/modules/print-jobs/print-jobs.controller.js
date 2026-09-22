const svc = require('./print-jobs.service')
const AppError = require('../../utils/AppError')
const { successResponse } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { printerId, status, page, pageSize } = req.query
    const result = await svc.findAll({
      printerId: printerId ? +printerId : undefined,
      status:    svc.parseListStatus(status),
      page:      +page || 1,
      pageSize:  +pageSize || 50,
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
    const clientId = String(body.clientId || '').trim()
    return successResponse(res, await svc.claimClientJobs({
      clientId,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
      limit: Number(body.limit) || 3,
    }))
  } catch (e) { next(e) }
}

async function stats(req, res, next) {
  try {
    return successResponse(res, await svc.getStatsCounts())
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
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
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
    const job = await svc.reprintBarcodeRecord({
      category: body.category,
      recordId: body.recordId,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
      createdBy: req.user?.userId ?? req.user?.id ?? null,
    })
    if (!job) {
      // 未解析到打印机（未绑定 / 绑定缺失），补打不产生任何业务副作用，直接告知前端
      return successResponse(res, { queued: false, jobId: null, printerCode: null, printerName: null, dispatchHint: null })
    }
    if (job.unprintable) {
      // 2026-09-14：没有可用打印机时也会落一条失败记录（保证对象始终有打印记录）。
      // 这不算「已提交打印」，前端要提示先去绑定打印机，而不是报成功。
      return successResponse(
        res,
        { queued: false, jobId: Number(job.id), printerCode: null, printerName: null, dispatchHint: null },
        '未绑定可用打印机，已记录本次补打，请先绑定打印机后再补打',
      )
    }
    // 与 packages.controller / racks.controller 一致：入队后补算派发提示，
    // 让前端能区分「客户端离线」「打印机未绑定客户端」与正常排队，而不是一律 toast 成功。
    const dispatchHint = await svc.getDispatchHintForJob(job.printerCode, job.id)
    return successResponse(res, { queued: true, ...job, dispatchHint })
  } catch (e) {
    next(e)
  }
}

async function printerHealth(req, res, next) {
  try {
    return successResponse(res, await svc.listPrinterHealth())
  } catch (e) {
    next(e)
  }
}

async function complete(req, res, next) {
  try {
    return successResponse(res, await svc.complete(+req.params.id, req.body || {}, req.user?.warehouseIds ?? null))
  } catch (e) {
    next(e)
  }
}

/** 桌面端本机打印后核销队列（需具备打印客户端消费权限） */
async function completeLocal(req, res, next) {
  try {
    return successResponse(res, await svc.completeLocalDesktop(+req.params.id, req.user?.warehouseIds ?? null))
  } catch (e) {
    next(e)
  }
}

async function fail(req, res, next) {
  try {
    return successResponse(res, await svc.fail(+req.params.id, req.body, req.user?.warehouseIds ?? null))
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
