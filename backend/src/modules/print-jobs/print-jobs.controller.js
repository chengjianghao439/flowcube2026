const svc = require('./print-jobs.service')
const { successResponse } = require('../../utils/response')

async function list(req, res, next) {
  try {
    const { printerId, status, page, pageSize } = req.query
    const result = await svc.findAll({
      printerId: printerId ? +printerId : undefined,
      status:    svc.parseListStatus(status),
      page:      +page || 1,
      pageSize:  +pageSize || 50,
    })
    return successResponse(res, result)
  } catch(e) { next(e) }
}

async function detail(req, res, next) {
  try {
    return successResponse(res, await svc.findById(+req.params.id))
  } catch (e) {
    next(e)
  }
}

async function create(req, res, next) {
  try {
    const job = await svc.create({
      ...req.body,
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
      createdBy: req.user?.userId ?? req.user?.id ?? null,
    })
    return successResponse(res, job)
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
    return successResponse(res, await svc.complete(+req.params.id, req.body || {}))
  } catch (e) {
    next(e)
  }
}

/** 桌面端本机打印后核销队列（需具备打印客户端消费权限） */
async function completeLocal(req, res, next) {
  try {
    return successResponse(res, await svc.completeLocalDesktop(+req.params.id))
  } catch (e) {
    next(e)
  }
}

async function fail(req, res, next) {
  try {
    return successResponse(res, await svc.fail(+req.params.id, req.body.errorMessage))
  } catch (e) {
    next(e)
  }
}

async function retry(req, res, next) {
  try {
    return successResponse(res, await svc.retry(+req.params.id))
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
