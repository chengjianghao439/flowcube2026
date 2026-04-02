const svc = require('./print-jobs.service')
const { getTenantId } = require('../../utils/tenantScope')

async function list(req, res, next) {
  try {
    const { printerId, status, page, pageSize } = req.query
    const result = await svc.findAll({
      printerId: printerId ? +printerId : undefined,
      status:    svc.parseListStatus(status),
      page:      +page || 1,
      pageSize:  +pageSize || 50,
      tenantId:  getTenantId(req),
    })
    res.json({ success: true, data: result })
  } catch(e) { next(e) }
}

async function detail(req, res, next) {
  try {
    res.json({ success: true, data: await svc.findById(+req.params.id, { tenantId: getTenantId(req) }) })
  } catch (e) {
    next(e)
  }
}

async function create(req, res, next) {
  try {
    const job = await svc.create({
      ...req.body,
      tenantId: getTenantId(req),
      createdBy: req.user?.userId ?? req.user?.id,
    })
    res.status(201).json({ success: true, data: job })
  } catch(e) { next(e) }
}

async function claimClientJobs(req, res, next) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const clientId = String(body.clientId || '').trim()
    res.json({
      success: true,
      data: await svc.claimClientJobs({
        clientId,
        limit: Number(body.limit) || 3,
        tenantId: getTenantId(req),
      }),
    })
  } catch (e) { next(e) }
}

async function stats(req, res, next) {
  try {
    res.json({ success: true, data: await svc.getStatsCounts(getTenantId(req)) })
  } catch (e) {
    next(e)
  }
}

async function barcodeRecords(req, res, next) {
  try {
    const { category, keyword, status, page, pageSize } = req.query
    res.json({
      success: true,
      data: await svc.findBarcodeRecords({
        category,
        keyword: keyword || '',
        status: svc.parseListStatus(status),
        page: Number(page) || 1,
        pageSize: Number(pageSize) || 20,
        tenantId: getTenantId(req),
      }),
    })
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
      tenantId: getTenantId(req),
      createdBy: req.user?.userId ?? req.user?.id ?? null,
    })
    res.json({ success: true, data: job })
  } catch (e) {
    next(e)
  }
}

async function printerHealth(req, res, next) {
  try {
    res.json({ success: true, data: await svc.listPrinterHealth(getTenantId(req)) })
  } catch (e) {
    next(e)
  }
}

async function complete(req, res, next) {
  try {
    res.json({
      success: true,
      data: await svc.complete(+req.params.id, req.body || {}, { tenantId: getTenantId(req) }),
    })
  } catch (e) {
    next(e)
  }
}

/** 桌面端本机打印后核销队列（普通登录用户，无需 print:client） */
async function completeLocal(req, res, next) {
  try {
    res.json({
      success: true,
      data: await svc.completeLocalDesktop(+req.params.id, { tenantId: getTenantId(req) }),
    })
  } catch (e) {
    next(e)
  }
}

async function fail(req, res, next) {
  try {
    res.json({
      success: true,
      data: await svc.fail(+req.params.id, req.body.errorMessage, { tenantId: getTenantId(req) }),
    })
  } catch (e) {
    next(e)
  }
}

async function retry(req, res, next) {
  try {
    res.json({ success: true, data: await svc.retry(+req.params.id, { tenantId: getTenantId(req) }) })
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
