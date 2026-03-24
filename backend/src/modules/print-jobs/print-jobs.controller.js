const svc = require('./print-jobs.service')

async function list(req, res, next) {
  try {
    const { printerId, status, page, pageSize } = req.query
    const result = await svc.findAll({
      printerId: printerId ? +printerId : undefined,
      status:    status !== undefined ? +status : undefined,
      page:      +page || 1,
      pageSize:  +pageSize || 50,
    })
    res.json({ success: true, data: result })
  } catch(e) { next(e) }
}

async function detail(req, res, next) {
  try { res.json({ success: true, data: await svc.findById(+req.params.id) }) }
  catch(e) { next(e) }
}

async function create(req, res, next) {
  try {
    const job = await svc.create({ ...req.body, createdBy: req.user?.id })
    res.status(201).json({ success: true, data: job })
  } catch(e) { next(e) }
}

async function complete(req, res, next) {
  try { res.json({ success: true, data: await svc.complete(+req.params.id) }) }
  catch(e) { next(e) }
}

async function fail(req, res, next) {
  try { res.json({ success: true, data: await svc.fail(+req.params.id, req.body.errorMessage) }) }
  catch(e) { next(e) }
}

async function retry(req, res, next) {
  try { res.json({ success: true, data: await svc.retry(+req.params.id) }) }
  catch(e) { next(e) }
}

/**
 * SSE 长连接 — 打印客户端监听
 * GET /api/print-jobs/listen/:printerCode
 * 连接后立即推送待打印任务，新任务到来时实时推送
 */
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

module.exports = { list, detail, create, complete, fail, retry, listen }
