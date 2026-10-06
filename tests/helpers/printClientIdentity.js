const crypto = require('node:crypto')

/** Test-only enrollment for fixtures; callers have already asserted an independent test database. */
async function provisionTestPrintClient(pool, { clientId, warehouseId = null, hostname = 'virtual-test-only' }) {
  const target = require('./testEnvironment').validateTestEnvironment()
  const [[current]] = await pool.query('SELECT DATABASE() AS databaseName')
  if (current.databaseName !== target.database) throw new Error('打印测试夹具数据库与显式测试目标不符')
  const credential = crypto.randomBytes(32).toString('hex')
  const credentialHash = crypto.createHash('sha256').update(credential).digest('hex')
  await pool.query(`INSERT INTO print_clients (client_id, hostname, warehouse_id, credential_hash, revoked_at, last_seen, status)
    VALUES (?,?,?,?,NULL,NOW(),1) ON DUPLICATE KEY UPDATE warehouse_id=VALUES(warehouse_id), credential_hash=VALUES(credential_hash), revoked_at=NULL, last_seen=NOW(), status=1`, [clientId, hostname, warehouseId, credentialHash])
  return { clientId, credential, identity: { clientId, credentialHash, warehouseId }, headers: { 'X-Client-Id': clientId, 'X-Print-Client-Credential': credential } }
}
module.exports = { provisionTestPrintClient }
