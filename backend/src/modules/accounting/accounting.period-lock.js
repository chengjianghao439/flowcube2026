const AppError = require('../../utils/AppError')

// 同账套凭证写入与结账共用一把事务锁。期间行可能尚不存在，单纯查期间行不能
// 可靠覆盖首次生成/首次结账；以始终存在的账套行串行化也保护期间内凭证号分配。
async function lockAccountingCompany(conn, companyId = 1) {
  const [[company]] = await conn.query('SELECT id FROM acct_companies WHERE id = ? FOR UPDATE', [companyId])
  if (!company) throw new AppError('账套不存在', 404)
}

/**
 * 账套行的**共享**锁。给「只读期间状态、不写会计账」的资金流水闸门用。
 *
 * 为什么需要它：闸门原先一律用 lockAccountingCompany（排他），于是**两笔互不相干的收款**
 * 也要在同一把账套锁上排队——并发收款被串行化（2026-09-26 实测：F01 并发收款 5 秒锁等待超时）。
 * 闸门只是「读一眼期间封没封」，共享锁足够：
 *   · 共享 vs 共享 → 兼容，并发登记互不阻塞；
 *   · 共享 vs 结账的排他锁 → 互斥，结账照样挡得住「检查时未结、写入时已结」。
 * 真正要写凭证/结账的路径继续用排他版，凭证号分配与期间状态变更仍需串行。
 */
async function lockAccountingCompanyShared(conn, companyId = 1) {
  const [[company]] = await conn.query('SELECT id FROM acct_companies WHERE id = ? FOR SHARE', [companyId])
  if (!company) throw new AppError('账套不存在', 404)
}

module.exports = { lockAccountingCompany, lockAccountingCompanyShared }
