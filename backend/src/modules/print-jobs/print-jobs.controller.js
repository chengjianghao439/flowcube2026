const svc = require('./print-jobs.service')
const tenantSettings = require('./print-tenant-settings.service')
const billing = require('./print-billing.service')
const printAlerts = require('./print-alert-monitor.service')
const { listTemplates } = require('./print-policy-templates')
const { getTenantId } = require('../../utils/tenantScope')
const AppError = require('../../utils/AppError')

function resolveTargetTenantId(req) {
  const self = getTenantId(req)
  if (req.user?.roleId === 1 && req.query.tenantId != null && req.query.tenantId !== '') {
    const n = Number(req.query.tenantId)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return self
}

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

async function stats(req, res, next) {
  try {
    res.json({ success: true, data: await svc.getStatsCounts(getTenantId(req)) })
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

async function policyTemplatesList(req, res, next) {
  try {
    res.json({ success: true, data: listTemplates() })
  } catch (e) {
    next(e)
  }
}

async function tenantSettingsApplyTemplate(req, res, next) {
  try {
    if (req.user?.roleId !== 1) {
      return next(new AppError('仅管理员可应用策略模板', 403))
    }
    const tid =
      req.body.tenantId != null && req.body.tenantId !== ''
        ? Number(req.body.tenantId)
        : getTenantId(req)
    if (!Number.isFinite(tid) || tid < 0) {
      return next(new AppError('tenantId 无效', 400))
    }
    await tenantSettings.applyPolicyTemplate(tid, req.body.template)
    const row = await tenantSettings.getSettingsRow(tid)
    res.json({
      success: true,
      message: '已应用模板',
      data: {
        settings: tenantSettings.formatTenantSettingsApi(row, tid),
        effective: sanitizeEffectivePolicy(await tenantSettings.getTenantPrintPolicy(tid)),
      },
    })
  } catch (e) {
    next(e)
  }
}

async function tenantBilling(req, res, next) {
  try {
    const tid = resolveTargetTenantId(req)
    const months = Number(req.query.months) > 0 ? Number(req.query.months) : 12
    const rows = await billing.listMonthlyBilling(tid, months)
    const ym = billing.currentYearMonth()
    res.json({
      success: true,
      data: {
        tenantId: tid,
        currentYearMonth: ym,
        months: rows,
      },
    })
  } catch (e) {
    next(e)
  }
}

async function alertsList(req, res, next) {
  try {
    const tid = resolveTargetTenantId(req)
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 50
    const unackOnly = req.query.unackOnly === '1' || req.query.unackOnly === 'true'
    const list = await printAlerts.listAlerts(tid, { limit, unackOnly })
    res.json({ success: true, data: list })
  } catch (e) {
    next(e)
  }
}

async function alertAck(req, res, next) {
  try {
    const id = +req.params.id
    const uid = req.user?.userId ?? req.user?.id
    const ok = await printAlerts.acknowledgeAlert(
      id,
      uid,
      getTenantId(req),
      req.user?.roleId === 1,
    )
    if (ok === null) return next(new AppError('告警不存在', 404))
    if (ok === false) return next(new AppError('无权处理该告警', 403))
    res.json({ success: true, message: '已确认', data: null })
  } catch (e) {
    next(e)
  }
}

/**
 * SSE 长连接 — 打印客户端监听
 * GET /api/print-jobs/listen/:printerCode
 * 连接后立即推送待打印任务，新任务到来时实时推送
 */
async function tenantDashboard(req, res, next) {
  try {
    const tid = resolveTargetTenantId(req)
    const days = Number(req.query.windowDays) > 0 ? Number(req.query.windowDays) : 7
    const data = await tenantSettings.getTenantMetricsSnapshot(tid, days)
    res.json({ success: true, data })
  } catch (e) {
    next(e)
  }
}

async function tenantsOverview(req, res, next) {
  try {
    if (req.user?.roleId !== 1) {
      return next(new AppError('仅管理员可查看全租户概览', 403))
    }
    const days = Number(req.query.windowDays) > 0 ? Number(req.query.windowDays) : 7
    const data = await tenantSettings.listTenantsOverview(days)
    res.json({ success: true, data })
  } catch (e) {
    next(e)
  }
}

function sanitizeEffectivePolicy(pol) {
  if (!pol || typeof pol !== 'object') return {}
  const { raw: _raw, ...rest } = pol
  return rest
}

async function tenantSettingsGet(req, res, next) {
  try {
    const tid = resolveTargetTenantId(req)
    const row = await tenantSettings.getSettingsRow(tid)
    const effective = sanitizeEffectivePolicy(await tenantSettings.getTenantPrintPolicy(tid))
    res.json({
      success: true,
      data: {
        settings: tenantSettings.formatTenantSettingsApi(row, tid),
        effective,
      },
    })
  } catch (e) {
    next(e)
  }
}

async function tenantSettingsPut(req, res, next) {
  try {
    if (req.user?.roleId !== 1) {
      return next(new AppError('仅管理员可修改租户打印策略', 403))
    }
    const body = req.body || {}
    const tid =
      body.tenantId != null && body.tenantId !== ''
        ? Number(body.tenantId)
        : getTenantId(req)
    if (!Number.isFinite(tid) || tid < 0) {
      return next(new AppError('tenantId 无效', 400))
    }
    await tenantSettings.upsertSettings(tid, body)
    const row = await tenantSettings.getSettingsRow(tid)
    res.json({
      success: true,
      message: '已保存',
      data: {
        settings: tenantSettings.formatTenantSettingsApi(row, tid),
        effective: sanitizeEffectivePolicy(await tenantSettings.getTenantPrintPolicy(tid)),
      },
    })
  } catch (e) {
    next(e)
  }
}

function listen(req, res) {
  const { printerCode } = req.params
  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')  // 禁止 nginx 缓冲
  res.flushHeaders()

  // 心跳每 25 秒发一次，防止代理超时断连
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(heartbeat) }
  }, 25000)

  res.on('close', () => clearInterval(heartbeat))

  svc.registerClient(printerCode, res)
}

module.exports = {
  list,
  detail,
  create,
  stats,
  printerHealth,
  complete,
  fail,
  retry,
  listen,
  policyTemplatesList,
  tenantSettingsApplyTemplate,
  tenantBilling,
  alertsList,
  alertAck,
  tenantDashboard,
  tenantsOverview,
  tenantSettingsGet,
  tenantSettingsPut,
}
