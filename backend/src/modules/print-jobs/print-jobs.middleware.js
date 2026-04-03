const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { getTenantId } = require('../../utils/tenantScope')

const SAFE_PRINTER_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/

/** 工作站 ID：与 printers.client_id 一致（complete/fail 头校验） */
const SAFE_STATION_CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/

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

module.exports = {
  SAFE_PRINTER_CODE,
  SAFE_STATION_CLIENT_ID,
  validateJobPrinterHeader,
}
