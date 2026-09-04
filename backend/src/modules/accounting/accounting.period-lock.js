const AppError = require('../../utils/AppError')

// 同账套凭证写入与结账共用一把事务锁。期间行可能尚不存在，单纯查期间行不能
// 可靠覆盖首次生成/首次结账；以始终存在的账套行串行化也保护期间内凭证号分配。
async function lockAccountingCompany(conn, companyId = 1) {
  const [[company]] = await conn.query('SELECT id FROM acct_companies WHERE id = ? FOR UPDATE', [companyId])
  if (!company) throw new AppError('账套不存在', 404)
}

module.exports = { lockAccountingCompany }
