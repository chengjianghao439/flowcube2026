const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { getTenantId } = require('../../utils/tenantScope')

const SAFE_PRINTER_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/

/** 工作站 ID：与 printers.client_id、打印客户端 --client-id 一致 */
const SAFE_STATION_CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/

function normalizeBodyPrinterCode(p) {
  if (!p || (!p.code && !p.name)) return null
  const code = (p.code || String(p.name).replace(/[^A-Z0-9]/gi, '_').toUpperCase()).slice(0, 50)
  return code || null
}

/** GET listen/station / SSE：X-Client-Id 已绑定到本租户至少一台打印机 */
async function validateListenStationClientId(req, res, next) {
  try {
    const clientId = String(req.headers['x-client-id'] || '').trim()
    if (!SAFE_STATION_CLIENT_ID.test(clientId)) {
      return next(new AppError('请求头 X-Client-Id 无效或未提供', 400))
    }
    const tid = getTenantId(req)
    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS c FROM printers p
       WHERE p.client_id = ? AND (p.tenant_id = ? OR p.tenant_id = 0)`,
      [clientId, tid],
    )
    if (!Number(cnt?.c)) {
      return next(
        new AppError(
          '该工作站尚未绑定打印机：请先启动打印客户端完成注册，或与管理员确认 printers.client_id',
          404,
        ),
      )
    }
    req.validatedStationClientId = clientId
    next()
  } catch (e) {
    next(e)
  }
}

/** GET listen / SSE：printerCode 存在且格式合法 */
async function validateListenPrinterCode(req, res, next) {
  try {
    const code = String(req.params.printerCode || '').trim()
    if (!SAFE_PRINTER_CODE.test(code)) {
      return next(new AppError('打印机编码格式无效', 400))
    }
    const tid = getTenantId(req)
    const [[p]] = await pool.query(
      'SELECT id, code FROM printers WHERE code=? AND (tenant_id=? OR tenant_id=0) LIMIT 1',
      [code, tid],
    )
    if (!p) return next(new AppError('打印机不存在', 404))
    req.validatedPrinterCode = p.code
    next()
  } catch (e) {
    next(e)
  }
}

/** complete / fail：X-Client-Id（工作站）或 X-Printer-Code 与任务目标打印机一致 */
async function validateJobPrinterHeader(req, res, next) {
  try {
    const jobId = +req.params.id
    const [[job]] = await pool.query('SELECT printer_id, tenant_id FROM print_jobs WHERE id=?', [jobId])
    if (!job) return next(new AppError('打印任务不存在', 404))
    const jobTenant = Number(job.tenant_id ?? 0)
    const userTenant = Number(req.user?.tenantId ?? 0)
    if (jobTenant !== userTenant) {
      return next(new AppError('任务与租户不匹配', 403))
    }

    const stationHeader = String(req.headers['x-client-id'] || '').trim()
    if (stationHeader) {
      if (!SAFE_STATION_CLIENT_ID.test(stationHeader)) {
        return next(new AppError('请求头 X-Client-Id 无效', 400))
      }
      const [[p]] = await pool.query('SELECT id, client_id FROM printers WHERE id=?', [job.printer_id])
      if (!p || !p.client_id || String(p.client_id) !== stationHeader) {
        return next(new AppError('任务与工作站（X-Client-Id）不匹配', 403))
      }
      return next()
    }

    const headerCode = String(req.headers['x-printer-code'] || '').trim()
    if (!SAFE_PRINTER_CODE.test(headerCode)) {
      return next(new AppError('请求头 X-Printer-Code 无效或未提供（工作站模式请传 X-Client-Id）', 400))
    }
    const [[p]] = await pool.query('SELECT id FROM printers WHERE code=?', [headerCode])
    if (!p || p.id !== job.printer_id) {
      return next(new AppError('任务与打印机编码不匹配', 403))
    }
    next()
  } catch (e) {
    next(e)
  }
}

/** register-client：注册列表须包含 X-Printer-Code 对应编码 */
function validateRegisterIncludesPrinterHeader(req, res, next) {
  const headerCode = String(req.headers['x-printer-code'] || '').trim()
  if (!SAFE_PRINTER_CODE.test(headerCode)) {
    return next(new AppError('请求头 X-Printer-Code 无效或未提供', 400))
  }
  const { printers = [] } = req.body
  if (!Array.isArray(printers)) {
    return next(new AppError('printers 须为数组', 400))
  }
  const codes = new Set(
    printers.map(normalizeBodyPrinterCode).filter(Boolean),
  )
  if (!codes.has(headerCode)) {
    return next(new AppError('注册打印机列表须包含 X-Printer-Code 指定的编码', 400))
  }
  next()
}

/** heartbeat：body.printerCode 与头一致，且 clientId 以 -printerCode 结尾 */
function validateHeartbeatPrinter(req, res, next) {
  const headerCode = String(req.headers['x-printer-code'] || '').trim()
  const bodyCode = String(req.body?.printerCode || '').trim()
  const { clientId } = req.body
  if (!clientId) return next(new AppError('clientId 必填', 400))
  if (!SAFE_PRINTER_CODE.test(headerCode) || bodyCode !== headerCode) {
    return next(new AppError('请求体 printerCode 须与 X-Printer-Code 一致', 400))
  }
  const stationHeader = String(req.headers['x-client-id'] || '').trim()
  if (SAFE_STATION_CLIENT_ID.test(stationHeader) && stationHeader === String(clientId).trim()) {
    return next()
  }
  const suffix = `-${headerCode}`
  if (!String(clientId).endsWith(suffix)) {
    return next(new AppError('clientId 与打印机编码不一致', 400))
  }
  next()
}

module.exports = {
  SAFE_PRINTER_CODE,
  SAFE_STATION_CLIENT_ID,
  validateListenStationClientId,
  validateListenPrinterCode,
  validateJobPrinterHeader,
  validateRegisterIncludesPrinterHeader,
  validateHeartbeatPrinter,
}
