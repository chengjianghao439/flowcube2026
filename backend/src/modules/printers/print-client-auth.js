const crypto = require('crypto')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertBoundWarehouseInScope } = require('../../utils/warehouseScope')
const SAFE_CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/
const hashCredential = credential => crypto.createHash('sha256').update(credential).digest('hex')

async function authenticateClient(clientId, credential, scopeWarehouseIds = null, exec = pool) {
  const invalid = () => new AppError('打印工作站未注册或认证已失效，请升级桌面端并由管理员在打印机管理中注册本机', 401, 'PRINT_CLIENT_CREDENTIAL_INVALID')
  if (typeof clientId !== 'string' || !SAFE_CLIENT_ID.test(clientId) || typeof credential !== 'string' || !/^[a-f0-9]{64}$/.test(credential)) throw invalid()
  const [[client]] = await exec.query('SELECT client_id, credential_hash, revoked_at, warehouse_id FROM print_clients WHERE client_id=?', [clientId])
  const actualHash = hashCredential(credential)
  if (!client?.credential_hash || client.revoked_at || !/^[a-f0-9]{64}$/.test(client.credential_hash) || !crypto.timingSafeEqual(Buffer.from(client.credential_hash, 'hex'), Buffer.from(actualHash, 'hex'))) throw invalid()
  assertBoundWarehouseInScope(scopeWarehouseIds, client.warehouse_id, '打印工作站')
  return { clientId: client.client_id, credentialHash: actualHash, warehouseId: client.warehouse_id == null ? null : Number(client.warehouse_id) }
}

async function printClientRequired(req, res, next) {
  try {
    req.printClient = await authenticateClient(String(req.headers['x-client-id'] || ''), req.headers['x-print-client-credential'], req.user?.warehouseIds ?? null)
    next()
  } catch (e) { next(e) }
}
function requireClientIdentity(identity) {
  if (!identity || !SAFE_CLIENT_ID.test(identity.clientId || '') || !/^[a-f0-9]{64}$/.test(identity.credentialHash || '')) {
    throw new AppError('打印工作站认证无效', 401, 'PRINT_CLIENT_CREDENTIAL_INVALID')
  }
  return identity
}
module.exports = { authenticateClient, printClientRequired, requireClientIdentity, hashCredential, SAFE_CLIENT_ID }
