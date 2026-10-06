const { pool } = require('../../config/db')
const { assertBoundWarehouseInScope } = require('../../utils/warehouseScope')
const AppError = require('../../utils/AppError')
const { authenticateClient, SAFE_CLIENT_ID } = require('../printers/print-client-auth')
const SAFE_PRINTER_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/
const SAFE_STATION_CLIENT_ID = SAFE_CLIENT_ID

/** Public printer codes are routing metadata, never workstation authentication. */
async function validateJobPrinterHeader(req, res, next) {
  try {
    req.printClient = await authenticateClient(String(req.headers['x-client-id'] || ''), req.headers['x-print-client-credential'], req.user?.warehouseIds ?? null, pool)
    const [[job]] = await pool.query('SELECT printer_id, warehouse_id, claimed_client_id, claimed_credential_hash FROM print_jobs WHERE id=?', [+req.params.id])
    if (!job) throw new AppError('打印任务不存在', 404)
    assertBoundWarehouseInScope(req.user?.warehouseIds ?? null, job.warehouse_id, '打印任务')
    if (job.claimed_client_id !== req.printClient.clientId || job.claimed_credential_hash !== req.printClient.credentialHash) throw new AppError('打印任务未由本工作站领取，请核对原打印结果', 403, 'PRINT_CLIENT_CLAIM_MISMATCH')
    next()
  } catch (e) { next(e) }
}
module.exports = { SAFE_PRINTER_CODE, SAFE_STATION_CLIENT_ID, validateJobPrinterHeader }
